import cluster = require("node:cluster");
import { Server } from "node:http";
import mongoose from "mongoose";

import { logger } from "./backend/src/utills/logger";
import connectDb from "./backend/src/config/db";

let isShuttingDown = false;

const shutdown_timeout = 10_000;

let server: Server | null = null;

const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;

    isShuttingDown = true;

    logger.info({ signal }, "shutting down gracefully");

    const forceTimer = setTimeout(() => {
        logger.error(
            { time: shutdown_timeout },
            "graceful shutdown timeout"
        );
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

        // Close MongoDB connection
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
            logger.info("MongoDB connection closed");
        }

        clearTimeout(forceTimer);

        logger.info("Graceful shutdown completed");

        process.exit(0);
    } catch (err) {
        clearTimeout(forceTimer);

        logger.error(
            { err },
            "error during shutdown cleanup"
        );

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
    logger.error(
        { err: reason },
        "unhandled rejection shutdown"
    );

    void shutdown("unhandledRejection");
});

process.once("uncaughtException", (err: Error) => {
    logger.fatal(
        { err },
        "uncaught exception shutdown"
    );

    void shutdown("uncaughtException");
});

const startServer = async (): Promise<void> => {
    await connectDb();

    
};

void startServer();