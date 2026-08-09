import React from "react"
import Feather from "@expo/vector-icons/Feather"
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native"
import type { ToolCallSnapshot } from "@anybox/shared"
import type { MobileApproval, MobileMessage, MobileProviderModel, MobileSessionSummary, MobileWorkspace } from "@/api/mobile-api"
import { useI18n } from "@/i18n"
import { ApprovalCard } from "./approval-card"
import { ThreadMarkdown } from "./thread-markdown"
import {
  messageContentSegments,
  messageHasVisibleContent,
  messageRole,
  messageText,
  type MessageContentSegment,
  type MobileQuestionPrompt,
  type MessageToolContentSegment,
} from "@/utils/message"
import { DarkEmpty, DarkNotice } from "./shared"

type FeatherName = React.ComponentProps<typeof Feather>["name"]
const THREAD_BOTTOM_STICKY_THRESHOLD = 72

type QuestionAnswerInput = {
  questionID: string
  text: string
  selectedOptions?: string[]
  freeformText?: string
}

export function ThreadViewPage({
  actingApprovalID,
  approvalError,
  approvals,
  disabled,
  draft,
  effectiveModel,
  focusedSession,
  focusedWorkspace,
  messageError,
  messages,
  messagesLoading,
  modelError,
  modelOptions,
  modelSelectionEnabled,
  modelsLoading,
  onApproveApproval,
  onAnswerQuestion,
  onChangeText,
  onDenyApproval,
  onModelSelect,
  onNewChat,
  onOpenDrawer,
  onSelectWorkspace,
  onSend,
  paddingBottom,
  paddingTop,
  placeholder,
  savingModel,
  selectedModel,
  sending,
  workspaces,
  answeringQuestionID,
}: {
  actingApprovalID: string | null
  answeringQuestionID: string | null
  approvalError: string | null
  approvals: MobileApproval[]
  disabled: boolean
  draft: string
  effectiveModel: MobileProviderModel | null
  focusedSession: MobileSessionSummary | null
  focusedWorkspace: MobileWorkspace | null
  messageError: string | null
  messages: MobileMessage[]
  messagesLoading: boolean
  modelError: string | null
  modelOptions: MobileProviderModel[]
  modelSelectionEnabled: boolean
  modelsLoading: boolean
  onApproveApproval: (approval: MobileApproval) => void
  onAnswerQuestion: (answer: QuestionAnswerInput) => Promise<void>
  onChangeText: (value: string) => void
  onDenyApproval: (approval: MobileApproval) => void
  onModelSelect: (modelValue: string | null) => void
  onNewChat: () => void
  onOpenDrawer: () => void
  onSelectWorkspace: (workspace: MobileWorkspace) => void
  onSend: () => void
  paddingBottom: number
  paddingTop: number
  placeholder: string
  savingModel: boolean
  selectedModel: string | null
  sending: boolean
  workspaces: MobileWorkspace[]
}) {
  const { t } = useI18n()
  const title = focusedSession?.title ?? t("thread.newSession")
  const visibleMessages = React.useMemo(() => messages.filter(messageHasVisibleContent), [messages])
  const timelineItems = React.useMemo(() => buildThreadTimeline(visibleMessages, approvals), [approvals, visibleMessages])
  const scrollViewRef = React.useRef<ScrollView | null>(null)
  const stickyToBottomRef = React.useRef(true)
  const scrollFrameRef = React.useRef<number | null>(null)
  const previousSessionIDRef = React.useRef<string | null>(null)
  const previousTailMessageIDRef = React.useRef<string | null>(null)
  const newSessionToastTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [modelPanelOpen, setModelPanelOpen] = React.useState(false)
  const [newSessionToastVisible, setNewSessionToastVisible] = React.useState(false)
  const tailMessage = visibleMessages.length ? visibleMessages[visibleMessages.length - 1] : null
  const tailMessageID = tailMessage?.info?.id ?? null
  const tailMessagePending = tailMessage?.info?.pending === true
  const showingWorkspaceIntro = Boolean(focusedWorkspace && !focusedSession)

  const scrollTimelineToEnd = React.useCallback((animated = false) => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null
      scrollViewRef.current?.scrollToEnd({ animated })
    })
  }, [])

  React.useEffect(() => () => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current)
    }
    if (newSessionToastTimerRef.current !== null) {
      clearTimeout(newSessionToastTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    const sessionID = focusedSession?.id ?? null
    if (previousSessionIDRef.current === sessionID) return
    previousSessionIDRef.current = sessionID
    previousTailMessageIDRef.current = tailMessageID
    stickyToBottomRef.current = true
    scrollTimelineToEnd(false)
  }, [focusedSession?.id, scrollTimelineToEnd, tailMessageID])

  React.useEffect(() => {
    const previousTailMessageID = previousTailMessageIDRef.current
    if (previousTailMessageID === tailMessageID) return
    previousTailMessageIDRef.current = tailMessageID
    if (sending || tailMessagePending || previousTailMessageID === null) {
      stickyToBottomRef.current = true
      scrollTimelineToEnd(false)
    }
  }, [scrollTimelineToEnd, sending, tailMessageID, tailMessagePending])

  React.useEffect(() => {
    if (!sending) return
    stickyToBottomRef.current = true
    scrollTimelineToEnd(true)
  }, [scrollTimelineToEnd, sending])

  const handleTimelineScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y
    stickyToBottomRef.current = distanceFromBottom <= THREAD_BOTTOM_STICKY_THRESHOLD
  }, [])

  const handleTimelineContentSizeChange = React.useCallback(() => {
    if (stickyToBottomRef.current) {
      scrollTimelineToEnd(false)
    }
  }, [scrollTimelineToEnd])

  const showNewSessionToast = React.useCallback(() => {
    if (newSessionToastTimerRef.current !== null) {
      clearTimeout(newSessionToastTimerRef.current)
    }
    setNewSessionToastVisible(true)
    newSessionToastTimerRef.current = setTimeout(() => {
      setNewSessionToastVisible(false)
      newSessionToastTimerRef.current = null
    }, 3200)
  }, [])

  const handleNewChatPress = React.useCallback(() => {
    if (showingWorkspaceIntro) {
      showNewSessionToast()
      return
    }
    onNewChat()
  }, [onNewChat, showingWorkspaceIntro, showNewSessionToast])

  return (
    <KeyboardAvoidingView
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "android" ? -paddingTop : 0}
      style={{ backgroundColor: "#171717", flex: 1, position: "relative" }}
    >
      <View style={{ alignSelf: "center", flex: 1, width: "100%", maxWidth: 430, paddingBottom, paddingTop, position: "relative" }}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 10, height: 58, paddingHorizontal: 14 }}>
          <TopIconButton accessibilityLabel={t("thread.openProjects")} icon="menu" onPress={onOpenDrawer} />
          <View style={{ alignItems: "center", flex: 1, flexDirection: "row" }}>
            <Text numberOfLines={1} style={{ color: "#e8e8e8", flexShrink: 1, fontSize: 25, fontWeight: "800" }}>
              {title}
            </Text>
          </View>
          <TopIconButton accessibilityLabel={t("thread.newSession")} disabled={!focusedWorkspace || sending} icon="edit-3" onPress={handleNewChatPress} />
        </View>

        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            flexGrow: showingWorkspaceIntro ? 1 : undefined,
            gap: 14,
            justifyContent: showingWorkspaceIntro ? "center" : undefined,
            paddingBottom: showingWorkspaceIntro ? 88 : 18,
            paddingHorizontal: 22,
            paddingTop: 16,
          }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={handleTimelineContentSizeChange}
          onScroll={handleTimelineScroll}
          ref={scrollViewRef}
          scrollEventThrottle={80}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {messageError ? (
            <DarkNotice title={t("thread.composerFailed")} detail={messageError} tone="danger" />
          ) : null}
          {approvalError ? (
            <DarkNotice title={t("thread.approvalFailed")} detail={approvalError} tone="danger" />
          ) : null}
          {focusedWorkspace && !focusedSession ? (
            <AssistantIntro
              currentWorkspace={focusedWorkspace}
              disabled={sending}
              onSelectWorkspace={onSelectWorkspace}
              toastLabel={t("thread.alreadyInNewSession")}
              toastVisible={newSessionToastVisible}
              workspaces={workspaces}
            />
          ) : null}
          {focusedSession ? (
            timelineItems.length ? (
              timelineItems.map((item, index) => (
                item.type === "message" ? (
                  <ThreadMessage
                    answeringQuestionID={answeringQuestionID}
                    key={item.message.info?.id ?? `message-${index}`}
                    message={item.message}
                    onAnswerQuestion={onAnswerQuestion}
                  />
                ) : (
                  <ApprovalCard
                    acting={actingApprovalID === item.approval.id}
                    approval={item.approval}
                    key={`approval-${item.approval.id}`}
                    onApprove={() => onApproveApproval(item.approval)}
                    onDeny={() => onDenyApproval(item.approval)}
                    tone="dark"
                  />
                )
              ))
            ) : (
              <DarkEmpty title={messagesLoading ? t("thread.loadingSession") : t("thread.noMessages")} />
            )
          ) : null}
        </ScrollView>

        {modelPanelOpen ? (
          <Pressable
            accessible={false}
            onPress={() => setModelPanelOpen(false)}
            style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 1 }}
            testID="model-selector-backdrop"
          />
        ) : null}

        <ThreadComposer
          disabled={disabled}
          draft={draft}
          effectiveModel={effectiveModel}
          modelError={modelError}
          modelOptions={modelOptions}
          modelSelectionEnabled={modelSelectionEnabled}
          modelPanelOpen={modelPanelOpen}
          modelsLoading={modelsLoading}
          onChangeText={onChangeText}
          onModelPanelOpenChange={setModelPanelOpen}
          onModelSelect={onModelSelect}
          onSend={onSend}
          placeholder={placeholder}
          savingModel={savingModel}
          selectedModel={selectedModel}
          sending={sending}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

type ThreadTimelineItem =
  | { type: "message"; message: MobileMessage }
  | { type: "approval"; approval: MobileApproval }

function buildThreadTimeline(messages: MobileMessage[], approvals: MobileApproval[]): ThreadTimelineItem[] {
  const pendingApprovals = approvals
    .filter((approval) => approval.status === "pending")
    .sort((left, right) => left.createdAt - right.createdAt)
  const messageIDs = new Set(messages.map((message) => message.info?.id).filter(Boolean))
  const approvalsByMessage = new Map<string, MobileApproval[]>()
  const unanchoredApprovals: MobileApproval[] = []

  for (const approval of pendingApprovals) {
    if (approval.messageID && messageIDs.has(approval.messageID)) {
      const current = approvalsByMessage.get(approval.messageID) ?? []
      current.push(approval)
      approvalsByMessage.set(approval.messageID, current)
    } else {
      unanchoredApprovals.push(approval)
    }
  }

  const items: ThreadTimelineItem[] = []
  for (const message of messages) {
    items.push({ type: "message", message })
    const messageApprovals = message.info?.id ? approvalsByMessage.get(message.info.id) : undefined
    if (messageApprovals?.length) {
      for (const approval of messageApprovals) {
        items.push({ type: "approval", approval })
      }
    }
  }

  for (const approval of unanchoredApprovals) {
    items.push({ type: "approval", approval })
  }

  return items
}

function ThreadMessage({
  answeringQuestionID,
  message,
  onAnswerQuestion,
}: {
  answeringQuestionID: string | null
  message: MobileMessage
  onAnswerQuestion: (answer: QuestionAnswerInput) => Promise<void>
}) {
  const { t } = useI18n()
  const role = messageRole(message)
  const isUser = role === "user"
  const text = messageText(message)
  const contentSegments = messageContentSegments(message)
  const hasReasoning = contentSegments.some((segment) => segment.kind === "reasoning" && segment.text.trim())
  const isPending = message.info?.pending === true
  const reasoningStatus = isPending ? t("thread.reasoningActive") : hasReasoning ? t("thread.reasoningComplete") : null

  if (isUser) {
    return (
      <View style={{ alignItems: "flex-end" }}>
        <View style={{ backgroundColor: "#474747", borderRadius: 17, borderTopRightRadius: 4, maxWidth: "84%", paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text selectable style={{ color: "#ffffff", fontSize: 16, lineHeight: 22 }}>
            {text}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <View style={{ gap: 10 }}>
      {reasoningStatus ? (
        <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
          <Feather color="#9a9a9a" name={isPending ? "activity" : "check-circle"} size={12} />
          <Text style={{ color: "#a7a7a7", fontSize: 12, fontWeight: "800" }}>{reasoningStatus}</Text>
        </View>
      ) : null}
      <AssistantMessageContent
        answeringQuestionID={answeringQuestionID}
        onAnswerQuestion={onAnswerQuestion}
        reasoningPending={isPending}
        segments={contentSegments.length ? contentSegments : [{ kind: "response", text: text || "..." }]}
      />
    </View>
  )
}

function AssistantMessageContent({
  answeringQuestionID,
  onAnswerQuestion,
  reasoningPending,
  segments,
}: {
  answeringQuestionID: string | null
  onAnswerQuestion: (answer: QuestionAnswerInput) => Promise<void>
  reasoningPending: boolean
  segments: MessageContentSegment[]
}) {
  return (
    <View style={{ gap: 10 }}>
      {segments.map((segment, index) => {
        if (segment.kind === "tool") {
          if (segment.questionPrompt && !segment.questionPrompt.answered) {
            return (
              <QuestionSegment
                disabled={answeringQuestionID === segment.questionPrompt.questionID}
                key={`question-${segment.call.callID}-${index}`}
                onAnswerQuestion={onAnswerQuestion}
                prompt={segment.questionPrompt}
              />
            )
          }
          return <ToolSegment key={`tool-${segment.call.callID}-${index}`} segment={segment} />
        }
        if (segment.kind === "reasoning") {
          return <ReasoningSegment key={`reasoning-${index}`} pending={reasoningPending} text={segment.text} />
        }
        return <ResponseSegment key={`response-${index}`} text={segment.text} />
      })}
    </View>
  )
}

function QuestionSegment({
  disabled,
  onAnswerQuestion,
  prompt,
}: {
  disabled: boolean
  onAnswerQuestion: (answer: QuestionAnswerInput) => Promise<void>
  prompt: MobileQuestionPrompt
}) {
  const { t } = useI18n()
  const [selectedOptions, setSelectedOptions] = React.useState<string[]>([])
  const [freeformText, setFreeformText] = React.useState("")
  const questionID = prompt.questionID
  const canAnswer = Boolean(questionID) && !disabled
  const trimmedFreeformText = freeformText.trim()
  const hasStructuredAnswer = selectedOptions.length > 0 || Boolean(trimmedFreeformText)
  const needsSubmitButton = prompt.multiple || prompt.allowFreeform || prompt.options.length === 0
  const submitDisabled = !canAnswer || !hasStructuredAnswer

  function toggleOption(value: string) {
    if (!prompt.multiple) {
      setSelectedOptions([value])
      return
    }

    setSelectedOptions((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    )
  }

  function displayTextForAnswer(answer: { selectedOptions?: string[]; freeformText?: string }) {
    const freeform = answer.freeformText?.trim()
    if (freeform) return freeform
    return (answer.selectedOptions ?? [])
      .map((value) => prompt.options.find((option) => option.value === value)?.label ?? value)
      .map((value) => value.trim())
      .filter(Boolean)
      .join(", ")
  }

  async function submitAnswer(answer: { selectedOptions?: string[]; freeformText?: string }) {
    if (!questionID || !canAnswer) return
    const text = displayTextForAnswer(answer)
    if (!text) return
    await onAnswerQuestion({
      questionID,
      text,
      ...(answer.selectedOptions?.length ? { selectedOptions: answer.selectedOptions } : {}),
      ...(answer.freeformText ? { freeformText: answer.freeformText } : {}),
    })
    setSelectedOptions([])
    setFreeformText("")
  }

  return (
    <View
      style={{
        backgroundColor: "#202020",
        borderColor: "#3c332f",
        borderRadius: 9,
        borderWidth: 1,
        gap: 10,
        padding: 12,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 7 }}>
        <Feather color="#c8a07d" name="help-circle" size={14} />
        <Text style={{ color: "#d8d8d8", flexShrink: 1, fontSize: 13, fontWeight: "800" }}>
          {t("thread.questionHeading")}
        </Text>
        {prompt.header ? (
          <Text numberOfLines={1} style={{ color: "#9d9d9d", flex: 1, fontSize: 12, fontWeight: "700" }}>
            {prompt.header}
          </Text>
        ) : null}
      </View>

      <Text selectable style={{ color: "#f0f0f0", fontSize: 16, fontWeight: "800", lineHeight: 23 }}>
        {prompt.question}
      </Text>

      {prompt.options.length ? (
        <View style={{ gap: 7 }}>
          {prompt.options.map((option, index) => {
            const selected = selectedOptions.includes(option.value)
            return (
              <Pressable
                accessibilityRole="button"
                disabled={!canAnswer}
                key={`${option.value}-${index}`}
                onPress={() => {
                  if (!prompt.multiple) {
                    void submitAnswer({ selectedOptions: [option.value] })
                    return
                  }
                  toggleOption(option.value)
                }}
                style={({ pressed }) => ({
                  alignItems: "flex-start",
                  backgroundColor: selected ? "#2c2825" : "#181818",
                  borderColor: selected ? "#b58a67" : "#343434",
                  borderRadius: 7,
                  borderWidth: 1,
                  flexDirection: "row",
                  gap: 9,
                  minHeight: 44,
                  opacity: pressed ? 0.78 : canAnswer ? 1 : 0.58,
                  paddingHorizontal: 10,
                  paddingVertical: 9,
                })}
              >
                <View
                  style={{
                    alignItems: "center",
                    backgroundColor: selected ? "#b58a67" : "transparent",
                    borderColor: selected ? "#b58a67" : "#555555",
                    borderRadius: prompt.multiple ? 4 : 9,
                    borderWidth: 1,
                    height: 18,
                    justifyContent: "center",
                    marginTop: 1,
                    width: 18,
                  }}
                >
                  {selected ? <Feather color="#171717" name="check" size={12} /> : (
                    <Text style={{ color: "#9d9d9d", fontSize: 10, fontWeight: "800" }}>{index + 1}</Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                  <Text style={{ color: "#eeeeee", fontSize: 14, fontWeight: "800", lineHeight: 19 }}>
                    {option.label}
                  </Text>
                  {option.description ? (
                    <Text style={{ color: "#a5a5a5", fontSize: 12, lineHeight: 17 }}>
                      {option.description}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {prompt.allowFreeform ? (
        <TextInput
          editable={canAnswer}
          onChangeText={setFreeformText}
          placeholder={prompt.placeholder || t("thread.questionPlaceholder")}
          placeholderTextColor="#777777"
          returnKeyType="done"
          style={{
            backgroundColor: "#171717",
            borderColor: "#343434",
            borderRadius: 7,
            borderWidth: 1,
            color: "#f2f2f2",
            fontSize: 15,
            minHeight: 42,
            paddingHorizontal: 11,
            paddingVertical: 9,
          }}
          value={freeformText}
        />
      ) : null}

      {needsSubmitButton ? (
        <View style={{ alignItems: "flex-end" }}>
          <Pressable
            accessibilityRole="button"
            disabled={submitDisabled}
            onPress={() => void submitAnswer({
              ...(selectedOptions.length ? { selectedOptions } : {}),
              ...(trimmedFreeformText ? { freeformText: trimmedFreeformText } : {}),
            })}
            style={({ pressed }) => ({
              alignItems: "center",
              backgroundColor: submitDisabled ? "#333333" : "#f1f1f1",
              borderRadius: 8,
              minHeight: 38,
              justifyContent: "center",
              opacity: pressed ? 0.8 : 1,
              paddingHorizontal: 15,
            })}
          >
            <Text style={{ color: submitDisabled ? "#8f8f8f" : "#171717", fontSize: 14, fontWeight: "900" }}>
              {disabled ? t("thread.questionSending") : t("thread.questionSubmit")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={{ color: "#8f8f8f", fontSize: 12, lineHeight: 17 }}>
        {prompt.multiple
          ? t("thread.questionChooseMany")
          : prompt.options.length
            ? t("thread.questionChooseOne")
            : t("thread.questionOptional")}
      </Text>
    </View>
  )
}

function ReasoningSegment({ pending, text }: { pending: boolean; text: string }) {
  const [expanded, setExpanded] = React.useState(pending)
  const collapsed = !pending && !expanded

  React.useEffect(() => {
    setExpanded(pending)
  }, [pending])

  if (!text.trim()) return null

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: pending, expanded: !collapsed }}
      disabled={pending}
      onPress={() => setExpanded((current) => !current)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.78 : 1,
      })}
    >
      <View
        style={{
          borderLeftColor: "#4a4a4a",
          borderLeftWidth: 2,
          gap: 5,
          paddingLeft: 10,
          paddingVertical: 2,
        }}
      >
        <Text
          ellipsizeMode="tail"
          numberOfLines={collapsed ? 2 : undefined}
          selectable
          style={{ color: "#a0a0a0", fontSize: 14, lineHeight: 20 }}
        >
          {text}
        </Text>
      </View>
    </Pressable>
  )
}

function ResponseSegment({ text }: { text: string }) {
  if (!text.trim()) return null

  return <ThreadMarkdown text={text} />
}

function ToolSegment({ segment }: { segment: MessageToolContentSegment }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = React.useState(false)
  const descriptor = toolCallDescriptor(segment.call, t)
  const title = segment.title?.trim() || formatToolName(segment.call.tool)
  const preview = segment.call.state.phase === "settled" && segment.call.state.outcome.kind === "returned"
    ? segment.outputPreview || segment.inputPreview
    : segment.error || segment.reason || segment.inputPreview || segment.outputPreview
  const detailRows = [
    segment.inputPreview ? { label: t("thread.toolInput"), value: segment.inputPreview } : null,
    segment.outputPreview ? { label: t("thread.toolOutput"), value: segment.outputPreview } : null,
    segment.error ? { label: t("thread.toolError"), value: segment.error } : null,
    segment.failure ? {
      label: t("thread.toolFailureDetails"),
      value: [
        `${segment.failure.stage}/${segment.failure.source} · ${segment.failure.code}`,
        `${segment.failure.handlerExecuted ? "handler executed" : "handler not executed"} · ${segment.failure.retryable ? "retryable" : "not retryable"} · ${segment.failure.severity}`,
      ].join("\n"),
    } : null,
    segment.reason ? { label: t("thread.toolReason"), value: segment.reason } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item))
  const canExpand = detailRows.length > 0

  return (
    <View
      style={{
        backgroundColor: "#202020",
        borderColor: descriptor.borderColor,
        borderRadius: 8,
        borderWidth: 1,
        overflow: "hidden",
      }}
    >
      <Pressable
        accessibilityRole="button"
        disabled={!canExpand}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: 9,
          opacity: pressed ? 0.78 : 1,
          paddingHorizontal: 10,
          paddingVertical: 9,
        })}
      >
        <Feather color={descriptor.color} name={descriptor.icon} size={13} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: "#d8d8d8", fontSize: 13, fontWeight: "800" }}>
            {title}
          </Text>
          <Text numberOfLines={1} style={{ color: "#9d9d9d", fontSize: 12, lineHeight: 16 }}>
            {preview ? `${descriptor.label} · ${preview}` : descriptor.label}
          </Text>
        </View>
        {canExpand ? <Feather color="#818181" name={expanded ? "chevron-up" : "chevron-down"} size={14} /> : null}
      </Pressable>
      {expanded ? (
        <View style={{ borderTopColor: "#303030", borderTopWidth: 1, gap: 8, paddingHorizontal: 10, paddingVertical: 9 }}>
          {detailRows.map((row) => (
            <View key={row.label} style={{ gap: 3 }}>
              <Text style={{ color: "#8f8f8f", fontSize: 11, fontWeight: "800" }}>{row.label}</Text>
              <Text selectable style={{ color: "#b8b8b8", fontSize: 12, lineHeight: 17 }}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function toolCallDescriptor(call: ToolCallSnapshot, t: ReturnType<typeof useI18n>["t"]) {
  if (call.state.phase === "pending") {
      return { borderColor: "#3a3a3a", color: "#9a9a9a", icon: "clock" as FeatherName, label: t("thread.toolPending") }
  }
  if (call.state.phase === "running") {
      return { borderColor: "#3b4750", color: "#8fb7d8", icon: "activity" as FeatherName, label: t("thread.toolRunning") }
  }
  if (call.state.phase === "waiting-approval") {
      return { borderColor: "#4d432e", color: "#d6b76b", icon: "alert-circle" as FeatherName, label: t("thread.toolWaitingApproval") }
  }

  const outcome = call.state.outcome
  if (outcome.kind === "returned") {
    if (outcome.result === "negative") {
      return { borderColor: "#4d432e", color: "#d6b76b", icon: "alert-circle" as FeatherName, label: t("thread.toolReturnedNegative") }
    }
    if (outcome.completeness === "partial") {
      return { borderColor: "#4d432e", color: "#d6b76b", icon: "pie-chart" as FeatherName, label: t("thread.toolReturnedPartial") }
    }
    return { borderColor: "#34473a", color: "#7fb58a", icon: "check" as FeatherName, label: t("thread.toolCompleted") }
  }
  if (outcome.kind === "failed") {
    return { borderColor: "#513635", color: "#e28a83", icon: "alert-triangle" as FeatherName, label: t("thread.toolFailed") }
  }
  if (outcome.kind === "blocked") {
    return { borderColor: "#3f3f3f", color: "#a7a7a7", icon: "pause-circle" as FeatherName, label: t("thread.toolBlocked") }
  }
  if (outcome.kind === "timeout") {
    return { borderColor: "#4d432e", color: "#d6b76b", icon: "clock" as FeatherName, label: t("thread.toolTimeout") }
  }
  if (outcome.kind === "denied") {
    return { borderColor: "#3f3f3f", color: "#a7a7a7", icon: "slash" as FeatherName, label: t("thread.toolDenied") }
  }
  return { borderColor: "#3f3f3f", color: "#a7a7a7", icon: "x-circle" as FeatherName, label: t("thread.toolCancelled") }
}

function formatToolName(tool: string | undefined) {
  return (tool ?? "tool")
    .replace(/^functions[._-]/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "tool"
}

function AssistantIntro({
  currentWorkspace,
  disabled,
  onSelectWorkspace,
  toastLabel,
  toastVisible,
  workspaces,
}: {
  currentWorkspace: MobileWorkspace
  disabled: boolean
  onSelectWorkspace: (workspace: MobileWorkspace) => void
  toastLabel: string
  toastVisible: boolean
  workspaces: MobileWorkspace[]
}) {
  const { t } = useI18n()
  const [workspacePickerVisible, setWorkspacePickerVisible] = React.useState(false)
  const conversationLabel = t("thread.startConversation", { workspace: currentWorkspace.name })

  function handleSelectWorkspace(workspace: MobileWorkspace) {
    setWorkspacePickerVisible(false)
    if (workspace.id !== currentWorkspace.id) {
      onSelectWorkspace(workspace)
    }
  }

  return (
    <>
      <View style={{ alignItems: "center", gap: 14, paddingHorizontal: 6, paddingVertical: 24, position: "relative", width: "100%" }}>
        <Image
          accessibilityIgnoresInvertColors
          source={require("../../assets/icon.png")}
          style={{
            borderRadius: 16,
            height: 58,
            width: 58,
          }}
        />
        <Pressable
          accessibilityHint={t("connection.selectProject")}
          accessibilityLabel={conversationLabel}
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => setWorkspacePickerVisible(true)}
          style={({ pressed }) => ({
            alignItems: "center",
            borderRadius: 12,
            flexDirection: "row",
            gap: 6,
            justifyContent: "center",
            maxWidth: "100%",
            opacity: disabled ? 0.55 : pressed ? 0.68 : 1,
            paddingHorizontal: 10,
            paddingVertical: 6,
          })}
        >
          <Text
            numberOfLines={2}
            style={{ color: "#f1f1f1", flexShrink: 1, fontSize: 22, fontWeight: "900", lineHeight: 28, textAlign: "center" }}
          >
            {conversationLabel}
          </Text>
          <Feather color="#a9a9a9" name="chevron-down" size={18} />
        </Pressable>
        {toastVisible ? <NewSessionToast label={toastLabel} /> : null}
      </View>
      <WorkspacePickerModal
        currentWorkspaceID={currentWorkspace.id}
        onClose={() => setWorkspacePickerVisible(false)}
        onSelectWorkspace={handleSelectWorkspace}
        visible={workspacePickerVisible}
        workspaces={workspaces}
      />
    </>
  )
}

function WorkspacePickerModal({
  currentWorkspaceID,
  onClose,
  onSelectWorkspace,
  visible,
  workspaces,
}: {
  currentWorkspaceID: string
  onClose: () => void
  onSelectWorkspace: (workspace: MobileWorkspace) => void
  visible: boolean
  workspaces: MobileWorkspace[]
}) {
  const { t } = useI18n()

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={{ alignItems: "center", backgroundColor: "rgba(0, 0, 0, 0.62)", flex: 1, justifyContent: "center", padding: 22 }}>
        <Pressable
          accessibilityLabel={t("app.cancel")}
          onPress={onClose}
          style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
        />
        <View
          style={{
            backgroundColor: "#242424",
            borderColor: "#3a3a3a",
            borderRadius: 20,
            borderWidth: 1,
            maxHeight: "68%",
            maxWidth: 380,
            overflow: "hidden",
            padding: 12,
            shadowColor: "#000000",
            shadowOpacity: 0.34,
            shadowRadius: 18,
            width: "100%",
          }}
        >
          <View style={{ alignItems: "center", flexDirection: "row", minHeight: 42, paddingBottom: 8, paddingHorizontal: 4 }}>
            <Text style={{ color: "#f2f2f2", flex: 1, fontSize: 18, fontWeight: "900" }}>
              {t("connection.selectProject")}
            </Text>
            <Pressable
              accessibilityLabel={t("app.cancel")}
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => ({
                alignItems: "center",
                borderRadius: 10,
                height: 34,
                justifyContent: "center",
                opacity: pressed ? 0.62 : 1,
                width: 34,
              })}
            >
              <Feather color="#d6d6d6" name="x" size={20} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ gap: 4 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {workspaces.map((workspace) => {
              const selected = workspace.id === currentWorkspaceID
              return (
                <Pressable
                  accessibilityLabel={workspace.name}
                  accessibilityRole="button"
                  key={workspace.id}
                  onPress={() => onSelectWorkspace(workspace)}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    backgroundColor: selected ? "#343434" : pressed ? "#2d2d2d" : "transparent",
                    borderRadius: 12,
                    flexDirection: "row",
                    gap: 11,
                    minHeight: 50,
                    paddingHorizontal: 12,
                  })}
                >
                  <Feather color={selected ? "#f2f2f2" : "#a9a9a9"} name="folder" size={18} />
                  <Text
                    numberOfLines={2}
                    style={{ color: selected ? "#ffffff" : "#d6d6d6", flex: 1, fontSize: 15, fontWeight: selected ? "900" : "700" }}
                  >
                    {workspace.name}
                  </Text>
                  {selected ? <Feather color="#74d58b" name="check" size={18} /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function NewSessionToast({ label }: { label: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        left: 0,
        position: "absolute",
        right: 0,
        top: 92,
        zIndex: 10,
      }}
    >
      <View
        style={{
          backgroundColor: "#565656",
          borderRadius: 14,
          maxWidth: "82%",
          paddingHorizontal: 22,
          paddingVertical: 15,
          shadowColor: "#000000",
          shadowOpacity: 0.22,
          shadowRadius: 12,
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "800", lineHeight: 26, textAlign: "center" }}>
          {label}
        </Text>
      </View>
    </View>
  )
}

function ThreadComposer({
  disabled,
  draft,
  effectiveModel,
  modelError,
  modelOptions,
  modelSelectionEnabled,
  modelPanelOpen,
  modelsLoading,
  onChangeText,
  onModelPanelOpenChange,
  onModelSelect,
  onSend,
  placeholder,
  savingModel,
  selectedModel,
  sending,
}: {
  disabled: boolean
  draft: string
  effectiveModel: MobileProviderModel | null
  modelError: string | null
  modelOptions: MobileProviderModel[]
  modelSelectionEnabled: boolean
  modelPanelOpen: boolean
  modelsLoading: boolean
  onChangeText: (value: string) => void
  onModelPanelOpenChange: (open: boolean) => void
  onModelSelect: (modelValue: string | null) => void
  onSend: () => void
  placeholder: string
  savingModel: boolean
  selectedModel: string | null
  sending: boolean
}) {
  const { t } = useI18n()
  const selectedModelOption = React.useMemo(
    () => modelOptions.find((model) => modelValue(model) === selectedModel) ?? null,
    [modelOptions, selectedModel],
  )
  const modelLabel = selectedModelOption?.name ?? effectiveModel?.name ?? t("thread.model")
  const modelButtonDisabled = !modelSelectionEnabled || modelsLoading || Boolean(savingModel)

  function selectModel(value: string | null) {
    onModelPanelOpenChange(false)
    onModelSelect(value)
  }

  return (
    <View style={{ backgroundColor: "#171717", paddingHorizontal: 14, paddingTop: 10, position: "relative", zIndex: 2 }}>
      <View
        style={{
          backgroundColor: "#262626",
          borderRadius: 28,
          gap: 8,
          minHeight: 64,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#666666"
          spellCheck={false}
          style={{
            color: "#e8e8e8",
            fontSize: 17,
            maxHeight: 96,
            minHeight: 26,
            padding: 0,
            textAlignVertical: "top",
          }}
          value={draft}
        />
        {modelPanelOpen ? (
          <View
            style={{
              backgroundColor: "#1d1d1d",
              borderColor: "#353535",
              borderRadius: 16,
              borderWidth: 1,
              gap: 6,
              maxHeight: 230,
              padding: 8,
            }}
          >
            {modelError ? (
              <Text style={{ color: "#ffb7b7", fontSize: 13, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 6 }}>
                {modelError}
              </Text>
            ) : null}
            {modelsLoading ? (
              <Text style={{ color: "#8f8f8f", fontSize: 13, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 6 }}>
                {t("thread.loadingModels")}
              </Text>
            ) : (
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <ModelOptionRow
                  detail={effectiveModel ? effectiveModelLabel(effectiveModel) : t("thread.useProviderDefault")}
                  selected={!selectedModel}
                  title={t("thread.defaultModel")}
                  onPress={() => selectModel(null)}
                />
                {modelOptions.length ? (
                  modelOptions.map((model) => {
                    const value = modelValue(model)
                    return (
                      <ModelOptionRow
                        detail={model.providerName || model.providerID}
                        key={value}
                        selected={selectedModel === value}
                        title={model.name}
                        onPress={() => selectModel(value)}
                      />
                    )
                  })
                ) : (
                  <Text style={{ color: "#8f8f8f", fontSize: 13, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 8 }}>
                    {t("thread.noModels")}
                  </Text>
                )}
              </ScrollView>
            )}
          </View>
        ) : null}
        <View style={{ alignItems: "center", flexDirection: "row", height: 36, justifyContent: "space-between" }}>
          <ModelSelectorButton
            disabled={modelButtonDisabled}
            label={savingModel ? t("thread.saving") : modelLabel}
            loading={modelsLoading || Boolean(savingModel)}
            open={modelPanelOpen}
            onPress={() => {
              if (modelButtonDisabled && !modelPanelOpen) return
              onModelPanelOpenChange(!modelPanelOpen)
            }}
          />
          <View style={{ flexDirection: "row", gap: 14 }}>
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={onSend}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: disabled ? "#3a3a3a" : "#e8e8e8",
                borderRadius: 16,
                height: 32,
                justifyContent: "center",
                opacity: pressed ? 0.78 : 1,
                width: 32,
              })}
            >
              <Text style={{ color: disabled ? "#777777" : "#171717", fontSize: 15, fontWeight: "900" }}>
                {sending ? "…" : "↑"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  )
}

function ModelSelectorButton({
  disabled,
  label,
  loading,
  onPress,
  open,
}: {
  disabled: boolean
  label: string
  loading: boolean
  onPress: () => void
  open: boolean
}) {
  return (
    <Pressable
      accessibilityLabel="Select model"
      accessibilityRole="button"
      disabled={disabled && !open}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        flexDirection: "row",
        gap: 6,
        maxWidth: "72%",
        opacity: disabled ? 0.45 : pressed ? 0.62 : 1,
        paddingVertical: 5,
      })}
    >
      <Text numberOfLines={1} style={{ color: "#cfcfcf", flexShrink: 1, fontSize: 12, fontWeight: "800" }}>
        {label}
      </Text>
      <Feather color="#a9a9a9" name={loading ? "loader" : open ? "chevron-down" : "chevron-up"} size={14} />
    </Pressable>
  )
}

function ModelOptionRow({
  detail,
  selected,
  title,
  onPress,
}: {
  detail: string
  selected: boolean
  title: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: selected ? "#343434" : pressed ? "#282828" : "transparent",
        borderRadius: 11,
        flexDirection: "row",
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 10,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: "#f2f2f2", fontSize: 14, fontWeight: "800" }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ color: "#8f8f8f", fontSize: 11, fontWeight: "700" }}>
          {detail}
        </Text>
      </View>
      {selected ? <Feather color="#74d58b" name="check" size={16} /> : null}
    </Pressable>
  )
}

function modelValue(model: MobileProviderModel) {
  return `${model.providerID}/${model.id}`
}

function effectiveModelLabel(model: MobileProviderModel) {
  const provider = model.providerName || model.providerID
  return `${model.name} · ${provider}`
}

function TopIconButton({
  accessibilityLabel,
  disabled,
  icon,
  label,
  onPress,
}: {
  accessibilityLabel?: string
  disabled?: boolean
  icon?: FeatherName
  label?: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        borderRadius: 8,
        height: 32,
        justifyContent: "center",
        opacity: disabled ? 0.38 : pressed ? 0.62 : 1,
        width: 32,
      })}
    >
      {icon ? (
        <Feather color="#e8e8e8" name={icon} size={22} />
      ) : (
        <Text style={{ color: "#e8e8e8", fontSize: (label?.length ?? 0) > 1 ? 14 : 24, fontWeight: "800" }}>{label}</Text>
      )}
    </Pressable>
  )
}
