// Turns the usual "can't start" database problems into one plain line instead of a stack trace.

const codeOf = (err: unknown): string | undefined =>
  err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : undefined;

// Every error code in the chain: drizzle wraps the driver's error in .cause, and Node wraps a refused
// connection to every address of a host (e.g. ::1 and 127.0.0.1) in an AggregateError
function codes(err: unknown, depth = 0): string[] {
  if (!err || typeof err !== "object" || depth > 5) return [];
  const own = codeOf(err);
  const inner = [
    ...(err instanceof AggregateError ? err.errors.flatMap((e) => codes(e, depth + 1)) : []),
    ...codes((err as { cause?: unknown }).cause, depth + 1),
  ];
  return own ? [own, ...inner] : inner;
}

function parse(databaseUrl: string) {
  try {
    const u = new URL(databaseUrl);
    return { host: u.hostname || "localhost", port: u.port || "5432", name: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres" };
  } catch {
    return { host: "localhost", port: "5432", name: "bytesize" };
  }
}

export function startupProblem(err: unknown, databaseUrl: string): string | null {
  const found = codes(err);
  const { host, port, name } = parse(databaseUrl);
  if (found.includes("3D000")) return `Database "${name}" doesn't exist. Create it with: createdb ${name}`;
  if (found.includes("ECONNREFUSED")) return `Can't reach PostgreSQL at ${host}:${port}. Is it running?`;
  if (found.includes("28P01") || found.includes("28000")) return "PostgreSQL refused the sign-in for this DATABASE_URL.";
  return null;
}

/** The server's last resort: a promise nobody handled is logged, and the server keeps running. */
export const logUnhandledRejection = (log: (message: string) => void) => (reason: unknown) =>
  log(`Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
