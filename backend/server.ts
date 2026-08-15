import { createServer, type Server } from "node:http";

import { setTimeout as delay } from "node:timers/promises";
import { logger } from "@utils/logger.js";
import { env } from "@config/env.js";
import { app } from "@app";
import { connectDb, disconnectDb } from "@config/db.js";

const listen_errors: Readonly<Record<string, string>> = {
  EADDRINUSE: "is already in use",
  EACCES: "requires elevated privileges",
};

const shutdown_timeout = 15_000;
const keepAlive_timeout = 65_000;
const headers_timeout = 30_000;
const request_timeout = 30_000;
const drain_delay = env.isProduction ? 5_000 : 0;
const logFlushTimeout = 500;

let isShuttingDown = false;
let server: Server | null = null;
let pendingExitCode = 0;

const exitAfterFlush = async (code: number): Promise<never> => {
  await Promise.race([
    new Promise<void>((resolve) => {
      logger.flush(() => resolve());
    }),

    delay(logFlushTimeout),
  ]).catch(() => undefined);

  process.exit(code);
};

const closeHttpServer = async (): Promise<void> => {
  const activeServer = server;

  if (!activeServer?.listening) return;
  activeServer.closeIdleConnections();

  await new Promise<void>((resolve, reject) => {
    activeServer.close((err) => (err ? reject(err) : resolve()));
  });

  logger.info("http server closed");
};

const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
  if (exitCode !== 0 && pendingExitCode === 0) pendingExitCode = exitCode;
  if (isShuttingDown) {
    if (exitCode !== 0) {
      logger.error({ reason, exitCode }, "fatal error during shutdown");
    }
    return;
  }
  isShuttingDown = true;

  logger.info({ reason, exitCode }, "shutting down gracefully");

  const forceTimer = setTimeout(() => {
    logger.error(
      { timeOut: shutdown_timeout },
      "graceful shutdown timed out, forcing exit",
    );
    server?.closeAllConnections();
  }, shutdown_timeout);
  forceTimer.unref();

  if (exitCode === 0 && drain_delay > 0) {
    logger.info(
      { drainDelay: drain_delay },
      "draining before closing listener",
    );
    await delay(drain_delay);
  }

  const steps: ReadonlyArray<
    readonly [label: string, close: () => Promise<void>]
  > = [
    ["http server", closeHttpServer],
    ["database connection", disconnectDb],
  ];

  let cleanupFailed = false;
  for (const [label, close] of steps) {
    try {
      await close();
    } catch (error) {
      cleanupFailed = true;
      logger.error({ error }, `failed to close ${label}`);
    }
  }
  clearTimeout(forceTimer);
  await exitAfterFlush(cleanupFailed ? 1 : pendingExitCode);
};

const attachProcessHandlers = (): void => {
  const onFatal =
    (reason: string, level: "fatal" | "error") =>
    (err: unknown): void => {
      try {
        logger[level]({ err }, `${reason} - initiating shutdown`);
      } catch {
        try {
          logger[level](`${reason} - initiating shutdown`);
        } catch {}
      }
      shutdown(reason, 1).catch(() => process.exit(1));
    };

  process.on("uncaughtException", onFatal("uncaughtException", "fatal"));
  process.on(
    "unhandledRejection",
    onFatal("unhandledRejection", "error"),
  );

  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGQUIT"];
  for (const signal of signals) {
    process.on(signal, () => {
      logger.info({ signal }, "received termination signal");
      shutdown(`signal: ${signal}`, 0).catch(() => process.exit(0));
    });
  }
};

const listen = (httpServer: Server, port: number): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      const listenError = listen_errors[err.code ?? ""];

      logger.fatal(
        { err, ...(listenError && { port: env.PORT }) },
        listenError
          ? `port ${env.PORT} ${listenError}`
          : `server encountered a fatal error`,
      );
      reject(err);
    };

    httpServer.once("error", onError);
    httpServer.listen(port, () => {
      httpServer.removeListener("error", onError);
      resolve();
    });
  });

const startServer = async (): Promise<void> => {
  await connectDb();

  const httpServer = createServer(app);
  server = httpServer;

  httpServer.keepAliveTimeout = keepAlive_timeout;
  httpServer.headersTimeout = headers_timeout;
  httpServer.requestTimeout = request_timeout;

  await listen(httpServer, env.PORT);

  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      pid: process.pid,
      node: process.version,
    },
    "server started",
  );
  if (env.isDevelopment) {
    const baseUrl = `http://localhost:${env.PORT}`;
    logger.info(
      { api: `${baseUrl}/api/v1`, health: `${baseUrl}/health` },
      "Local endpoints",
    );
  }
};

attachProcessHandlers();

try {
  await startServer();
} catch (err) {
  logger.fatal({ err }, "failed to start server");

  process.exit(1);
}
