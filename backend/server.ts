import { connectDb,disconnectDb } from "@config/db.js";
import { createServer, type Server } from "node:http";
import { app } from "@app";
import { env } from "@config/env.js";
import { clearInterval } from "node:timers";
import { logger } from "@utils/logger.js";
import { listenServer } from "@utils/http.server.js";
import { setTimeout as delay } from "node:timers/promises";


const connections_checking_interval = 5_000;
const keep_alive_timeout = 65_000;
const headers_timeout = 30_000;
const request_timeout = 30_000;
const idle_sweep_interval = 100;
const drainDelay = env.isProduction ? 5_000 : 0;
const shutdownTimeout = 35_000;
const logFlushTimeout = 500;

const listen_errors: Readonly<Record<string, string>> = {
  EADDRINUSE: "is already in use",
  EACCES: "requires elevated privileges",
};

let shuttingDown = false;
let server: Server | null = null;
let httpClosePromise: Promise<void> | null = null;
let listenPromise: Promise<void> | null = null;
let exitPromise: Promise<never> | null = null;
let pendingExitCode = 0;
let drainController: AbortController | null = null;

const logCrashSafely = (
  level: "fatal" | "error",
  bindings: Record<string, unknown>,
  message: string,
): void => {
  try {
    logger[level](bindings, message);
  } catch {
    try {
      logger[level](`${message} error details unserializable`);
    } catch { }
  }
};

const closeHttpServer = async (): Promise<void> => {
  if (httpClosePromise) return httpClosePromise;
  const activeServer = server;
  if (!activeServer) return;
  httpClosePromise = (async (): Promise<void> => {
    if (listenPromise) await listenPromise;
    if (!activeServer?.listening) return;
    const idleSweeper = setInterval(() => {
      activeServer.closeIdleConnections();
    }, idle_sweep_interval);
    try {
      await new Promise<void>((resolve, reject) => {
        activeServer.close((err) => (err ? reject(err) : resolve()));
      });
    } finally {
      clearInterval(idleSweeper)
    }
    logger.info('http server closed')
  })()
  return httpClosePromise
}

const initiateShutdown = (reason: string, exitCode: number): void => {
  void shutdown(reason, exitCode).catch((err: unknown) => {
    pendingExitCode = 1;
    drainController?.abort();
    server?.closeAllConnections();
    logCrashSafely("fatal", { err, reason }, "shutdown failed");
    void exitAfterFlush(1);
  });
};


const shutdown = async (reason: string, exitCode: number): Promise<void> => {
  if (exitCode !== 0 && pendingExitCode === 0) pendingExitCode = exitCode;
  if (shuttingDown) {
    if (exitCode !== 0) {
      drainController?.abort();
      server?.closeAllConnections();
      logger.error({ reason, exitCode }, "fatal error during shutdown");
    }
    return;
  }
  shuttingDown = true;
  logger.info({ reason, exitCode }, "shutting down");
  if (pendingExitCode === 0 && drainDelay > 0) {
    logger.info({ drainDelay: drainDelay }, "draining before closing listener");
    drainController = new AbortController();
    try {
      await delay(drainDelay, undefined, { signal: drainController.signal });
    } catch (err) {
      if (!drainController.signal.aborted) throw err;
    } finally {
      drainController = null;
    }}
  if (pendingExitCode !== 0) server?.closeAllConnections();
  const steps: ReadonlyArray<
    readonly [label: string, close: () => Promise<void>]
  > = [
      ["HTTP server", closeHttpServer],
      ["database connection", disconnectDb],
    ];

  const forceTimer = setTimeout(() => {
    server?.closeAllConnections();
    try {
      logger.error(
        { timeoutMs: shutdownTimeout },
        "Graceful shutdown timed out, forcing exit",
      );
    } catch { }
    void exitAfterFlush(1);
  }, shutdownTimeout);
  for (const [label, close] of steps) {
    try {
      await close();
    } catch (err) {
      pendingExitCode = 1;
      logger.error({ err }, `Failed to close ${label}`);
    }
  }
  clearTimeout(forceTimer);
  await exitAfterFlush(pendingExitCode);
};

const exitAfterFlush = (code: number): Promise<never> => {
  if (code !== 0) pendingExitCode = code;
  exitPromise ??= (async (): Promise<never> => {
    await Promise.race([
      new Promise<void>((resolve) => {
        logger.flush(() => resolve());
      }),
      delay(logFlushTimeout),
    ]).catch(() => undefined);
    process.exit(pendingExitCode);
  })();
  return exitPromise;
};

const attachProcessHandlers = (): void => {
  const onFatal =
    (reason: string, level: "fatal" | "error") =>
      (err: unknown): void => {
        logCrashSafely(level, { err }, `${reason} — initiating shutdown`);
        initiateShutdown(reason, 1);
      };

  process.on("uncaughtException", onFatal("uncaughtException", "fatal"));
  process.on("unhandledRejection", onFatal("unhandledRejection", "error"));

  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGQUIT", "SIGHUP"];
  for (const signal of signals) {
    process.on(signal, () => {
      if (shuttingDown) {
        try {
          logger.warn({ signal }, "Repeated termination signal — forcing exit");
        } catch { }
        void exitAfterFlush(1);
        return;
      }
      initiateShutdown(signal, 0);
    });
  }
};



const startServer = async (): Promise<void> => {
  await connectDb();
  if (shuttingDown) return;
  if (shuttingDown) return;
  const httpServer = createServer(
    {
      connectionsCheckingInterval: connections_checking_interval,
    },
    app,
  );
  server = httpServer;
  httpServer.keepAliveTimeout = keep_alive_timeout;
  httpServer.headersTimeout = headers_timeout;
  httpServer.requestTimeout = request_timeout;
  if (shuttingDown) return;
  const pendingListen = (listenPromise = listenServer(httpServer, env.PORT));

  try {
    await pendingListen;
  } finally {
    if (listenPromise === pendingListen) listenPromise = null;
  }
  if (shuttingDown) {
    await closeHttpServer();
    return;
  }
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    logCrashSafely("fatal", { err }, "server encountered a fatal error");
    initiateShutdown("serverError", 1);
  });
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      pid: process.pid,
      node: process.version,
    },
    "Server started",
  );

  if (env.isDevelopment) {
    const baseUrl = `http://localhost:${env.PORT}`;
    logger.info(
      { api: `${baseUrl}`, health: `${baseUrl}/health` },
      "Local endpoints",
    );
  }
};
attachProcessHandlers();
try {
  await startServer();
} catch (err) {
  const code = (err as NodeJS.ErrnoException | null)?.code ?? "";
  const listenError = listen_errors[code];
  logCrashSafely(
    "fatal",
    { err, ...(listenError && { port: env.PORT }) },
    listenError ? `Port ${env.PORT} ${listenError}` : "Failed to start server",
  );
  await shutdown("startupFailure", 1);
}
