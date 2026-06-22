import { afterEach, describe, expect, it } from "bun:test"
import { generateGitCommitMessage, internal as CommitMessageInternal, setRuntimeDependenciesForTesting as setCommitMessageRuntimeDependenciesForTesting } from "./commit-message.ts"
import { buildGitCommitMessageContext, createGitPullRequest, getGitCapabilities } from "./git.ts"
import * as Provider from "#provider/provider.ts"

type CommandResult = {
  stdout?: string
  stderr?: string
  exitCode?: number
}

type CommandCall = {
  binary: string
  args: string[]
  env: Record<string, string | undefined>
}

const originalWhich = Bun.which
const originalSpawn = Bun.spawn

afterEach(() => {
  ;(Bun as unknown as { which: typeof Bun.which }).which = originalWhich
  ;(Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn
})

function installCommandMock(results: Record<string, CommandResult>) {
  const calls: CommandCall[] = []

  ;(Bun as unknown as { which: (name: string) => string | null }).which = (name: string) => {
    if (name.startsWith("git")) return "git"
    if (name.startsWith("gh")) return "gh"
    return null
  }
  ;(Bun as unknown as { spawn: (command: string[], options: { env?: Record<string, string | undefined> }) => unknown }).spawn = (
    command,
    options,
  ) => {
    const [binary = "", ...args] = command
    const key = `${binary} ${args.join(" ")}`
    const result = results[key]
    if (!result) {
      throw new Error(`Unexpected command: ${key}`)
    }

    calls.push({
      binary,
      args,
      env: options.env ?? {},
    })

    return {
      stdout: new Response(result.stdout ?? "").body,
      stderr: new Response(result.stderr ?? "").body,
      exited: Promise.resolve(result.exitCode ?? 0),
    }
  }

  return calls
}

function localPrReadyCommands(overrides?: Record<string, CommandResult>) {
  return {
    "git rev-parse --show-toplevel": {
      stdout: "C:\\Projects\\Atlas",
    },
    "git symbolic-ref --quiet --short HEAD": {
      stdout: "feature/git-menu",
    },
    "git rev-parse --verify HEAD": {
      stdout: "abc123",
    },
    "git diff --cached --name-only": {
      stdout: "",
    },
    "git status --porcelain": {
      stdout: " M src/App.tsx",
    },
    "git rev-parse --abbrev-ref --symbolic-full-name @{upstream}": {
      stdout: "origin/feature/git-menu",
    },
    "git rev-list --left-right --count @{upstream}...HEAD": {
      stdout: "0\t1",
    },
    "git symbolic-ref --short refs/remotes/origin/HEAD": {
      stdout: "origin/main",
    },
    ...overrides,
  }
}

describe("git capabilities", () => {
  it("keeps default capability checks local and disables optional git locks for status reads", async () => {
    const calls = installCommandMock(localPrReadyCommands())

    const capabilities = await getGitCapabilities("C:\\Projects\\Atlas\\client")

    expect(capabilities.canCreatePullRequest.enabled).toBe(true)
    expect(calls.some((call) => call.binary === "gh")).toBe(false)
    expect(calls.find((call) => call.args.join(" ") === "diff --cached --name-only")?.env.GIT_OPTIONAL_LOCKS).toBe("0")
    expect(calls.find((call) => call.args.join(" ") === "status --porcelain")?.env.GIT_OPTIONAL_LOCKS).toBe("0")
  })

  it("runs GitHub CLI checks only when remote pull request checks are requested", async () => {
    const calls = installCommandMock(localPrReadyCommands({
      "gh repo view --json url": {
        stdout: "{\"url\":\"https://github.com/example/repo\"}",
      },
      "gh pr list --head feature/git-menu --state open --json url": {
        stdout: "[]",
      },
    }))

    const capabilities = await getGitCapabilities("C:\\Projects\\Atlas\\client", {
      includePullRequestRemoteCheck: true,
    })

    expect(capabilities.canCreatePullRequest.enabled).toBe(true)
    expect(calls.filter((call) => call.binary === "gh").map((call) => call.args.join(" "))).toEqual([
      "repo view --json url",
      "pr list --head feature/git-menu --state open --json url",
    ])
  })

  it("uses remote pull request validation before creating pull requests", async () => {
    const calls = installCommandMock(localPrReadyCommands({
      "gh repo view --json url": {
        stdout: "{\"url\":\"https://github.com/example/repo\"}",
      },
      "gh pr list --head feature/git-menu --state open --json url": {
        stdout: "[{\"url\":\"https://github.com/example/repo/pull/1\"}]",
      },
    }))

    await expect(createGitPullRequest("C:\\Projects\\Atlas\\client")).rejects.toThrow(
      "An open pull request already exists for this branch.",
    )
    expect(calls.some((call) => call.args.join(" ") === "pr create --fill --base main")).toBe(false)
  })
})

describe("git commit message context", () => {
  it("builds staged-only commit message context without reading unstaged changes", async () => {
    const calls = installCommandMock({
      "git rev-parse --show-toplevel": {
        stdout: "C:\\Projects\\Atlas",
      },
      "git diff --cached --stat": {
        stdout: "src/App.tsx | 2 ++",
      },
      "git diff --cached": {
        stdout: "diff --git a/src/App.tsx b/src/App.tsx\n+const ready = true",
      },
    })

    const context = await buildGitCommitMessageContext("C:\\Projects\\Atlas\\client")

    expect(context.stageAll).toBe(false)
    expect(context.content).toContain("Scope: staged changes only")
    expect(context.content).toContain("src/App.tsx | 2 ++")
    expect(context.content).not.toContain("Unstaged")
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "rev-parse --show-toplevel",
      "diff --cached --stat",
      "diff --cached",
    ])
  })

  it("includes unstaged status and patch context for stage-all generation", async () => {
    const calls = installCommandMock({
      "git rev-parse --show-toplevel": {
        stdout: "C:\\Projects\\Atlas",
      },
      "git diff --cached --stat": {
        stdout: "src/staged.ts | 1 +",
      },
      "git diff --cached": {
        stdout: "diff --git a/src/staged.ts b/src/staged.ts\n+export const staged = true",
      },
      "git status --porcelain": {
        stdout: " M src/unstaged.ts\n?? src/new-file.ts",
      },
      "git diff --stat": {
        stdout: "src/unstaged.ts | 1 +",
      },
      "git diff": {
        stdout: "diff --git a/src/unstaged.ts b/src/unstaged.ts\n+export const unstaged = true",
      },
    })

    const context = await buildGitCommitMessageContext("C:\\Projects\\Atlas\\client", {
      stageAll: true,
    })

    expect(context.stageAll).toBe(true)
    expect(context.content).toContain("Scope: staged and unstaged local changes")
    expect(context.content).toContain("src/staged.ts")
    expect(context.content).toContain("src/unstaged.ts")
    expect(context.content).toContain("?? src/new-file.ts")
    expect(calls.map((call) => call.args.join(" "))).toEqual([
      "rev-parse --show-toplevel",
      "diff --cached --stat",
      "diff --cached",
      "status --porcelain",
      "diff --stat",
      "diff",
    ])
  })

  it("rejects commit message context generation when the selected scope has no changes", async () => {
    installCommandMock({
      "git rev-parse --show-toplevel": {
        stdout: "C:\\Projects\\Atlas",
      },
      "git diff --cached --stat": {
        stdout: "",
      },
      "git diff --cached": {
        stdout: "",
      },
    })

    await expect(buildGitCommitMessageContext("C:\\Projects\\Atlas\\client")).rejects.toThrow(
      "There are no staged changes to summarize.",
    )
  })
})

describe("git commit message generation", () => {
  it("normalizes model output to a single commit subject", async () => {
    const restore = setCommitMessageRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      getGenerateText: async () => async () => ({
        text: "\"feat: add generated commit messages\"\n\nExtra body.",
      }) as never,
    })

    try {
      const result = await generateGitCommitMessage({
        projectID: "project-atlas",
        model: Provider.testDeepSeekModel,
        systemPrompt: "Write one concise Git commit subject.",
        context: {
          directory: "C:\\Projects\\Atlas\\client",
          root: "C:\\Projects\\Atlas",
          stageAll: true,
          content: "src/App.tsx | 2 ++",
          truncated: false,
        },
      })

      expect(result.message).toBe("feat: add generated commit messages")
    } finally {
      restore()
    }
  })

  it("rejects empty generated commit messages", async () => {
    const restore = setCommitMessageRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      getGenerateText: async () => async () => ({
        text: "```",
      }) as never,
    })

    try {
      await expect(generateGitCommitMessage({
        projectID: "project-atlas",
        model: Provider.testDeepSeekModel,
        systemPrompt: "Write one concise Git commit subject.",
        context: {
          directory: "C:\\Projects\\Atlas\\client",
          root: "C:\\Projects\\Atlas",
          stageAll: false,
          content: "src/App.tsx | 2 ++",
          truncated: false,
        },
      })).rejects.toThrow("Model returned an empty commit message.")
    } finally {
      restore()
    }
  })

  it("exposes output normalization helpers for edge cases", () => {
    expect(CommitMessageInternal.normalizeGeneratedCommitMessage("- `fix: handle empty commits`")).toBe(
      "fix: handle empty commits",
    )
  })
})
