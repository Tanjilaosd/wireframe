import mongoose from "mongoose"
import { env } from './env';
import { logger } from './../utills/logger';

export const connectDb = async ():Promise<void> => {
    if(mongoose.connection.readyState === 1) return

    const connectionDb = await mongoose.connect(env.MONGODB_URL)
    logger.info({
        host:connectDb.connection.host,
        name:connectionDb.connection.name

    },"mongodb connected")
}

export const disConnectDb = async ():Promise<void> => {
    if(mongoose.connection.readyState === 0)return
    await mongoose.connection.close()
    logger.info("mongodb connection is closed")
}