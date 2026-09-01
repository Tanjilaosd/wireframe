import mongoose, { type ConnectOptions } from "mongoose";
import { env } from "@config/env.js";
import { service_name } from "@shared/identity.js";
import { logger } from "@utils/logger.js";

const pool_checkout_timeout = 2_000;
const server_selection_timeout = env.isProduction ? 15_000 : 5_000;
const query_timeout = 12_000;

let closingPromise: Promise<void> | null = null;
let connectionPromise: Promise<void> | null = null;
let hasEstablishedClient = false;

const connection_options: ConnectOptions = {
    appName: service_name,
    maxPoolSize: env.isProduction ? 100 : 10,
    minPoolSize: env.isProduction ? 5 : 0,
    maxIdleTimeMS: 60_000,
    waitQueueTimeoutMS: pool_checkout_timeout,
    serverSelectionTimeoutMS: server_selection_timeout,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    retryWrites: true,
    retryReads: true,
    compressors: ["zlib"],
    zlibCompressionLevel: 6,
    autoIndex: !env.isProduction,
    autoCreate: !env.isProduction,
    bufferCommands: false,
    ...(env.isProduction && {
        writeConcern: {
            w: "majority" as const,
            wtimeoutMS: query_timeout,
        },
    }),
};

const isDbConnected = (): boolean =>
    mongoose.connection.readyState === mongoose.ConnectionStates.connected;

const discardClient = async (): Promise<void> => {
    try {
        await mongoose.connection.close();
    } catch (err) {
        logger.error({ err }, "mongodb failed connect cleanup error");
    }
};

const assertTransactionTopology = async (): Promise<void> => {
    let hello: Record<string, unknown> | undefined;
    try {
        hello = await mongoose.connection.db
            ?.admin()
            .command({ hello: 1 }, { timeoutMS: server_selection_timeout });
    } catch {
        throw new Error("Failed to verify the mongodb deployment topology");
    }

    if (hello?.setName || hello?.msg === "isdbgrid") return;
    throw new Error(
        "Production mongodb must be a replica set or a sharded cluster - a standalone server cannot run the transactions this service depends on",
    );
};

const openConnection = async (): Promise<void> => {
    try {
        await mongoose.connect(env.MONGODB_URL, connection_options);
    } catch {
        await discardClient();
        throw new Error("failed to establish mongodb connection");
    }

    if (env.isProduction) {
        try {
            await assertTransactionTopology();
        } catch (error) {
            await discardClient();
            throw error;
        }
    }

    hasEstablishedClient = true;
    const { host, name } = mongoose.connection;
    logger.info({
        host,
        databaseName: name,
        poolSize: connection_options.maxPoolSize,
        poolCheckoutTimeout: pool_checkout_timeout,
        serverSelectionTimeout: server_selection_timeout,
        queryTimeOut: query_timeout,
        autoIndex: connection_options.autoIndex,
    });
};

export const connectDb = async (): Promise<void> => {
    if (closingPromise) {
        throw new Error("mongodb connection is closing");
    }
    if (connectionPromise) return connectionPromise;
    if (isDbConnected()) return;
    if (hasEstablishedClient) {
        throw new Error("mongodb connection is temporarily unavailable");
    }
    const attempt = (connectionPromise = openConnection());
};

export const disconnectDb = async (): Promise<void> => {
    if (closingPromise) return closingPromise;
    const closeAttempt = (closingPromise =
        Promise.resolve().then(closeConnection));
};