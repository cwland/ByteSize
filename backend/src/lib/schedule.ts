import type { FastifyInstance } from "fastify";

// Scheduled work (the daily backup, the photo and lookup cleanups) and closing the server: closing waits for a
// run still going, so nothing runs on against a database the server has let go of, but only for so long, so a
// run that hangs can't keep the server from closing.

/** Swappable in tests. photoCleanupStarted: called as each photo cleanup run begins. */
export const scheduleHooks = {
  closeWaitMs: 10_000,
  photoCleanupStarted: async (): Promise<void> => {},
};

/** Waits for `running` (never throws), at most scheduleHooks.closeWaitMs; past that, says so in the server log. */
export async function waitOnClose(app: FastifyInstance, what: string, running: Promise<unknown>) {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<"late">((r) => (timer = setTimeout(() => r("late"), scheduleHooks.closeWaitMs)));
  const outcome = await Promise.race([running.then(() => "done" as const, () => "done" as const), late]);
  clearTimeout(timer);
  if (outcome === "late") app.log.warn(`Closing without waiting any longer for the ${what}`);
}
