/**
 * glibc keeps memory in per-thread arenas and seldom gives it back; with libvips' threads and the OCR worker the
 * web process grew to the host's limit (about 500-550 MB) and was stopped every few minutes (October 23, 2026).
 * Measured on 40 photos, MALLOC_ARENA_MAX=2 lowers the working peak by 60-80 MB and lets closing the OCR worker
 * return the process to about its idle size. glibc reads the variable only at process start, and the host does
 * not run the package.json start script, so a production process without it replaces itself once (same PID,
 * process.execve) with the variable set. Imported first by the entry, before the heavier modules load.
 */
export const MALLOC_ARENA_LIMIT = "2";

type ExecTarget = Pick<NodeJS.Process, "env" | "execPath" | "execArgv" | "argv"> & { execve?: (file: string, args: string[], env: NodeJS.ProcessEnv) => never };

export function reexecWithMallocArenaLimit(target: ExecTarget = process): "skipped" | "already" | "unsupported" | "failed" {
  if (target.env.NODE_ENV !== "production") return "skipped";
  if (target.env.MALLOC_ARENA_MAX) return "already";
  if (typeof target.execve !== "function") return "unsupported";
  try {
    target.execve(target.execPath, [target.execPath, ...target.execArgv, ...target.argv.slice(1)], { ...target.env, MALLOC_ARENA_MAX: MALLOC_ARENA_LIMIT });
  } catch (error) {
    // The process carries on as it is: memory-guarded, just without the arena limit.
    console.error("[malloc-arena] could not restart with MALLOC_ARENA_MAX:", error instanceof Error ? error.message : error);
  }
  return "failed";
}

reexecWithMallocArenaLimit();
