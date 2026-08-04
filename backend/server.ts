console.log("MONGODB_URL =", process.env.MONGODB_URL);

import cluster = require("node:cluster");
import { Server } from "node:http";
import mongoose from "mongoose";
import {env} from "./src/config/env.ts"

import {logger} from './src/utills/logger.ts'
import {connectDb} from "./src/config/db.ts";
import { app } from "./src/app";
import { createServer } from "node:https";

let isShuttingDown = false;

const shutdown_timeout = 10_000;
const keep_Alive_Timeout =65_000;
const request_timeout = 30_000;
const headers_timeout = 30_000;

let server: ReturnType<typeof createServer> | null = null

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
    const httpServer = createServer(app)
    httpServer.keepAliveTimeout= keep_Alive_Timeout
    httpServer.headersTimeout = keep_Alive_Timeout + 5_000
    httpServer.requestTimeout = 30_000
    httpServer.on(`error`,(err:NodeJS.ErrnoException)=>{
        if(err.code === "EADDRINUSE"){
            logger.fatal({port:env.PORT},`port ${env.PORT} is already in use`)
        }
        else if(err.code === 'EACCES'){
            logger.fatal({port:env.PORT},`port ${env.PORT} requires elevated priviledges`)
        }
        else{
            logger.fatal({err},'server encounterd a fatal error')
        }
        process.exit(1)
    })

    
};




try {
    await startServer()
} catch (error) {
    logger.fatal({error},"failed to start  server")
    process.exit(1)
    
}