import { describe, expect, it, vi } from "vitest";

describe("MALLOC_ARENA_MAX for the production process", () => {
  it("replaces a production process without it, once, with the same node, flags and script, and the variable set", async () => {
    const { reexecWithMallocArenaLimit } = await import("./_core/mallocArena");
    const execve = vi.fn();
    const target = { env: { NODE_ENV: "production", PORT: "3000" }, execPath: "/usr/bin/node", execArgv: ["--enable-source-maps"], argv: ["/usr/bin/node", "/app/dist/index.js"], execve };
    reexecWithMallocArenaLimit(target as never);
    expect(execve).toHaveBeenCalledWith("/usr/bin/node", ["/usr/bin/node", "--enable-source-maps", "/app/dist/index.js"], { NODE_ENV: "production", PORT: "3000", MALLOC_ARENA_MAX: "2" });
    // Already set (the replaced process): nothing happens, so it cannot loop.
    expect(reexecWithMallocArenaLimit({ ...target, env: { NODE_ENV: "production", MALLOC_ARENA_MAX: "2" } } as never)).toBe("already");
    expect(reexecWithMallocArenaLimit({ ...target, env: { NODE_ENV: "development" } } as never)).toBe("skipped");
    expect(reexecWithMallocArenaLimit({ ...target, execve: undefined } as never)).toBe("unsupported");
    expect(execve).toHaveBeenCalledTimes(1);
  });

  it("carries on as it is when the replacement fails", async () => {
    const { reexecWithMallocArenaLimit } = await import("./_core/mallocArena");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const execve = vi.fn(() => { throw new Error("EACCES"); });
    expect(reexecWithMallocArenaLimit({ env: { NODE_ENV: "production" }, execPath: "/n", execArgv: [], argv: ["/n", "/s"], execve } as never)).toBe("failed");
  });
});
