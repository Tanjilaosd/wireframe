import { z } from "zod";
import { da } from "zod/v4/locales";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional(),

  PORT: z.coerce.number().int().min(1).max(65535).default(5000),

  MONGODB_URL: z
    .string()
    .trim()
    .min(1, { message: "mongodb uri is required" })
    .startsWith("mongodb", {
      message: "mongodb uri must start with mongodb",
    }),
});

const parsed = envSchema.safeParse(process.env);

// if (!parsed.success) {
//   console.error("Invalid environment variables", z.treeifyError(parsed.error));
//   process.exit(1);
// }

if (!parsed.success) {
  console.error(parsed.error.issues);
  process.exit(1);
}

const  data = parsed.data



export type parsedEnv = z.infer<typeof envSchema>;
export type Env = Readonly<parsedEnv & {
  readonly isDevelopment: boolean
}>

export const env: Env = Object.freeze({
  ...data,
  isDevelopment : data.NODE_ENV === 'development'
});