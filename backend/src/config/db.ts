import mongoose, { ConnectOptions } from "mongoose"
import { env } from './env';
import { logger } from './../utills/logger';


mongoose.connection.on('error',error => {
    logger.error({error},'mongodb connection error')
})
mongoose.connection.on("disconnected",() => {
    logger.warn("mongodb disconnected")
})
mongoose.connection.on("reconnected",() =>{
    logger.info("mongodb reconnected")
})

const isProduction = env.NODE_ENV === 'production'
const connection_options:ConnectOptions = {
    maxPoolSize:isProduction?100:10,
    minPoolSize:isProduction?10:2,
    serverSelectionTimeoutMS:5_000,
    socketTimeoutMS:45_000,
    heartbeatFrequencyMS:10_000,
    retryReads:true,
    compressors:['snappy','zstd'],
    ...(isProduction  && {
        w: "majority",
        readPreference:"secondaryPreferred" as const
    })
}









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