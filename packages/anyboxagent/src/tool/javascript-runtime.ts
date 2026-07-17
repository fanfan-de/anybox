import type { JSONValue } from "@ai-sdk/provider"
import releaseVariant from "@jitl/quickjs-singlefile-cjs-release-sync"
import {
  DefaultIntrinsics,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  type QuickJSContext,
  type QuickJSDeferredPromise,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core"

export interface JavaScriptExecutionLimits {
  wallTimeoutMs: number
  cpuSliceMs: number
  memoryBytes: number
  maxStackBytes: number
  maxToolCalls: number
  maxToolArgumentsChars: number
  maxToolResultChars: number
  maxTotalToolResultChars: number
  maxOutputChars: number
}

export interface JavaScriptExecutionInput {
  code: string
  toolNames: readonly string[]
  signal: AbortSignal
  limits: JavaScriptExecutionLimits
  invokeTool(
    name: string,
    input: JSONValue,
  ): Promise<JSONValue>
}

const BRIDGE_GLOBAL = "__anybox_exec_invoke_7f82c8b4__"
// One cached module is shared by concurrent executions. Reserve 16 MiB for
// Emscripten/QuickJS and permit at most another 32 MiB of aggregate growth.
const WASM_INITIAL_PAGES = 256
const WASM_MAXIMUM_PAGES = 768
const RUNTIME_MEMORY_MAX_BYTES = 32 * 1024 * 1024

interface QuickJSModuleState {
  module: QuickJSWASMModule
}

interface QuickJSModuleCache {
  promise: Promise<QuickJSModuleState>
}

let quickJSModuleCache: QuickJSModuleCache | undefined

async function createQuickJSModule(): Promise<QuickJSModuleState> {
  const cappedVariant = newVariant(releaseVariant, {
    wasmMemory: async () =>
      new WebAssembly.Memory({
        initial: WASM_INITIAL_PAGES,
        maximum: WASM_MAXIMUM_PAGES,
      }),
  })
  const module = await newQuickJSWASMModuleFromVariant(cappedVariant)
  return { module }
}

function getQuickJSModule(): Promise<QuickJSModuleState> {
  if (!quickJSModuleCache) {
    const cache = {} as QuickJSModuleCache
    const loading = createQuickJSModule()
    cache.promise = loading.then(
      (state) => state,
      (error) => {
        if (quickJSModuleCache === cache) {
          quickJSModuleCache = undefined
        }
        throw error
      },
    )
    quickJSModuleCache = cache
  }

  return quickJSModuleCache.promise
}

class JavaScriptExecutionBudgetError extends Error {
  override name = "JavaScriptExecutionBudgetError"
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value

  if (value && typeof value === "object") {
    const maybeError = value as { name?: unknown; message?: unknown }
    if (typeof maybeError.message === "string") {
      const error = new Error(maybeError.message)
      if (typeof maybeError.name === "string" && maybeError.name) {
        error.name = maybeError.name
      }
      return error
    }
  }

  if (typeof value === "string" && value) return new Error(value)
  return new Error(fallback)
}

function errorMessage(error: unknown): string {
  return toError(error, "Unknown JavaScript execution error.").message
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason
  const suffix = reason === undefined
    ? ""
    : `: ${errorMessage(reason)}`
  const error = new Error(`JavaScript execution aborted${suffix}`)
  error.name = "AbortError"
  return error
}

function validateLimits(limits: JavaScriptExecutionLimits): void {
  const positive: Array<keyof JavaScriptExecutionLimits> = [
    "wallTimeoutMs",
    "cpuSliceMs",
    "memoryBytes",
    "maxStackBytes",
    "maxToolArgumentsChars",
    "maxToolResultChars",
    "maxTotalToolResultChars",
    "maxOutputChars",
  ]

  for (const name of positive) {
    const value = limits[name]
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive safe integer.`)
    }
  }

  if (!Number.isSafeInteger(limits.maxToolCalls) || limits.maxToolCalls < 0) {
    throw new TypeError("maxToolCalls must be a non-negative safe integer.")
  }
}

function serializeJSON(value: unknown, label: string): string {
  let serialized: string | undefined

  try {
    serialized = JSON.stringify(value)
  } catch (error) {
    throw new TypeError(`${label} must be JSON-serializable: ${errorMessage(error)}`)
  }

  if (serialized === undefined) {
    throw new TypeError(`${label} must be JSON-serializable.`)
  }

  return serialized
}

function buildBootstrapSource(toolNames: readonly string[]): string {
  const names = JSON.stringify(toolNames)
  const bridge = JSON.stringify(BRIDGE_GLOBAL)

  return `
(() => {
  "use strict";
  const bridgeName = ${bridge};
  const invoke = globalThis[bridgeName];
  if (typeof invoke !== "function") {
    throw new Error("Anybox exec bridge is unavailable.");
  }
  if (!delete globalThis[bridgeName] || globalThis[bridgeName] !== undefined) {
    throw new Error("Anybox exec bridge could not be hidden.");
  }

  const unconsumedCalls = new Set();
  const setAdd = Set.prototype.add;
  const setDelete = Set.prototype.delete;
  const getSetSize = Object.getOwnPropertyDescriptor(Set.prototype, "size").get;
  const apply = Reflect.apply;
  const promiseThen = Promise.prototype.then;
  const promiseCatch = Promise.prototype.catch;
  const promiseFinally = Promise.prototype.finally;
  const objectCreate = Object.create;
  const objectFreeze = Object.freeze;
  const objectDefineProperty = Object.defineProperty;
  const objectDefineProperties = Object.defineProperties;
  const jsonStringify = JSON.stringify;
  const jsonParse = JSON.parse;

  const markConsumed = (token) => {
    apply(setDelete, unconsumedCalls, [token]);
  };
  const newToken = () => {
    const token = apply(objectCreate, Object, [null]);
    apply(setAdd, unconsumedCalls, [token]);
    return token;
  };

  const trackPromise = (promise, token, clearWhenFulfilled) => {
    if (clearWhenFulfilled) {
      apply(promiseThen, promise, [
        () => {
          markConsumed(token);
        },
        () => undefined,
      ]);
    }

    const createDerived = (method, callbacks) => {
      markConsumed(token);
      const derivedToken = newToken();
      let derived;
      try {
        derived = apply(method, promise, callbacks);
      } catch (error) {
        markConsumed(derivedToken);
        throw error;
      }
      return trackPromise(derived, derivedToken, true);
    };

    const thenable = apply(objectCreate, Object, [null]);
    const then = function(onFulfilled, onRejected) {
      return createDerived(promiseThen, [onFulfilled, onRejected]);
    };
    const catchFailure = function(onRejected) {
      return createDerived(promiseCatch, [onRejected]);
    };
    const finallyCall = function(onFinally) {
      return createDerived(promiseFinally, [onFinally]);
    };
    apply(objectFreeze, Object, [then]);
    apply(objectFreeze, Object, [catchFailure]);
    apply(objectFreeze, Object, [finallyCall]);
    apply(objectDefineProperties, Object, [
      thenable,
      {
        then: {
          value: then,
          writable: false,
          configurable: false,
          enumerable: false,
        },
        catch: {
          value: catchFailure,
          writable: false,
          configurable: false,
          enumerable: false,
        },
        finally: {
          value: finallyCall,
          writable: false,
          configurable: false,
          enumerable: false,
        },
      },
    ]);
    return apply(objectFreeze, Object, [thenable]);
  };

  const toolsObject = apply(objectCreate, Object, [null]);
  for (const name of ${names}) {
    const call = function(input) {
      const token = newToken();

      let inputJSON;
      try {
        inputJSON = apply(jsonStringify, JSON, [input]);
      } catch (error) {
        markConsumed(token);
        throw error;
      }
      if (inputJSON === undefined) {
        markConsumed(token);
        throw new TypeError("Tool arguments must be JSON-serializable.");
      }

      const promise = (async () => {
        const resultJSON = await invoke(name, inputJSON);
        return apply(jsonParse, JSON, [resultJSON]);
      })();
      return trackPromise(promise, token, false);
    };
    apply(objectFreeze, Object, [call]);
    apply(objectDefineProperty, Object, [
      toolsObject,
      name,
      {
        value: call,
        writable: false,
        configurable: false,
        enumerable: true,
      },
    ]);
  }

  apply(objectFreeze, Object, [toolsObject]);
  apply(objectDefineProperty, Object, [
    globalThis,
    "tools",
    {
      value: toolsObject,
      writable: false,
      configurable: false,
      enumerable: true,
    },
  ]);

  const assertConsumed = function() {
    const count = apply(getSetSize, unconsumedCalls, []);
    if (count > 0) {
      throw new Error(
        "JavaScript execution returned with " + count
          + " unconsumed tool call(s). Await or catch every tools call before returning.",
      );
    }
  };
  return apply(objectFreeze, Object, [assertConsumed]);
})()
`
}

function buildExecutionSource(code: string): string {
  return `
(async () => {
  "use strict";
  const result = await (async () => {
    "use strict";
${code}
  })();
  if (result === undefined) {
    return "null";
  }
  const serialized = JSON.stringify(result);
  if (serialized === undefined) {
    throw new TypeError("JavaScript execution result must be JSON-serializable.");
  }
  return serialized;
})()
`
}

function isResourceFailure(error: Error): boolean {
  return /out of memory|memory limit|stack overflow|stack size|interrupted/i.test(
    `${error.name}: ${error.message}`,
  )
}

function runtimeMemoryUsedBytes(
  runtime: QuickJSRuntime,
  context: QuickJSContext,
): number {
  const usageHandle = runtime.computeMemoryUsage()
  try {
    const usage = context.dump(usageHandle)
    if (!usage || typeof usage !== "object") {
      throw new Error("QuickJS memory usage did not return an object.")
    }

    const value = (usage as Record<string, unknown>).memory_used_size
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("QuickJS memory usage did not report memory_used_size.")
    }
    return value
  } finally {
    usageHandle.dispose()
  }
}

/**
 * Executes an async JavaScript function body in a fresh, resource-limited
 * QuickJS runtime. The only host capability exposed to guest code is the
 * frozen `tools` object built from `toolNames`.
 */
export async function executeJavaScript(
  input: JavaScriptExecutionInput,
): Promise<JSONValue> {
  validateLimits(input.limits)

  const uniqueToolNames = [...new Set(input.toolNames)]
  const allowedToolNames = new Set(uniqueToolNames)
  const startedAt = Date.now()
  const wallDeadline = startedAt + input.limits.wallTimeoutMs
  const runtimeMemoryLimitBytes = Math.min(
    input.limits.memoryBytes,
    RUNTIME_MEMORY_MAX_BYTES,
  )

  let runtime: QuickJSRuntime | undefined
  let context: QuickJSContext | undefined
  let moduleState: QuickJSModuleState | undefined
  let closed = false
  let fatalError: Error | undefined
  let activeSliceDeadline: number | undefined
  let toolCallCount = 0
  let totalToolResultChars = 0
  let drainScheduled = false
  let resolvedResultPromise: ReturnType<QuickJSContext["resolvePromise"]> | undefined
  let resolvedResultConsumed = false
  let consumptionCheckHandle: QuickJSHandle | undefined
  const pendingDeferreds = new Set<QuickJSDeferredPromise>()

  let rejectFatal!: (error: Error) => void
  const fatalPromise = new Promise<never>((_, reject) => {
    rejectFatal = reject
  })
  // A fatal condition can be raised synchronously before Promise.race observes
  // this promise. Keep it handled without changing its rejected state.
  void fatalPromise.catch(() => undefined)

  const rejectDeferred = (
    deferred: QuickJSDeferredPromise,
    error: Error,
  ) => {
    if (!context?.alive || !deferred.alive) return

    const errorHandle = context.newError({
      name: error.name || "Error",
      message: error.message,
    })
    try {
      deferred.reject(errorHandle)
    } finally {
      errorHandle.dispose()
      pendingDeferreds.delete(deferred)
      deferred.dispose()
    }
  }

  const rejectOutstandingDeferreds = (error: Error) => {
    if (closed || !context?.alive) return
    for (const deferred of [...pendingDeferreds]) {
      try {
        rejectDeferred(deferred, error)
      } catch {
        pendingDeferreds.delete(deferred)
        if (deferred.alive) deferred.dispose()
      }
    }
  }

  const markFatal = (error: Error): Error => {
    if (fatalError) return fatalError

    fatalError = error
    rejectFatal(error)
    // The interrupt handler may call markFatal while QuickJS is on the stack.
    // Settle guest promises only after that stack has unwound.
    queueMicrotask(() => rejectOutstandingDeferreds(error))
    return error
  }

  const wallTimer = setTimeout(() => {
    markFatal(
      new JavaScriptExecutionBudgetError(
        `JavaScript execution exceeded the wall timeout of ${input.limits.wallTimeoutMs}ms.`,
      ),
    )
  }, input.limits.wallTimeoutMs)

  const onAbort = () => {
    markFatal(abortError(input.signal))
  }

  if (input.signal.aborted) {
    onAbort()
  } else {
    input.signal.addEventListener("abort", onAbort, { once: true })
  }

  const runGuestSlice = <T>(operation: () => T): T => {
    if (fatalError) throw fatalError

    activeSliceDeadline = Math.min(
      wallDeadline,
      Date.now() + input.limits.cpuSliceMs,
    )

    try {
      return operation()
    } catch (value) {
      if (fatalError) throw fatalError

      const error = toError(value, "QuickJS execution failed.")
      if (isResourceFailure(error)) {
        throw markFatal(
          new JavaScriptExecutionBudgetError(
            `JavaScript resource limit exceeded: ${error.message}`,
          ),
        )
      }
      throw error
    } finally {
      activeSliceDeadline = undefined
    }
  }

  const drainPendingJobs = () => {
    if (closed || fatalError || !runtime || !context?.alive) return

    runGuestSlice(() => {
      const result = runtime!.executePendingJobs(-1)
      context!.unwrapResult(result)
    })
  }

  const scheduleDrain = () => {
    if (closed || fatalError || drainScheduled) return
    drainScheduled = true

    queueMicrotask(() => {
      drainScheduled = false
      if (closed || fatalError) return

      try {
        drainPendingJobs()
      } catch (value) {
        markFatal(toError(value, "QuickJS pending job execution failed."))
      }
    })
  }

  try {
    moduleState = await Promise.race([
      getQuickJSModule(),
      fatalPromise,
    ])
    if (fatalError) throw fatalError

    runtime = moduleState.module.newRuntime()
    runtime.setMemoryLimit(runtimeMemoryLimitBytes)
    runtime.setMaxStackSize(input.limits.maxStackBytes)
    // QuickJS 0.32 surfaces heap and stack exhaustion to guest code as
    // catchable InternalError values and exposes no host-side "limit was hit"
    // flag after such an error is caught. Uncaught failures are normalized by
    // runGuestSlice. The post-execution usage check below also catches retained
    // allocations above the runtime budget. A caught stack overflow, or caught
    // OOM whose allocations have already been released, retains QuickJS's
    // native semantics.
    runtime.setInterruptHandler(() => {
      if (fatalError) return true

      if (input.signal.aborted) {
        markFatal(abortError(input.signal))
        return true
      }

      const now = Date.now()
      if (now >= wallDeadline) {
        markFatal(
          new JavaScriptExecutionBudgetError(
            `JavaScript execution exceeded the wall timeout of ${input.limits.wallTimeoutMs}ms.`,
          ),
        )
        return true
      }

      if (activeSliceDeadline !== undefined && now >= activeSliceDeadline) {
        markFatal(
          new JavaScriptExecutionBudgetError(
            `JavaScript execution exceeded the CPU slice limit of ${input.limits.cpuSliceMs}ms.`,
          ),
        )
        return true
      }

      return false
    })

    context = runtime.newContext({
      intrinsics: {
        ...DefaultIntrinsics,
        // Exec exchanges JSON only. Removing typed arrays also removes
        // ArrayBuffer/DataView and prevents guest allocations whose backing
        // storage may not be represented consistently by QuickJS heap metrics.
        TypedArrays: false,
      },
    })

    const bridgeHandle = context.newFunction(
      BRIDGE_GLOBAL,
      (nameHandle, argumentsHandle) => {
        const deferred = context!.newPromise()
        pendingDeferreds.add(deferred)

        try {
          if (closed || fatalError) {
            const error = fatalError ?? new Error("JavaScript execution is closed.")
            const errorHandle = context!.newError({
              name: error.name || "Error",
              message: error.message,
            })
            try {
              // Keep deferred.handle alive until the host callback returns.
              deferred.reject(errorHandle)
            } finally {
              errorHandle.dispose()
              queueMicrotask(() => {
                pendingDeferreds.delete(deferred)
                if (deferred.alive) deferred.dispose()
              })
            }
            return deferred.handle
          }

          const name = context!.getString(nameHandle)
          if (!allowedToolNames.has(name)) {
            throw new Error(`Tool "${name}" is not available in this JavaScript execution.`)
          }

          toolCallCount += 1
          if (toolCallCount > input.limits.maxToolCalls) {
            throw markFatal(
              new JavaScriptExecutionBudgetError(
                `JavaScript execution exceeded the tool call limit of ${input.limits.maxToolCalls}.`,
              ),
            )
          }

          const argumentsJSON = context!.getString(argumentsHandle)
          if (argumentsJSON.length > input.limits.maxToolArgumentsChars) {
            throw markFatal(
              new JavaScriptExecutionBudgetError(
                `Tool arguments exceeded the ${input.limits.maxToolArgumentsChars} character limit.`,
              ),
            )
          }

          let toolInput: JSONValue
          try {
            toolInput = JSON.parse(argumentsJSON) as JSONValue
          } catch (error) {
            throw new TypeError(`Tool arguments are not valid JSON: ${errorMessage(error)}`)
          }

          let invocation: Promise<JSONValue>
          try {
            invocation = Promise.resolve(input.invokeTool(name, toolInput))
          } catch (error) {
            invocation = Promise.reject(error)
          }

          void invocation.then(
            (value) => {
              if (closed || fatalError || !context?.alive || !deferred.alive) return

              try {
                const resultJSON = serializeJSON(value, `Result from tool "${name}"`)
                if (resultJSON.length > input.limits.maxToolResultChars) {
                  throw markFatal(
                    new JavaScriptExecutionBudgetError(
                      `Result from tool "${name}" exceeded the ${input.limits.maxToolResultChars} character limit.`,
                    ),
                  )
                }

                totalToolResultChars += resultJSON.length
                if (totalToolResultChars > input.limits.maxTotalToolResultChars) {
                  throw markFatal(
                    new JavaScriptExecutionBudgetError(
                      `Tool results exceeded the cumulative ${input.limits.maxTotalToolResultChars} character limit.`,
                    ),
                  )
                }

                const resultHandle = context.newString(resultJSON)
                try {
                  deferred.resolve(resultHandle)
                } finally {
                  resultHandle.dispose()
                  pendingDeferreds.delete(deferred)
                  deferred.dispose()
                }
                scheduleDrain()
              } catch (value) {
                const error = toError(value, `Tool "${name}" failed.`)
                rejectDeferred(deferred, error)
                scheduleDrain()
              }
            },
            (value) => {
              if (closed || fatalError || !context?.alive || !deferred.alive) return
              rejectDeferred(deferred, toError(value, `Tool "${name}" failed.`))
              scheduleDrain()
            },
          )
        } catch (value) {
          const error = toError(value, "Tool invocation failed.")
          // The callback must return the promise handle before its owning
          // deferred can be disposed.
          queueMicrotask(() => {
            if (closed || !context?.alive || !deferred.alive) return
            rejectDeferred(deferred, error)
            scheduleDrain()
          })
        }

        return deferred.handle
      },
    )

    try {
      context.setProp(context.global, BRIDGE_GLOBAL, bridgeHandle)
    } finally {
      bridgeHandle.dispose()
    }

    const bootstrapResult = runGuestSlice(() =>
      context!.evalCode(
        buildBootstrapSource(uniqueToolNames),
        "anybox-exec-bootstrap.js",
        { type: "global", strict: true },
      ),
    )
    consumptionCheckHandle = context.unwrapResult(bootstrapResult)
    if (fatalError) throw fatalError

    const evaluationResult = runGuestSlice(() =>
      context!.evalCode(
        buildExecutionSource(input.code),
        "anybox-exec.js",
        { type: "global", strict: true },
      ),
    )
    // Always unwrap the VM result before observing fatalError. In the failure
    // branch unwrapResult consumes the exception handle; skipping it after an
    // interrupt would leave the runtime with live GC objects during disposal.
    const promiseHandle = context.unwrapResult(evaluationResult)
    if (fatalError) {
      promiseHandle.dispose()
      throw fatalError
    }

    try {
      resolvedResultPromise = runGuestSlice(() => context!.resolvePromise(promiseHandle))
    } finally {
      promiseHandle.dispose()
    }

    drainPendingJobs()

    const settled = await Promise.race([
      resolvedResultPromise,
      fatalPromise,
    ])
    if (fatalError) throw fatalError

    let resultHandle
    try {
      resultHandle = runGuestSlice(() => context!.unwrapResult(settled))
    } finally {
      // unwrapResult returns the value handle on success and consumes the
      // exception handle on failure.
      resolvedResultConsumed = true
    }
    let outputJSON: string
    try {
      // The execution result may settle before observer jobs on derived tool
      // promise chains. Drain them before checking for an unconsumed or
      // rejected branch.
      drainPendingJobs()
      const consumptionResultHandle = runGuestSlice(() =>
        context!.unwrapResult(
          context!.callFunction(
            consumptionCheckHandle!,
            context!.undefined,
          ),
        ),
      )
      consumptionResultHandle.dispose()

      outputJSON = context.getString(resultHandle)
    } finally {
      resultHandle.dispose()
    }

    if (outputJSON.length > input.limits.maxOutputChars) {
      throw markFatal(
        new JavaScriptExecutionBudgetError(
          `JavaScript execution result exceeded the ${input.limits.maxOutputChars} character limit.`,
        ),
      )
    }

    let output: JSONValue
    try {
      output = JSON.parse(outputJSON) as JSONValue
    } catch (error) {
      throw new TypeError(`JavaScript execution result is not valid JSON: ${errorMessage(error)}`)
    }

    if (pendingDeferreds.size > 0) {
      throw markFatal(
        new Error(
          `JavaScript execution returned with ${pendingDeferreds.size} pending tool call(s). Await every tools call before returning.`,
        ),
      )
    }

    // QuickJS 0.32 exposes some allocator failures as catchable InternalErrors.
    // If Guest code retains allocations beyond this runtime's configured
    // budget, reject the execution even when it caught the original OOM.
    // The fixed-size module memory remains the process-level backstop for
    // allocations that QuickJS's runtime allocator does not account for.
    let memoryUsedBytes: number
    try {
      memoryUsedBytes = runtimeMemoryUsedBytes(runtime, context)
    } catch (value) {
      const error = toError(value, "Unable to inspect QuickJS memory usage.")
      if (isResourceFailure(error)) {
        throw markFatal(
          new JavaScriptExecutionBudgetError(
            `JavaScript resource limit exceeded while inspecting memory usage: ${error.message}`,
          ),
        )
      }
      throw error
    }
    if (memoryUsedBytes > runtimeMemoryLimitBytes) {
      throw markFatal(
        new JavaScriptExecutionBudgetError(
          `JavaScript memory usage of ${memoryUsedBytes} bytes exceeded the ${runtimeMemoryLimitBytes} byte limit.`,
        ),
      )
    }

    return output
  } catch (value) {
    throw fatalError ?? toError(value, "JavaScript execution failed.")
  } finally {
    clearTimeout(wallTimer)
    input.signal.removeEventListener("abort", onAbort)

    if (fatalError && runtime?.alive && context?.alive) {
      // A fatal error may win Promise.race before QuickJS has propagated the
      // rejection to the outer async function. Give already-queued cleanup
      // jobs a short, separately-interrupted slice so resolvePromise does not
      // retain a duplicated result handle past context disposal.
      const cleanupDeadline = Date.now() + Math.min(input.limits.cpuSliceMs, 50)
      runtime.setInterruptHandler(() => Date.now() >= cleanupDeadline)
      rejectOutstandingDeferreds(fatalError)
      closed = true

      try {
        if (runtime.hasPendingJob()) {
          const cleanupResult = runtime.executePendingJobs(-1)
          context.unwrapResult(cleanupResult)
        }
      } catch {
        // The execution outcome is already fatal; cleanup is best effort.
      }
    } else {
      closed = true
    }

    if (resolvedResultPromise && !resolvedResultConsumed) {
      void resolvedResultPromise.then((result) => {
        if (!resolvedResultConsumed && result.alive) {
          result.dispose()
          resolvedResultConsumed = true
        }
      })
      // Flush a result already settled by the cleanup pump before disposing
      // its owning context.
      await Promise.resolve()
    }

    for (const deferred of pendingDeferreds) {
      if (deferred.alive) {
        deferred.dispose()
      }
    }
    pendingDeferreds.clear()

    if (consumptionCheckHandle?.alive) consumptionCheckHandle.dispose()
    if (context?.alive) context.dispose()
    if (runtime?.alive) {
      runtime.removeInterruptHandler()
      runtime.dispose()
    }
  }
}
