import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EvalSuite } from "#eval/schema.ts"
import { createStaticExecutor } from "#eval/executor.ts"
import { loadEvalSuite } from "#eval/loader.ts"
import { createJsonReport, createMarkdownReport } from "#eval/report.ts"
import { runEvalSuite } from "#eval/runner.ts"
import { scoreCase } from "#eval/scorer.ts"

describe("agent eval", () => {
  it("parses suite defaults", () => {
    const suite = EvalSuite.parse({
      id: "suite",
      cases: [
        {
          id: "case",
          input: {
            prompt: "hello",
          },
        },
      ],
    })

    expect(suite.concurrency).toBe(1)
    expect(suite.repetitions).toBe(1)
    expect(suite.defaultThreshold).toBe(1)
    expect(suite.cases[0]?.assertions).toEqual([])
    expect(suite.cases[0]?.threshold).toBeUndefined()
  })

  it("scores deterministic assertions", async () => {
    const testCase = EvalSuite.parse({
      id: "suite",
      cases: [
        {
          id: "case",
          input: {
            prompt: "hello",
          },
          assertions: [
            {
              type: "status",
              value: "completed",
            },
            {
              type: "output_contains",
              value: "answer",
            },
            {
              type: "output_not_contains",
              value: "forbidden",
            },
            {
              type: "output_regex",
              pattern: "answer\\s+42",
            },
            {
              type: "tool_called",
              name: "read_file",
            },
            {
              type: "tool_not_called",
              name: "delete_file",
            },
            {
              type: "metadata_equals",
              path: "nested.value",
              value: 10,
            },
            {
              type: "latency_under_ms",
              maxMs: 100,
            },
          ],
        },
      ],
    }).cases[0]!

    const score = await scoreCase(testCase, {
      outputText: "The answer 42 is here.",
      status: "completed",
      startedAt: 10,
      endedAt: 20,
      toolCalls: [
        {
          name: "read_file",
          phase: "settled",
          outcome: "returned",
          result: "success",
          completeness: "complete",
        },
      ],
      metadata: {
        nested: {
          value: 10,
        },
      },
    })

    expect(score.passed).toBe(true)
    expect(score.score).toBe(1)
  })

  it("supports custom scorers", async () => {
    const testCase = EvalSuite.parse({
      id: "suite",
      cases: [
        {
          id: "case",
          input: {
            prompt: "hello",
          },
          assertions: [
            {
              type: "custom",
              name: "semantic",
              config: {
                min: 0.8,
              },
            },
          ],
        },
      ],
    }).cases[0]!

    const score = await scoreCase(
      testCase,
      {
        outputText: "good answer",
        status: "completed",
        startedAt: 0,
        endedAt: 1,
      },
      {
        customScorers: [
          ({ assertion }) =>
            assertion.type === "custom" && assertion.name === "semantic"
              ? {
                  assertion,
                  passed: true,
                  score: 1,
                  weight: assertion.weight,
                  message: "semantic judge passed",
                }
              : undefined,
        ],
      },
    )

    expect(score.passed).toBe(true)
    expect(score.assertionResults[0]?.message).toBe("semantic judge passed")
  })

  it("runs suites with repetitions and aggregation", async () => {
    const suite = EvalSuite.parse({
      id: "suite",
      concurrency: 2,
      repetitions: 2,
      defaultThreshold: 0.5,
      cases: [
        {
          id: "case-a",
          tags: ["smoke"],
          input: {
            prompt: "hello",
          },
          assertions: [
            {
              type: "output_contains",
              value: "ok",
            },
          ],
        },
        {
          id: "case-b",
          tags: ["skip"],
          input: {
            prompt: "hello",
          },
          assertions: [
            {
              type: "output_contains",
              value: "ok",
            },
          ],
        },
      ],
    })

    const result = await runEvalSuite(
      suite,
      createStaticExecutor({
        "case-a": "ok",
        "case-b": "ok",
      }),
      {
        tags: ["smoke"],
      },
    )

    expect(result.passed).toBe(true)
    expect(result.totalCases).toBe(1)
    expect(result.results[0]?.threshold).toBe(0.5)
    expect(result.results[0]?.repetitions).toHaveLength(2)
  })

  it("loads json and jsonl suites", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-eval-test-"))
    try {
      const jsonPath = path.join(root, "suite.json")
      const jsonlPath = path.join(root, "suite.jsonl")
      await writeFile(jsonPath, JSON.stringify({
        id: "json-suite",
        cases: [
          {
            id: "case",
            input: {
              prompt: "hello",
            },
          },
        ],
      }))
      await writeFile(jsonlPath, JSON.stringify({
        id: "jsonl-case",
        input: {
          prompt: "hello",
        },
      }) + "\n")

      const jsonSuite = await loadEvalSuite(jsonPath)
      const jsonlSuite = await loadEvalSuite(jsonlPath)

      expect(jsonSuite.id).toBe("json-suite")
      expect(jsonlSuite.id).toBe("suite")
      expect(jsonlSuite.cases[0]?.id).toBe("jsonl-case")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("creates markdown and json reports", async () => {
    const suite = EvalSuite.parse({
      id: "suite",
      cases: [
        {
          id: "case",
          input: {
            prompt: "hello",
          },
          assertions: [
            {
              type: "output_contains",
              value: "ok",
            },
          ],
        },
      ],
    })
    const result = await runEvalSuite(suite, createStaticExecutor({ case: "ok" }))

    expect(createMarkdownReport(result)).toContain("Eval Report")
    expect(JSON.parse(createJsonReport(result)).suiteID).toBe("suite")
  })
})
