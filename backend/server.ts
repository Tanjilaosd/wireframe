console.log("MONGODB_URL =", process.env.MONGODB_URL);

import cluster = require("node:cluster");
import { Server } from "node:http";
import mongoose from "mongoose";
import {env} from "./src/config/env.ts"

import {logger} from './src/utills/logger.ts'
import {connectDb} from "./src/config/db.ts";
import { app } from "./src/app";

let isShuttingDown = false;

const shutdown_timeout = 10_000;
const keep_Alive_Timeout =65_000

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
    server = app.listen(env.PORT,()=> {
        logger.info({
            port:env.PORT,
            env:env.NODE_ENV,
            pid:process.pid,
            node:process.version
        },"server started")
        logger.info({url:`http://localhost:${env.PORT}/api/vi`})
    })
    server.keepAliveTimeout= keep_Alive_Timeout
    server.headersTimeout = keep_Alive_Timeout+5_000
    server.on(`error`,(err:NodeJS.ErrnoException)=>{
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