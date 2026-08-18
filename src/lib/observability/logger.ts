type LogContext = Record<string, unknown>;

export function logInfo(message: string, context: LogContext = {}): void {
  write("info", message, context);
}

export function logError(message: string, error: unknown, context: LogContext = {}): void {
  write("error", message, {
    ...context,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
}

function write(level: "info" | "error", message: string, context: LogContext): void {
  const entry = JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    message,
    ...context,
  });
  if (level === "error") console.error(entry);
  else console.info(entry);
}
