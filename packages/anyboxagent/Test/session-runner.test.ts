import { describe, expect, it } from "bun:test"
import * as Identifier from "#id/id.ts"
import type * as Message from "#session/core/message.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import { SessionLimitError } from "#session/runtime/session-limits.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (error: unknown) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"]
  let reject!: Deferred<T>["reject"]
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

function testSessionID() {
  return Identifier.ascending("session")
}

function testDirectory() {
  return `C:\\tmp\\${Identifier.ascending("project")}`
}

function toolPart(input: {
  sessionID: string
  callID?: string
}): Message.ToolPart {
  const callID = input.callID ?? Identifier.ascending("tool")
  return {
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: Identifier.ascending("message"),
    type: "tool",
    callID,
    tool: "test-tool",
    schemaVersion: 3,
    turnID: "turn-test",
    input: { raw: "{}", value: {} },
    source: { kind: "model" },
    retry: { attempt: 1 },
    revision: 0,
    timestamps: { createdAt: 1 },
    state: { phase: "pending" },
  }
}

async function withEnv(name: string, value: string, fn: () => Promise<void>) {
  const previous = process.env[name]
  process.env[name] = value
  try {
    await fn()
  } finally {
    if (previous === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = previous
    }
  }
}

describe("session runner", () => {
  it("serializes operations for the same session", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const firstStarted = deferred()
    const firstDone = deferred()
    const order: string[] = []

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        order.push("first:start")
        firstStarted.resolve()
        await firstDone.promise
        order.push("first:end")
        return "first"
      },
    })
    expect(first.mode).toBe("new-turn")

    await firstStarted.promise

    const second = SessionRunner.enqueueResume({
      sessionID,
      directory,
      type: "resume",
      execute: async () => {
        order.push("second:start")
        return "second"
      },
    })

    expect(second.mode).toBe("queued")
    expect(SessionRunner.info(sessionID)?.queueLength).toBe(1)
    expect(order).toEqual(["first:start"])

    firstDone.resolve()

    await expect(first.promise).resolves.toBe("first")
    await expect(second.promise).resolves.toBe("second")
    await SessionRunner.waitForIdle(sessionID)

    expect(order).toEqual(["first:start", "first:end", "second:start"])
    expect(SessionRunner.info(sessionID)?.status).toBe("idle")
  })

  it("runs different sessions concurrently", async () => {
    const firstSessionID = testSessionID()
    const secondSessionID = testSessionID()
    const directory = testDirectory()
    const firstStarted = deferred()
    const secondStarted = deferred()
    const releaseBoth = deferred()
    const order: string[] = []

    const first = SessionRunner.enqueuePrompt({
      sessionID: firstSessionID,
      directory,
      type: "prompt",
      execute: async () => {
        order.push("first:start")
        firstStarted.resolve()
        await releaseBoth.promise
        return "first"
      },
    })
    const second = SessionRunner.enqueuePrompt({
      sessionID: secondSessionID,
      directory: `${directory}-other`,
      type: "prompt",
      execute: async () => {
        order.push("second:start")
        secondStarted.resolve()
        await releaseBoth.promise
        return "second"
      },
    })

    await Promise.all([firstStarted.promise, secondStarted.promise])

    expect(first.mode).toBe("new-turn")
    expect(second.mode).toBe("new-turn")
    expect(order).toEqual(["first:start", "second:start"])

    releaseBoth.resolve()

    await expect(first.promise).resolves.toBe("first")
    await expect(second.promise).resolves.toBe("second")
    await Promise.all([
      SessionRunner.waitForIdle(firstSessionID),
      SessionRunner.waitForIdle(secondSessionID),
    ])
  })

  it("resynchronizes an idle active execution after the active branch changes", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const observedHeads: Array<string | null> = []

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      executionID: "active-thread",
      targetKind: "active-thread",
      initialHeadMessageID: "old-active-head",
      type: "prompt",
      execute: async (runtime) => {
        observedHeads.push(runtime.headMessageID())
        runtime.updateHeadMessageID("first-response")
      },
    })
    await first.promise
    await SessionRunner.waitForIdle(sessionID)

    const second = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      executionID: "active-thread",
      targetKind: "active-thread",
      initialHeadMessageID: "switched-active-head",
      type: "prompt",
      execute: async (runtime) => {
        observedHeads.push(runtime.headMessageID())
      },
    })
    await second.promise
    await SessionRunner.waitForIdle(sessionID)

    expect(observedHeads).toEqual(["old-active-head", "switched-active-head"])
  })

  it("runs detached executions for the same session concurrently and cancels one precisely", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const firstStarted = deferred<SessionRunner.PromptRuntime>()
    const secondStarted = deferred<SessionRunner.PromptRuntime>()
    const firstAborted = deferred()
    const releaseBoth = deferred()
    let secondWasAborted = false

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      executionID: "branch-one",
      targetKind: "detached-branch",
      initialHeadMessageID: "anchor-one",
      type: "prompt",
      execute: async (runtime) => {
        firstStarted.resolve(runtime)
        runtime.abort.addEventListener("abort", () => firstAborted.resolve(), { once: true })
        await releaseBoth.promise
        return "first"
      },
    })
    const second = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      executionID: "branch-two",
      targetKind: "detached-branch",
      initialHeadMessageID: "anchor-two",
      type: "prompt",
      execute: async (runtime) => {
        secondStarted.resolve(runtime)
        runtime.abort.addEventListener("abort", () => {
          secondWasAborted = true
        }, { once: true })
        await releaseBoth.promise
        return "second"
      },
    })

    const [firstRuntime, secondRuntime] = await Promise.all([firstStarted.promise, secondStarted.promise])
    expect(first.mode).toBe("new-turn")
    expect(second.mode).toBe("new-turn")
    expect(firstRuntime.headMessageID()).toBe("anchor-one")
    expect(secondRuntime.headMessageID()).toBe("anchor-two")
    expect(SessionRunner.snapshot().filter((item) => item.sessionID === sessionID)).toHaveLength(2)

    expect(SessionRunner.cancelExecution(sessionID, "branch-one")).toMatchObject({
      executionID: "branch-one",
      activeCancelled: true,
      cancelled: true,
    })
    await firstAborted.promise
    expect(secondWasAborted).toBe(false)
    expect(SessionRunner.infoForExecution(sessionID, "branch-two")?.status).toBe("running")

    releaseBoth.resolve()
    await expect(first.promise).resolves.toBe("first")
    await expect(second.promise).resolves.toBe("second")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("queues a detached execution until global running capacity becomes available", async () => {
    await withEnv("ANYBOX_SESSION_MAX_RUNNING", "1", async () => {
      const sessionID = testSessionID()
      const directory = testDirectory()
      const mainStarted = deferred()
      const releaseMain = deferred()
      const branchStarted = deferred<SessionRunner.PromptRuntime>()

      const main = SessionRunner.enqueuePrompt({
        sessionID,
        directory,
        executionID: "active-thread",
        targetKind: "active-thread",
        initialHeadMessageID: "main-head",
        type: "prompt",
        execute: async () => {
          mainStarted.resolve()
          await releaseMain.promise
          return "main"
        },
      })
      await mainStarted.promise

      const branch = SessionRunner.enqueuePrompt({
        sessionID,
        directory,
        executionID: "capacity-queued-branch",
        targetKind: "detached-branch",
        initialHeadMessageID: "branch-anchor",
        type: "prompt",
        execute: async (runtime) => {
          branchStarted.resolve(runtime)
          return "branch"
        },
      })

      expect(branch.mode).toBe("queued")
      expect(SessionRunner.infoForExecution(sessionID, "capacity-queued-branch")).toMatchObject({
        headMessageID: "branch-anchor",
        queueLength: 1,
      })

      releaseMain.resolve()
      await expect(main.promise).resolves.toBe("main")
      const branchRuntime = await branchStarted.promise
      expect(branchRuntime.headMessageID()).toBe("branch-anchor")
      await expect(branch.promise).resolves.toBe("branch")
      await SessionRunner.waitForIdle(sessionID)
    })
  })

  it("waits for idle with a promise instead of polling callers", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const started = deferred()
    const finish = deferred()
    let idleResolved = false

    SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        started.resolve()
        await finish.promise
        return "done"
      },
    })

    await started.promise
    const wait = SessionRunner.waitForIdle(sessionID).then(() => {
      idleResolved = true
    })

    await Promise.resolve()
    expect(idleResolved).toBe(false)

    finish.resolve()
    await wait

    expect(idleResolved).toBe(true)
  })

  it("keeps queued operations after cancel and runs them after the active operation finishes", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const started = deferred<SessionRunner.PromptRuntime>()
    const sawAbort = deferred()
    const finishFirst = deferred()
    const secondStarted = deferred()

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async (runtime) => {
        started.resolve(runtime)
        runtime.abort.addEventListener("abort", () => {
          sawAbort.resolve()
        }, { once: true })
        await finishFirst.promise
        return "first"
      },
    })

    await started.promise

    const second = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        secondStarted.resolve()
        return "second"
      },
    })

    expect(second.mode).toBe("queued")
    expect(SessionRunner.cancel(sessionID)).toBe(true)
    expect(SessionRunner.info(sessionID)?.status).toBe("cancelling")

    await sawAbort.promise
    expect(SessionRunner.info(sessionID)?.queueLength).toBe(1)

    finishFirst.resolve()

    await expect(first.promise).resolves.toBe("first")
    await secondStarted.promise
    await expect(second.promise).resolves.toBe("second")
    await SessionRunner.waitForIdle(sessionID)

    expect(SessionRunner.info(sessionID)?.status).toBe("idle")
  })

  it("cancels queued operations when session cancel requests queued work", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const started = deferred()
    const finish = deferred()

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        started.resolve()
        await finish.promise
        return "first"
      },
    })

    await started.promise

    const second = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => "second",
    })

    expect(second.mode).toBe("queued")
    const result = SessionRunner.cancelSession(sessionID, { cancelQueued: true })
    expect(result).toMatchObject({
      sessionID,
      activeCancelled: true,
      queuedCancelled: 1,
      cancelled: true,
    })
    expect(SessionRunner.info(sessionID)?.queueLength).toBe(0)
    await expect(second.promise).rejects.toThrow("cancelled before it started")

    finish.resolve()
    await expect(first.promise).resolves.toBe("first")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("removes a queued operation when its handle is cancelled", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const started = deferred()
    const finish = deferred()

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        started.resolve()
        await finish.promise
        return "first"
      },
    })

    await started.promise

    const second = SessionRunner.enqueueResume({
      sessionID,
      directory,
      type: "resume",
      execute: async () => "second",
    })

    expect(second.mode).toBe("queued")
    expect(SessionRunner.info(sessionID)?.queueLength).toBe(1)

    second.cancel()

    await expect(second.promise).rejects.toThrow("cancelled before it started")
    expect(SessionRunner.info(sessionID)?.queueLength).toBe(0)

    finish.resolve()
    await expect(first.promise).resolves.toBe("first")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("creates a priority continuation turn for active steerable prompt turns", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const activeStarted = deferred()
    const finishFirst = deferred()
    const secondStarted = deferred()

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async (runtime) => {
        const turn = Orchestrator.startTurn({
          sessionID,
          turnID: runtime.turnID,
          steerable: true,
        })
        activeStarted.resolve()
        try {
          await finishFirst.promise
          return "first"
        } finally {
          Orchestrator.finishTurn(turn)
        }
      },
    })

    await activeStarted.promise

    const steer = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      allowSteer: true,
      execute: async () => {
        secondStarted.resolve()
        return "second"
      },
    })

    expect(steer.mode).toBe("steer")
    expect(steer.turnID).not.toBe(first.turnID)
    expect(SessionRunner.info(sessionID)).toMatchObject({
      activeTurnID: first.turnID,
      pendingSteerCount: 1,
      queueLength: 1,
    })

    await expect(SessionRunner.consumePendingSteer(sessionID, first.turnID)).resolves.toBe(1)
    expect(SessionRunner.info(sessionID)).toMatchObject({
      activeTurnID: first.turnID,
      pendingSteerCount: 0,
      queueLength: 1,
    })

    finishFirst.resolve()

    await expect(first.promise).resolves.toBe("first")
    await secondStarted.promise
    await expect(steer.promise).resolves.toBe("second")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("queues prompt input by default while the active turn is steerable", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const activeStarted = deferred()
    const finishFirst = deferred()
    const secondStarted = deferred()

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async (runtime) => {
        const turn = Orchestrator.startTurn({
          sessionID,
          turnID: runtime.turnID,
          steerable: true,
        })
        activeStarted.resolve()
        try {
          await finishFirst.promise
          return "first"
        } finally {
          Orchestrator.finishTurn(turn)
        }
      },
    })

    await activeStarted.promise

    const second = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        secondStarted.resolve()
        return "second"
      },
    })

    expect(second.mode).toBe("queued")
    expect(SessionRunner.info(sessionID)?.queueLength).toBe(1)

    finishFirst.resolve()

    await expect(first.promise).resolves.toBe("first")
    await secondStarted.promise
    await expect(second.promise).resolves.toBe("second")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("accepts steer handoff while the active turn is preparing and running tool input", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const activeStarted = deferred<Orchestrator.TurnContext>()
    const finish = deferred()
    const part = toolPart({ sessionID })

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async (runtime) => {
        const turn = Orchestrator.startTurn({
          sessionID,
          turnID: runtime.turnID,
          steerable: true,
        })
        turn.emit("tool.call.created", { part })
        activeStarted.resolve(turn)
        try {
          await finish.promise
          return "first"
        } finally {
          Orchestrator.finishTurn(turn)
        }
      },
    })

    const turn = await activeStarted.promise
    expect(turn.concurrentInputDisposition()).toBe("interrupt")

    const queued = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => "queued",
    })

    expect(queued.mode).toBe("queued")
    queued.cancel()
    await expect(queued.promise).rejects.toThrow("cancelled before it started")

    const pendingSteer = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      allowSteer: true,
      execute: async () => "pending-steer",
    })

    expect(pendingSteer.mode).toBe("steer")
    expect(pendingSteer.turnID).not.toBe(first.turnID)

    turn.emit("tool.call.phase_changed", {
      part: {
        ...part,
        revision: 1,
        timestamps: { ...part.timestamps, startedAt: Date.now() },
        state: { phase: "running" },
      },
      previousPhase: "pending",
    })
    expect(turn.concurrentInputDisposition()).toBe("steer")

    const runningSteer = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      allowSteer: true,
      execute: async () => "steered",
    })

    expect(runningSteer.mode).toBe("steer")
    expect(runningSteer.turnID).not.toBe(first.turnID)
    expect(runningSteer.turnID).not.toBe(pendingSteer.turnID)

    const approvalPart = toolPart({ sessionID })
    turn.emit("tool.call.created", { part: approvalPart })
    turn.emit("tool.call.phase_changed", {
      part: {
        ...approvalPart,
        revision: 1,
        timestamps: { ...approvalPart.timestamps, approvalRequestedAt: Date.now() },
        state: { phase: "waiting-approval", approval: { id: "approval-test" } },
      },
      previousPhase: "pending",
    })
    expect(turn.concurrentInputDisposition()).toBe("steer")

    const approvalSteer = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      allowSteer: true,
      execute: async () => "approval-steer",
    })

    expect(approvalSteer.mode).toBe("steer")
    expect(approvalSteer.turnID).not.toBe(first.turnID)
    expect(approvalSteer.turnID).not.toBe(pendingSteer.turnID)
    expect(approvalSteer.turnID).not.toBe(runningSteer.turnID)
    await expect(SessionRunner.consumePendingSteer(sessionID, first.turnID)).resolves.toBe(3)

    finish.resolve()

    await expect(first.promise).resolves.toBe("first")
    await expect(pendingSteer.promise).resolves.toBe("pending-steer")
    await expect(runningSteer.promise).resolves.toBe("steered")
    await expect(approvalSteer.promise).resolves.toBe("approval-steer")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("releases pending steer handoff when a queued steer turn is cancelled", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const activeStarted = deferred()
    const finish = deferred()

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async (runtime) => {
        const turn = Orchestrator.startTurn({
          sessionID,
          turnID: runtime.turnID,
          steerable: true,
        })
        activeStarted.resolve()
        try {
          await finish.promise
          return "first"
        } finally {
          Orchestrator.finishTurn(turn)
        }
      },
    })

    await activeStarted.promise

    const steer = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      allowSteer: true,
      execute: async () => "second",
    })

    expect(steer.mode).toBe("steer")
    expect(SessionRunner.info(sessionID)).toMatchObject({
      activeTurnID: first.turnID,
      pendingSteerCount: 1,
      queueLength: 1,
    })

    steer.cancel()
    await expect(steer.promise).rejects.toThrow("cancelled before it started")

    expect(SessionRunner.info(sessionID)).toMatchObject({
      activeTurnID: first.turnID,
      pendingSteerCount: 0,
      queueLength: 0,
    })
    await expect(SessionRunner.consumePendingSteer(sessionID, first.turnID)).resolves.toBe(0)

    finish.resolve()
    await expect(first.promise).resolves.toBe("first")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("prioritizes steer continuation turns before normal queued input in arrival order", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const activeStarted = deferred()
    const finishFirst = deferred()
    const order: string[] = []

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async (runtime) => {
        const turn = Orchestrator.startTurn({
          sessionID,
          turnID: runtime.turnID,
          steerable: true,
        })
        order.push("active:start")
        activeStarted.resolve()
        try {
          await finishFirst.promise
          order.push("active:end")
          return "first"
        } finally {
          Orchestrator.finishTurn(turn)
        }
      },
    })

    await activeStarted.promise

    const normalQueued = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        order.push("normal")
        return "normal"
      },
    })
    expect(normalQueued.mode).toBe("queued")

    const firstSteer = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      allowSteer: true,
      execute: async () => {
        order.push("steer:1")
        return "steer:1"
      },
    })
    const secondSteer = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      allowSteer: true,
      execute: async () => {
        order.push("steer:2")
        return "steer:2"
      },
    })

    expect(firstSteer.mode).toBe("steer")
    expect(secondSteer.mode).toBe("steer")
    expect(SessionRunner.info(sessionID)).toMatchObject({
      pendingSteerCount: 2,
      queueLength: 3,
    })
    await expect(SessionRunner.consumePendingSteer(sessionID, first.turnID)).resolves.toBe(2)

    finishFirst.resolve()

    await expect(first.promise).resolves.toBe("first")
    await expect(firstSteer.promise).resolves.toBe("steer:1")
    await expect(secondSteer.promise).resolves.toBe("steer:2")
    await expect(normalQueued.promise).resolves.toBe("normal")
    await SessionRunner.waitForIdle(sessionID)

    expect(order).toEqual(["active:start", "active:end", "steer:1", "steer:2", "normal"])
  })

  it("queues prompt input when the active turn is not steerable", async () => {
    const sessionID = testSessionID()
    const directory = testDirectory()
    const activeStarted = deferred()
    const finishFirst = deferred()
    const secondStarted = deferred()

    const first = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async (runtime) => {
        const turn = Orchestrator.startTurn({
          sessionID,
          turnID: runtime.turnID,
          steerable: false,
        })
        activeStarted.resolve()
        try {
          await finishFirst.promise
          return "first"
        } finally {
          Orchestrator.finishTurn(turn)
        }
      },
    })

    await activeStarted.promise

    const second = SessionRunner.enqueuePrompt({
      sessionID,
      directory,
      type: "prompt",
      execute: async () => {
        secondStarted.resolve()
        return "second"
      },
    })

    expect(second.mode).toBe("queued")
    expect(SessionRunner.info(sessionID)?.queueLength).toBe(1)

    finishFirst.resolve()

    await expect(first.promise).resolves.toBe("first")
    await secondStarted.promise
    await expect(second.promise).resolves.toBe("second")
    await SessionRunner.waitForIdle(sessionID)
  })

  it("rejects enqueues that exceed the per-session queue limit", async () => {
    await withEnv("ANYBOX_SESSION_MAX_QUEUE_OPS", "1", async () => {
      const sessionID = testSessionID()
      const directory = testDirectory()
      const started = deferred()
      const finish = deferred()

      const first = SessionRunner.enqueuePrompt({
        sessionID,
        directory,
        type: "prompt",
        execute: async () => {
          started.resolve()
          await finish.promise
          return "first"
        },
      })

      await started.promise

      const second = SessionRunner.enqueueResume({
        sessionID,
        directory,
        type: "resume",
        execute: async () => "second",
      })

      expect(second.mode).toBe("queued")
      expect(() => SessionRunner.enqueueResume({
        sessionID,
        directory,
        type: "resume",
        execute: async () => "third",
      })).toThrow(SessionLimitError)

      second.cancel()
      await expect(second.promise).rejects.toThrow("cancelled before it started")

      finish.resolve()
      await expect(first.promise).resolves.toBe("first")
      await SessionRunner.waitForIdle(sessionID)
    })
  })

  it("rejects a new running session when the global concurrency limit is reached", async () => {
    await withEnv("ANYBOX_SESSION_MAX_RUNNING", "1", async () => {
      const directory = testDirectory()
      const firstSessionID = testSessionID()
      const secondSessionID = testSessionID()
      const started = deferred()
      const finish = deferred()

      const first = SessionRunner.enqueuePrompt({
        sessionID: firstSessionID,
        directory,
        type: "prompt",
        execute: async () => {
          started.resolve()
          await finish.promise
          return "first"
        },
      })

      await started.promise

      const second = SessionRunner.enqueuePrompt({
        sessionID: secondSessionID,
        directory: `${directory}-other`,
        type: "prompt",
        execute: async () => "second",
      })

      await expect(second.promise).rejects.toMatchObject({
        code: "SESSION_GLOBAL_CONCURRENCY_LIMIT",
      })

      finish.resolve()
      await expect(first.promise).resolves.toBe("first")
      await Promise.all([
        SessionRunner.waitForIdle(firstSessionID),
        SessionRunner.waitForIdle(secondSessionID),
      ])
    })
  })

  it("rejects a new running session when the per-directory concurrency limit is reached", async () => {
    await withEnv("ANYBOX_SESSION_MAX_RUNNING", "10", async () => {
      await withEnv("ANYBOX_SESSION_MAX_RUNNING_PER_DIRECTORY", "1", async () => {
        const directory = testDirectory()
        const firstSessionID = testSessionID()
        const secondSessionID = testSessionID()
        const started = deferred()
        const finish = deferred()

        const first = SessionRunner.enqueuePrompt({
          sessionID: firstSessionID,
          directory,
          type: "prompt",
          execute: async () => {
            started.resolve()
            await finish.promise
            return "first"
          },
        })

        await started.promise

        const second = SessionRunner.enqueuePrompt({
          sessionID: secondSessionID,
          directory,
          type: "prompt",
          execute: async () => "second",
        })

        await expect(second.promise).rejects.toMatchObject({
          code: "SESSION_DIRECTORY_CONCURRENCY_LIMIT",
        })

        finish.resolve()
        await expect(first.promise).resolves.toBe("first")
        await Promise.all([
          SessionRunner.waitForIdle(firstSessionID),
          SessionRunner.waitForIdle(secondSessionID),
        ])
      })
    })
  })
})
