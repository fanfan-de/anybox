import { describe, expect, it } from "bun:test"
import type { JSONValue } from "@ai-sdk/provider"
import {
  executeJavaScript,
  type JavaScriptExecutionInput,
  type JavaScriptExecutionLimits,
} from "#tool/javascript-runtime.ts"

const DEFAULT_LIMITS: JavaScriptExecutionLimits = {
  wallTimeoutMs: 1_500,
  cpuSliceMs: 100,
  memoryBytes: 32 * 1024 * 1024,
  maxStackBytes: 512 * 1024,
  maxToolCalls: 64,
  maxToolArgumentsChars: 50_000,
  maxToolResultChars: 50_000,
  maxTotalToolResultChars: 500_000,
  maxOutputChars: 50_000,
}

type RunOptions = {
  toolNames?: readonly string[]
  signal?: AbortSignal
  limits?: Partial<JavaScriptExecutionLimits>
  invokeTool?: JavaScriptExecutionInput["invokeTool"]
}

function runJavaScript(code: string, options: RunOptions = {}) {
  return executeJavaScript({
    code,
    toolNames: options.toolNames ?? ["echo"],
    signal: options.signal ?? new AbortController().signal,
    limits: {
      ...DEFAULT_LIMITS,
      ...options.limits,
    },
    invokeTool: options.invokeTool ?? (async (_name, value) => value),
  })
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe("QuickJS JavaScript runtime", () => {
  it("returns JSON values and normalizes an absent return to null", async () => {
    expect(await runJavaScript('return "hello"')).toBe("hello")
    expect(await runJavaScript("return 42")).toBe(42)
    expect(await runJavaScript("return { ok: true, nested: [1, null] }")).toEqual({
      ok: true,
      nested: [1, null],
    })
    expect(await runJavaScript("return [1, 2, 3]")).toEqual([1, 2, 3])
    expect(await runJavaScript("const value = 1")).toBeNull()
  })

  it("supports await, loops, conditions, Promise.all, and catchable tool failures", async () => {
    const calls: Array<{ name: string; input: JSONValue }> = []
    const result = await runJavaScript(
      `
let sum = 0;
for (let index = 1; index <= 4; index += 1) {
  sum += index;
}
const echoed = await tools.echo({ sum });
const doubled = await Promise.all(
  [1, 2, 3].map((value) => tools.echo(value * 2)),
);
let failure;
try {
  await tools.fail({ expected: true });
} catch (error) {
  failure = error.message;
}
if (echoed.sum !== 10) {
  throw new Error("unexpected sum");
}
return { echoed, doubled, failure };
`,
      {
        toolNames: ["echo", "fail"],
        invokeTool: async (name, input) => {
          calls.push({ name, input })
          if (name === "fail") throw new Error("expected tool failure")
          return input
        },
      },
    )

    expect(result).toEqual({
      echoed: { sum: 10 },
      doubled: [2, 4, 6],
      failure: "expected tool failure",
    })
    expect(calls).toHaveLength(5)
  })

  it("starts at least sixteen Promise.all tool calls without a concurrency gate", async () => {
    let active = 0
    let peak = 0

    const result = await runJavaScript(
      `
return await Promise.all(
  Array.from({ length: 16 }, (_, index) => tools.echo(index)),
);
`,
      {
        invokeTool: async (_name, input) => {
          active += 1
          peak = Math.max(peak, active)
          try {
            await delay(20)
            return input
          } finally {
            active -= 1
          }
        },
      },
    )

    expect(result).toEqual(Array.from({ length: 16 }, (_, index) => index))
    expect(peak).toBe(16)
  })

  it("allows 64 calls and makes the 65th call a non-catchable fatal budget error", async () => {
    expect(
      await runJavaScript(`
const results = [];
for (let index = 0; index < 64; index += 1) {
  results.push(await tools.echo(index));
}
return results.length;
`),
    ).toBe(64)

    await expect(
      runJavaScript(`
let caught = false;
try {
  for (let index = 0; index < 65; index += 1) {
    await tools.echo(index);
  }
} catch {
  caught = true;
}
return { escapedFatalBudget: caught };
`),
    ).rejects.toThrow("tool call limit of 64")
  })

  it("enforces argument, per-result, cumulative-result, and output budgets", async () => {
    await expect(
      runJavaScript(
        `
try {
  await tools.echo("arguments are too large");
} catch {
  return "must not escape";
}
`,
        {
          limits: { maxToolArgumentsChars: 8 },
        },
      ),
    ).rejects.toThrow("Tool arguments exceeded")

    await expect(
      runJavaScript("await tools.echo(null); return true", {
        limits: { maxToolResultChars: 10 },
        invokeTool: async () => "123456789",
      }),
    ).rejects.toThrow("Result from tool")

    await expect(
      runJavaScript(
        `
await tools.echo(1);
try {
  await tools.echo(2);
} catch {
  return "must not escape";
}
return true;
`,
        {
          limits: {
            maxToolResultChars: 20,
            maxTotalToolResultChars: 10,
          },
          invokeTool: async () => "1234",
        },
      ),
    ).rejects.toThrow("cumulative 10 character limit")

    await expect(
      runJavaScript('return "123456789"', {
        limits: { maxOutputChars: 10 },
      }),
    ).rejects.toThrow("execution result exceeded")
  })

  it("interrupts a synchronous infinite loop before and after an awaited tool", async () => {
    await expect(
      runJavaScript("while (true) {}", {
        limits: { cpuSliceMs: 25 },
      }),
    ).rejects.toThrow("CPU slice limit of 25ms")

    await expect(
      runJavaScript("await tools.echo(true); while (true) {}", {
        limits: { cpuSliceMs: 25 },
      }),
    ).rejects.toThrow("CPU slice limit of 25ms")
  })

  it("rejects uncaught QuickJS heap and stack limit failures", async () => {
    await expect(
      runJavaScript(
        `
const values = [];
while (true) {
  const batch = [];
  for (let index = 0; index < 100; index += 1) {
    batch.push({
      index,
      label: "value-" + values.length + "-" + index,
    });
  }
  values.push(batch);
}
`,
        {
          toolNames: [],
          limits: {
            memoryBytes: 512 * 1024,
            cpuSliceMs: 500,
          },
        },
      ),
    ).rejects.toThrow(/out of memory|memory limit/i)

    await expect(
      runJavaScript(
        `
function recurse() {
  return recurse();
}
return recurse();
`,
        {
          toolNames: [],
          limits: {
            maxStackBytes: 64 * 1024,
            cpuSliceMs: 500,
          },
        },
      ),
    ).rejects.toThrow(/stack overflow|stack size/i)
  })

  it("times out a pending host call and ignores its late result", async () => {
    let releaseTool!: (value: JSONValue) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })

    const execution = runJavaScript("return await tools.echo(true)", {
      limits: { wallTimeoutMs: 40 },
      invokeTool: async () => {
        markStarted()
        return await new Promise<JSONValue>((resolve) => {
          releaseTool = resolve
        })
      },
    })

    await started
    await expect(execution).rejects.toThrow("wall timeout of 40ms")

    releaseTool({ late: true })
    await delay(10)
  })

  it("aborts a pending host call and ignores its late result", async () => {
    const controller = new AbortController()
    let releaseTool!: (value: JSONValue) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })

    const execution = runJavaScript("return await tools.echo(true)", {
      signal: controller.signal,
      invokeTool: async () => {
        markStarted()
        return await new Promise<JSONValue>((resolve) => {
          releaseTool = resolve
        })
      },
    })

    await started
    controller.abort(new Error("test cancellation"))
    await expect(execution).rejects.toThrow("JavaScript execution aborted: test cancellation")

    releaseTool({ late: true })
    await delay(10)
  })

  it("rejects code that returns before all tool calls are awaited or caught", async () => {
    let releaseTool!: () => void
    let markToolStarted!: () => void
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve
    })
    const toolResult = new Promise<JSONValue>((resolve) => {
      releaseTool = () => resolve("late-result")
    })

    const execution = runJavaScript(
      `
tools.echo("detached");
return "done";
`,
      {
        invokeTool: async () => {
          markToolStarted()
          return await toolResult
        },
      },
    )

    await toolStarted
    await expect(execution).rejects.toThrow(
      "returned with 1 unconsumed tool call(s). Await or catch every tools call before returning",
    )

    releaseTool()
    await delay(10)
  })

  it("rejects an unconsumed tool failure even when the host promise settles quickly", async () => {
    await expect(
      runJavaScript(
        `
tools.fail(null);
await tools.echo("still-running");
return "must-not-succeed";
        `,
        {
          toolNames: ["echo", "fail"],
          invokeTool: async (name, input) => {
            if (name === "fail") throw new Error("fast tool failure")
            return input
          },
        },
      ),
    ).rejects.toThrow(
      "returned with 1 unconsumed tool call(s). Await or catch every tools call before returning",
    )
  })

  it("tracks standard then, catch, and finally chains without false positives", async () => {
    const result = await runJavaScript(
      `
const chained = await tools.echo(1).then((value) => value + 1);
let finalized = false;
const finalValue = await tools.echo(2).finally(() => {
  finalized = true;
});
tools.fail(null).catch(() => "handled");
await tools.echo("drain");
return { chained, finalValue, finalized };
`,
      {
        toolNames: ["echo", "fail"],
        invokeTool: async (name, input) => {
          if (name === "fail") throw new Error("handled tool failure")
          return input
        },
      },
    )

    expect(result).toEqual({
      chained: 2,
      finalValue: 2,
      finalized: true,
    })
  })

  it("rejects an ignored derived chain that rethrows a tool failure", async () => {
    await expect(
      runJavaScript(
        `
tools.fail(null).catch((error) => {
  throw error;
});
await tools.echo("drain");
return "must-not-succeed";
`,
        {
          toolNames: ["echo", "fail"],
          invokeTool: async (name, input) => {
            if (name === "fail") throw new Error("rethrown tool failure")
            return input
          },
        },
      ),
    ).rejects.toThrow(
      "returned with 1 unconsumed tool call(s). Await or catch every tools call before returning",
    )
  })

  it("does not retain a tracker token when argument serialization throws", async () => {
    const result = await runJavaScript(
      `
const circular = {};
circular.self = circular;
let caught = false;
try {
  await tools.echo(circular);
} catch (error) {
  caught = /circular/i.test(error.message);
}
return caught;
`,
    )

    expect(result).toBe(true)
  })

  it("rejects syntax errors, unhandled errors, circular output, and BigInt output", async () => {
    await expect(runJavaScript("return (")).rejects.toThrow()
    await expect(runJavaScript('throw new Error("guest failure")')).rejects.toThrow("guest failure")
    await expect(
      runJavaScript("const value = {}; value.self = value; return value"),
    ).rejects.toThrow(/circular/i)
    await expect(runJavaScript("return 1n")).rejects.toThrow(/BigInt/i)
  })

  it("exposes only a frozen tools object and disables host globals and module loading", async () => {
    const result = await runJavaScript(
      `
let importRejected = false;
try {
  await import("node:fs");
} catch {
  importRejected = true;
}

let toolsAssignmentRejected = false;
try {
  tools.echo = null;
} catch {
  toolsAssignmentRejected = true;
}

let largeTypedArrayBlocked = false;
try {
  new Uint8Array(100_000_000);
} catch (error) {
  largeTypedArrayBlocked = error instanceof ReferenceError;
}

return {
  console: typeof console,
  process: typeof process,
  Bun: typeof Bun,
  fetch: typeof fetch,
  require: typeof require,
  timer: typeof setTimeout,
  Uint8Array: typeof Uint8Array,
  ArrayBuffer: typeof ArrayBuffer,
  DataView: typeof DataView,
  SharedArrayBuffer: typeof SharedArrayBuffer,
  Atomics: typeof Atomics,
  largeTypedArrayBlocked,
  unknownTool: typeof tools.unknown,
  internalInvoke: typeof invoke,
  internalTracker: typeof unconsumedCalls,
  internalMarkConsumed: typeof markConsumed,
  importRejected,
  toolsAssignmentRejected,
  toolsFrozen: Object.isFrozen(tools),
  methodFrozen: Object.isFrozen(tools.echo),
  toolsPrototypeIsNull: Object.getPrototypeOf(tools) === null,
  leakedAnyboxGlobals: Object.getOwnPropertyNames(globalThis)
    .filter((name) => name.includes("anybox_exec")),
};
`,
    )

    expect(result).toEqual({
      console: "undefined",
      process: "undefined",
      Bun: "undefined",
      fetch: "undefined",
      require: "undefined",
      timer: "undefined",
      Uint8Array: "undefined",
      ArrayBuffer: "undefined",
      DataView: "undefined",
      SharedArrayBuffer: "undefined",
      Atomics: "undefined",
      largeTypedArrayBlocked: true,
      unknownTool: "undefined",
      internalInvoke: "undefined",
      internalTracker: "undefined",
      internalMarkConsumed: "undefined",
      importRejected: true,
      toolsAssignmentRejected: true,
      toolsFrozen: true,
      methodFrozen: true,
      toolsPrototypeIsNull: true,
      leakedAnyboxGlobals: [],
    })
  })

  it("does not leak global state between sequential or parallel executions", async () => {
    const source = `
globalThis.executionMarker = (globalThis.executionMarker ?? 0) + 1;
const echoed = await tools.echo(globalThis.executionMarker);
return { marker: globalThis.executionMarker, echoed };
`

    expect(await runJavaScript(source)).toEqual({ marker: 1, echoed: 1 })
    expect(await runJavaScript(source)).toEqual({ marker: 1, echoed: 1 })

    const parallel = await Promise.all(
      Array.from({ length: 4 }, () =>
        runJavaScript(source, {
          invokeTool: async (_name, input) => {
            await delay(5)
            return input
          },
        })),
    )

    expect(parallel).toEqual(
      Array.from({ length: 4 }, () => ({ marker: 1, echoed: 1 })),
    )
  })

  it("keeps concurrent runtimes isolated when aggregate WASM memory reaches its 48 MiB cap", async () => {
    const runFourSmallExecutions = () =>
      Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          runJavaScript(`return ${index}`)),
      )

    expect(await runFourSmallExecutions()).toEqual([0, 1, 2, 3])

    let releaseInnocent!: (value: string) => void
    let markInnocentStarted!: () => void
    const innocentStarted = new Promise<void>((resolve) => {
      markInnocentStarted = resolve
    })
    const innocentToolResult = new Promise<string>((resolve) => {
      releaseInnocent = resolve
    })
    const innocentExecution = runJavaScript(
      `return await tools.waitForHost(null)`,
      {
        toolNames: ["waitForHost"],
        invokeTool: async () => {
          markInnocentStarted()
          return await innocentToolResult
        },
      },
    )
    await innocentStarted

    try {
      await expect(
        runJavaScript(
          `
const values = [];
try {
  for (let index = 0; index < 128; index += 1) {
    values.push(
      String(index).padEnd(1024 * 1024, String(index % 10)),
    );
  }
} catch (error) {
  // QuickJS makes OOM catchable, so the Host must still detect that the
  // fixed-size WASM memory reached its maximum. Retain the allocated values so
  // the per-runtime usage check can attribute the excess to this execution.
  globalThis.retainedValues = values;
  return { caught: error.message, count: values.length };
}
return { count: values.length };
`,
          {
            toolNames: [],
            limits: {
              wallTimeoutMs: 5_000,
              cpuSliceMs: 2_000,
              // Large strings are not fully represented by QuickJS's per-runtime
              // allocator accounting. The module-level cap is the backstop.
              memoryBytes: 4 * 1024 * 1024,
            },
          },
        ),
      ).rejects.toThrow(
        "JavaScript memory usage of",
      )
    } finally {
      releaseInnocent("innocent-result")
    }

    // A concurrent execution that was merely awaiting a Host result must not
    // fail because another runtime filled the shared module's backing memory.
    expect(await innocentExecution).toBe("innocent-result")

    // Keep using the same hard-capped module. Recreating a 48 MiB module after
    // every hostile execution would itself allow repeated aggregate growth
    // before JavaScript garbage collection reclaims the old memories.
    expect(await runFourSmallExecutions()).toEqual([0, 1, 2, 3])
  })

  it("validates execution limits before creating a runtime", async () => {
    await expect(
      runJavaScript("return true", {
        limits: { cpuSliceMs: 0 },
      }),
    ).rejects.toThrow("cpuSliceMs must be a positive safe integer")

    await expect(
      runJavaScript("return true", {
        limits: { maxToolCalls: -1 },
      }),
    ).rejects.toThrow("maxToolCalls must be a non-negative safe integer")
  })
})
