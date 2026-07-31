import { beforeEach, describe, expect, it } from "vitest"
import { buildThreadMessagesFromHistory, buildUserThreadMessage } from "./stream"
import { mergeUserMessagePresentationState, persistUserMessages, readPersistedUserMessages } from "./user-message-presentation"

describe("user message presentation persistence", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("restores comment tags after rebuilding a session from history", () => {
    persistUserMessages("session-1", [
      buildUserThreadMessage({
        displayText: "@App.tsx:L10-L14",
        references: [
          {
            id: "comment-1",
            kind: "comment",
            label: "App.tsx:L10-L14",
            title: "src/App.tsx (lines 10-14)",
          },
        ],
        timestamp: 10,
      }),
    ])

    const historyMessages = buildThreadMessagesFromHistory([
      {
        info: {
          id: "msg-user-comment",
          sessionID: "session-1",
          role: "user",
          created: 10,
        },
        parts: [
          {
            id: "part-user-comment",
            type: "text",
            text: "@App.tsx:L10-L14\n\nReview the selected lines before making changes.",
          },
        ],
      },
    ])

    const mergedMessages = mergeUserMessagePresentationState(readPersistedUserMessages("session-1"), historyMessages)

    expect(mergedMessages[0]).toMatchObject({
      kind: "user",
      displayText: "@App.tsx:L10-L14",
      references: [
        {
          id: "comment-1",
          kind: "comment",
          label: "App.tsx:L10-L14",
          title: "src/App.tsx (lines 10-14)",
        },
      ],
    })
    expect(mergedMessages[0]?.kind === "user" ? mergedMessages[0].text : "").not.toContain(
      "Review the selected lines before making changes.",
    )
  })

  it("persists and restores user message diff summaries", () => {
    persistUserMessages("session-1", [
      buildUserThreadMessage({
        displayText: "Update the app",
        diffSummary: {
          stats: {
            files: 1,
            additions: 4,
            deletions: 2,
          },
          diffs: [
            {
              file: "src/App.tsx",
              additions: 4,
              deletions: 2,
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
        },
        timestamp: 10,
      }),
    ])

    expect(readPersistedUserMessages("session-1")[0]).toMatchObject({
      kind: "user",
      diffSummary: {
        stats: {
          files: 1,
          additions: 4,
          deletions: 2,
        },
        diffs: [
          {
            file: "src/App.tsx",
            additions: 4,
            deletions: 2,
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
        ],
      },
    })
  })

  it("persists and restores steering submission mode", () => {
    persistUserMessages("session-1", [
      buildUserThreadMessage({
        displayText: "Adjust the current task",
        submissionMode: "steer",
        streamInsertion: {
          assistantThreadMessageID: "assistant-live",
          afterItemCount: 1,
        },
        timestamp: 10,
      }),
    ])

    const restoredMessage = readPersistedUserMessages("session-1")[0]
    expect(restoredMessage).toMatchObject({
      kind: "user",
      submissionMode: "steer",
    })
    expect(restoredMessage?.streamInsertion).toBeUndefined()
  })

  it("does not persist queued submission mode", () => {
    persistUserMessages("session-1", [
      buildUserThreadMessage({
        displayText: "Send this next",
        submissionMode: "queued",
        timestamp: 10,
      }),
    ])

    const restoredMessage = readPersistedUserMessages("session-1")[0]
    expect(restoredMessage).toMatchObject({
      kind: "user",
      displayText: "Send this next",
    })
    expect(restoredMessage?.submissionMode).toBeUndefined()
  })

  it("does not persist optimistic user messages or their delivery state", () => {
    persistUserMessages("session-1", [
      {
        ...buildUserThreadMessage({
          displayText: "Send this immediately",
          timestamp: 10,
        }),
        delivery: {
          status: "failed",
          error: "Temporary transport failure",
        },
      },
    ])

    expect(readPersistedUserMessages("session-1")).toEqual([])
  })

  it("keeps in-memory pending delivery state while canonical history is reconciled", () => {
    const previousMessages = [
      {
        ...buildUserThreadMessage({
          id: "user-local",
          displayText: "Review this request",
          timestamp: 10,
        }),
        delivery: { status: "pending" as const },
      },
    ]
    const historyMessages = [
      buildUserThreadMessage({
        id: "message-user-backend",
        displayText: "Review this request",
        timestamp: 10,
      }),
    ]

    const mergedMessages = mergeUserMessagePresentationState(
      previousMessages,
      historyMessages,
    )

    expect(mergedMessages).toHaveLength(1)
    expect(mergedMessages[0]).toMatchObject({
      id: "user-local",
      kind: "user",
      delivery: { status: "pending" },
    })
  })

  it("keeps backend diff summaries when merging user presentation state", () => {
    const previousMessages = [
      buildUserThreadMessage({
        displayText: "local text",
        timestamp: 10,
      }),
    ]
    const historyMessages = buildThreadMessagesFromHistory([
      {
        info: {
          id: "msg-user-diff",
          sessionID: "session-1",
          role: "user",
          created: 10,
          diffSummary: {
            stats: {
              files: 1,
              additions: 1,
              deletions: 0,
            },
            diffs: [
              {
                file: "src/new.ts",
                additions: 1,
                deletions: 0,
                patch: "@@ -0,0 +1 @@\n+new",
              },
            ],
          },
        },
        parts: [{ id: "part-user-diff", type: "text", text: "history text" }],
      },
    ])

    const mergedMessages = mergeUserMessagePresentationState(previousMessages, historyMessages)

    expect(mergedMessages[0]).toMatchObject({
      kind: "user",
      displayText: "local text",
      diffSummary: {
        diffs: [
          {
            file: "src/new.ts",
            additions: 1,
            deletions: 0,
            patch: "@@ -0,0 +1 @@\n+new",
          },
        ],
      },
    })
  })

  it("does not copy stale user presentation onto a different active branch message", () => {
    const previousMessages = [
      buildUserThreadMessage({
        id: "msg-root-user",
        displayText: "Plan a Tokyo trip",
        timestamp: 10,
      }),
      buildUserThreadMessage({
        id: "msg-old-branch-user",
        displayText: "Use rollback and fix the route order",
        timestamp: 20,
      }),
    ]
    const nextMessages = [
      buildUserThreadMessage({
        id: "msg-root-user",
        displayText: "Plan a Tokyo trip",
        timestamp: 10,
      }),
      buildUserThreadMessage({
        id: "msg-rollback-user",
        displayText: "Rollback: route order was wrong",
        timestamp: 30,
      }),
    ]

    const mergedMessages = mergeUserMessagePresentationState(previousMessages, nextMessages)

    expect(mergedMessages[1]).toMatchObject({
      id: "msg-rollback-user",
      kind: "user",
      displayText: "Rollback: route order was wrong",
      text: "Rollback: route order was wrong",
    })
  })
})
