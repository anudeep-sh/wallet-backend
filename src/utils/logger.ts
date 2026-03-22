/**
 * Lightweight structured logger.
 * Outputs JSON lines for easy parsing by Cloud Logging / ELK / Datadog.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

const write = (
  level: LogLevel,
  message: string,
  meta?: Record<string, any>,
) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
};

export const logger = {
  info: (msg: string, meta?: Record<string, any>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, any>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, any>) => write("error", msg, meta),
  debug: (msg: string, meta?: Record<string, any>) => write("debug", msg, meta),
};
