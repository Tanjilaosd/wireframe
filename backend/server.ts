<<<<<<< HEAD
import mongoose from "mongoose";
import { createServer } from "node:http";

import { env } from "./src/config/env.ts";
import { logger } from "./src/utills/logger.ts";
import { connectDb } from "./src/config/db.ts";
import { app } from "./src/app";

const listen_errors: Readonly<Record<string, string>> = {
    EADDRINUSE: "is already in use",
    EACCES: "requires elevated privileges",
};

let isShuttingDown = false;

const shutdown_timeout = 10_000;
const keep_Alive_Timeout = 65_000;
const request_timeout = 30_000;

let server: ReturnType<typeof createServer> | null = null;

const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;

    isShuttingDown = true;

    logger.info({ signal }, "shutting down gracefully");

    const forceTimer = setTimeout(() => {
        logger.error({ time: shutdown_timeout }, "graceful shutdown timeout");
        process.exit(1);
    }, shutdown_timeout);

    forceTimer.unref();

    try {
        if (server) {
            server.closeAllConnections?.();

            await new Promise<void>((resolve, reject) => {
                server!.close((err) => (err ? reject(err) : resolve()));
            });

            logger.info("HTTP server closed");
        }

        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
            logger.info("MongoDB connection closed");
        }

        clearTimeout(forceTimer);

        logger.info("Graceful shutdown completed");

        process.exit(0);
    } catch (err) {
        clearTimeout(forceTimer);

        logger.error({ err }, "error during shutdown cleanup");

        process.exit(1);
    }
};

process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});

process.once("unhandledRejection", (reason: unknown) => {
    logger.error({ err: reason }, "unhandled rejection shutdown");

    void shutdown("unhandledRejection");
});

process.once("uncaughtException", (err: Error) => {
    logger.fatal({ err }, "uncaught exception shutdown");

    void shutdown("uncaughtException");
});

const attachProcessHandlers = () : void => {
    onfatal = (reason:string,level:"fatal"| "error") => (
        (err:unknown): void => {
            logger[level]({err},`${reason} - initiating shutdown`)
        }

        process.on('uncaughtException',onfatal("uncoughtExeption",'fatal'))
        process.on("unhandledRejection",onfatal('unhandleRejection','error'))
        const signals: NodeJS.Signals[] = ['SIGTERM','SIGINT','SIGQUIT']
        for(const signal of signals){
            process.on(signal, () => {
            logger.info({signal},'received termintion signal')
            })
        }
    )
}

const startServer = async (): Promise<void> => {
    await connectDb();

    const httpServer = createServer(app);

    httpServer.keepAliveTimeout = keep_Alive_Timeout;
    httpServer.headersTimeout = keep_Alive_Timeout + 5_000;
    httpServer.requestTimeout = request_timeout;

    httpServer.on("error", (err: NodeJS.ErrnoException) => {
        const code = err.code ?? "";
        const listen_err = listen_errors[code];

        if (listen_err) {
            logger.fatal({ err, port: env.PORT }, `port ${env.PORT} ${listen_err}`);
        } else {
            logger.fatal({ err }, "server encountered a fatal error");
        }

        process.exit(1);
    });

    await new Promise<void>((resolve) => {
        httpServer.listen(env.PORT, () => {
            logger.info({ port: env.PORT }, "server is listening");
            resolve();
        });
    });

    server = httpServer;
};

try {
    await startServer();
} catch (error) {
    logger.fatal({ error }, "failed to start server");
    process.exit(1);
=======
import mongoose from "mongoose";
import { createServer } from "node:http";

import { env } from "./src/config/env.ts";
import { logger } from "./src/utills/logger.ts";
import { connectDb } from "./src/config/db.ts";
import { app } from "./src/app";

const listen_errors: Readonly<Record<string, string>> = {
    EADDRINUSE: "is already in use",
    EACCES: "requires elevated privileges",
};

let isShuttingDown = false;

const shutdown_timeout = 10_000;
const keep_Alive_Timeout = 65_000;
const request_timeout = 30_000;

let server: ReturnType<typeof createServer> | null = null;


const attachProcessHandlers = () : void => {
    onfatal = (reason:string,level:"fatal"| "error") => (
        (err:unknown): void => {
            logger[level]({err},`${reason} - initiating shutdown`)
        }

        process.on('uncaughtException',onfatal("uncoughtExeption",'fatal'))
        process.on("unhandledRejection",onfatal('unhandleRejection','error'))
        const signals: NodeJS.Signals[] = ['SIGTERM','SIGINT','SIGQUIT']
        for(const signal of signals){
            process.on(signal, () => {
            logger.info({signal},'received termintion signal')
            })
        }
    )
}

const startServer = async (): Promise<void> => {
    await connectDb();

    const httpServer = createServer(app);

    httpServer.keepAliveTimeout = keep_Alive_Timeout;
    httpServer.headersTimeout = keep_Alive_Timeout + 5_000;
    httpServer.requestTimeout = request_timeout;

    httpServer.on("error", (err: NodeJS.ErrnoException) => {
        const code = err.code ?? "";
        const listen_err = listen_errors[code];

        if (listen_err) {
            logger.fatal({ err, port: env.PORT }, `port ${env.PORT} ${listen_err}`);
        } else {
            logger.fatal({ err }, "server encountered a fatal error");
        }

        process.exit(1);
    });

    await new Promise<void>((resolve) => {
        httpServer.listen(env.PORT, () => {
            logger.info({ port: env.PORT }, "server is listening");
            resolve();
        });
    });

    server = httpServer;
};

try {
    await startServer();
} catch (error) {
    logger.fatal({ error }, "failed to start server");
    process.exit(1);
>>>>>>> 61e01d85f7ec953ac3bf0e0f70365e84d1d59af7
}