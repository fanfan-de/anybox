import { ThreadRichText } from "../thread-rich-text"
import type { PendingConversationInput } from "../types"

function getPendingSubmissionText(input: PendingConversationInput) {
  return input.displayText?.trim() || input.text
}

function getPendingSubmissionNote(input: PendingConversationInput) {
  if (input.mode === "queued") return "已排队，当前执行结束后发送"
  if (input.status === "consumed") return "已引导，当前执行会读取这条输入"
  return "将在当前执行到达安全边界后继续"
}

export function ComposerConcurrentInputDrawer({
  canSteer,
  hasPendingPermissionRequests,
  isCancelling,
  onSteerQueuedMessage,
  pendingInputs,
}: {
  canSteer: boolean
  hasPendingPermissionRequests: boolean
  isCancelling: boolean
  onSteerQueuedMessage?: (input: PendingConversationInput) => void | Promise<void>
  pendingInputs: PendingConversationInput[]
}) {
  if (pendingInputs.length === 0) return null

  const steerDisabled =
    !canSteer ||
    hasPendingPermissionRequests ||
    isCancelling

  return (
    <div className="composer-concurrent-input-drawer" aria-live="polite" aria-label="运行中输入操作">
      {pendingInputs.map((input) => (
        <article key={input.id} className="composer-concurrent-input-card">
          <ThreadRichText
            as="div"
            className="composer-concurrent-input-text"
            references={input.references ?? []}
            text={getPendingSubmissionText(input)}
          />
          {input.mode === "queued" ? (
            <div className="composer-concurrent-input-actions">
              <button
                aria-label="引导当前执行"
                className="composer-concurrent-input-steer-button"
                disabled={steerDisabled || !onSteerQueuedMessage}
                onClick={() => void onSteerQueuedMessage?.(input)}
                title="引导当前正在运行的执行过程"
                type="button"
              >
                引导
              </button>
            </div>
          ) : (
            <div className="composer-concurrent-input-note">
              <span>{getPendingSubmissionNote(input)}</span>
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
