import mongoose, { ConnectOptions } from "mongoose";
import { env } from "./env.js";
import { logger } from "../utills/logger.js";

mongoose.connection.on("error", (error) => {
  logger.error({ error }, "mongodb connection error");
});

mongoose.connection.on("disconnected", () => {
  logger.warn("mongodb disconnected");
});

mongoose.connection.on("reconnected", () => {
  logger.info("mongodb reconnected");
});

const connection_options: ConnectOptions = {
  maxPoolSize: env.isProduction ? 100 : 10,
  minPoolSize: env.isProduction ? 10 : 2,
  serverSelectionTimeoutMS: 5_000,
  socketTimeoutMS: 45_000,
  heartbeatFrequencyMS: 10_000,
  retryReads: true,
  compressors: ["snappy", "zstd"],
  ...(env.isProduction && {
    w: "majority",
    readPreference: "secondaryPreferred" as const,
  }),
};

export const connectDb = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) return;

  await mongoose.connect(env.MONGODB_URL, connection_options);
  logger.info(
    {
      host: mongoose.connection.host,
      name: mongoose.connection.name,
    },
    "mongodb connected",
  );
};

export const disconnectDb = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.connection.close();
  logger.info("mongodb connection is closed");
};
