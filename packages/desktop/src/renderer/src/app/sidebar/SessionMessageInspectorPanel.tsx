import { useState } from "react"
import { useI18n } from "../i18n/I18nProvider"
import type { SessionMessageTree, SessionMessageTreeNode } from "../session-message-tree"
import {
  ThreadMarkdown,
  type MarkdownArtifactLinkTarget,
  type MarkdownLocalFileLinkTarget,
} from "../thread-markdown"
import { joinClassNames } from "../shared-ui"
import { ForkIcon } from "../icons"

interface SessionMessageInspectorPanelProps {
  messageID: string
  messageTree: SessionMessageTree | null
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  onOpenBranchChat?: (messageID: string) => void
}

function findNearestUserAncestor(
  messageTree: SessionMessageTree,
  messageID: string,
): SessionMessageTreeNode | null {
  const seen = new Set<string>()
  let currentID: string | null = messageID

  while (currentID && !seen.has(currentID)) {
    seen.add(currentID)
    const node: SessionMessageTreeNode | undefined = messageTree.nodesByID[currentID]
    if (!node) return null
    if (node.role === "user") return node
    currentID = node.parentMessageID
  }

  return null
}

function getAssistantChildren(
  messageTree: SessionMessageTree,
  messageID: string,
) {
  return (messageTree.childIDsByParentID[messageID] ?? [])
    .map((childMessageID) => messageTree.nodesByID[childMessageID])
    .filter((node): node is SessionMessageTreeNode => node?.role === "assistant")
}

export function SessionMessageInspectorPanel({
  messageID,
  messageTree,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  onOpenBranchChat,
}: SessionMessageInspectorPanelProps) {
  const { t } = useI18n()
  const [selectedResponseMessageID, setSelectedResponseMessageID] = useState<string | null>(null)
  const inspectedNode = messageTree?.nodesByID[messageID] ?? null

  if (!messageTree || !inspectedNode) {
    return (
      <section className="session-message-inspector is-empty" aria-label={t("branchView.detailAria")}>
        <div className="session-message-inspector-empty" role="status">
          {t("branchView.detailUnavailable")}
        </div>
      </section>
    )
  }

  const promptNode = inspectedNode.role === "user"
    ? inspectedNode
    : findNearestUserAncestor(messageTree, inspectedNode.id)
  const responseOptions = inspectedNode.role === "user"
    ? getAssistantChildren(messageTree, inspectedNode.id)
    : []
  const activeResponseOption = responseOptions.find((node) => (
    messageTree.activePathMessageIDs.includes(node.id)
  ))
  const selectedResponseOption = responseOptions.find((node) => (
    node.id === selectedResponseMessageID
  ))
  const responseNode = inspectedNode.role === "assistant"
    ? inspectedNode
    : selectedResponseOption ?? activeResponseOption ?? responseOptions[0] ?? null
  const headingNode = responseNode ?? promptNode ?? inspectedNode
  const isCurrent = (
    inspectedNode.id === messageTree.activeMessageID ||
    responseNode?.id === messageTree.activeMessageID
  )

  return (
    <section className="session-message-inspector" aria-label={t("branchView.detailAria")}>
      <header className="session-message-inspector-header">
        <div className="session-message-inspector-heading">
          <span>
            {responseNode
              ? t("branchView.assistantResponse")
              : t("branchView.userMessage")}
          </span>
          <h2 title={headingNode.preview}>{headingNode.preview}</h2>
        </div>
        <div className="session-message-inspector-meta">
          {responseNode?.isCompletedResponse && onOpenBranchChat ? (
            <button
              type="button"
              className="session-message-inspector-branch-chat"
              onClick={() => onOpenBranchChat(responseNode.id)}
            >
              <ForkIcon />
              {t("branchChat.name")}
            </button>
          ) : null}
          {isCurrent ? (
            <span className="is-current">{t("branchView.current")}</span>
          ) : null}
          <span>{t("branchView.inspected")}</span>
        </div>
      </header>

      <div className="session-message-inspector-body">
        {responseOptions.length > 1 ? (
          <section className="session-message-inspector-section is-response-options">
            <h3>{t("branchView.responseBranches", { count: responseOptions.length })}</h3>
            <div
              className="session-message-inspector-response-options"
              role="group"
              aria-label={t("branchView.responseBranches", { count: responseOptions.length })}
            >
              {responseOptions.map((node, index) => {
                const isSelected = node.id === responseNode?.id
                return (
                  <button
                    key={node.id}
                    type="button"
                    className={joinClassNames(
                      "session-message-inspector-response-option",
                      isSelected && "is-selected",
                    )}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedResponseMessageID(node.id)}
                  >
                    <span className="session-message-inspector-response-index">
                      {index + 1}
                    </span>
                    <span>{node.preview}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        {promptNode ? (
          <section className="session-message-inspector-section">
            <h3>{t("branchView.prompt")}</h3>
            <div className="session-message-inspector-prompt">
              <ThreadMarkdown
                className="session-message-inspector-markdown thread-markdown"
                text={promptNode.content}
                onArtifactLinkOpen={onArtifactLinkOpen}
                onLocalFileLinkOpen={onLocalFileLinkOpen}
              />
            </div>
          </section>
        ) : null}

        <section className="session-message-inspector-section is-response">
          <h3>{t("branchView.response")}</h3>
          {responseNode ? (
            <ThreadMarkdown
              className="session-message-inspector-markdown thread-markdown"
              text={responseNode.content}
              onArtifactLinkOpen={onArtifactLinkOpen}
              onLocalFileLinkOpen={onLocalFileLinkOpen}
            />
          ) : (
            <p className="session-message-inspector-no-response" role="status">
              {t("branchView.noResponse")}
            </p>
          )}
        </section>
      </div>
    </section>
  )
}
