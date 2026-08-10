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
}