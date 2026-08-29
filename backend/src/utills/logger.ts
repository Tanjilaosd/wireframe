import { env } from "../config/env.js";
import pino from 'pino'

const defaultLevel = env.NODE_ENV === 'development' ? "debug" : "info"

export const logger = pino({
    name: "task-vault-api",
    level: env.LOG_LEVEL ?? defaultLevel,
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            'password',
            'newPassword',
            'currentPassword',
            'refreshToken',
            'accessToken',
            'secret'
        ],
        censor: '[REDACTED]'
    },
    transport: env.NODE_ENV === 'development' ? {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss'
        }
    } : undefined

})

