import React from "react"
import Feather from "@expo/vector-icons/Feather"
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import type { MobileApproval, MobileMessage, MobileProviderModel, MobileSessionSummary, MobileWorkspace } from "@/api/mobile-api"
import { ApprovalCard } from "./approval-card"
import { messageContentSegments, messageRole, messageText, type MessageContentSegment } from "@/utils/message"
import { DarkEmpty, DarkNotice } from "./shared"

type FeatherName = React.ComponentProps<typeof Feather>["name"]

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
  modelsLoading,
  onApproveApproval,
  onChangeText,
  onDenyApproval,
  onModelSelect,
  onNewChat,
  onOpenDrawer,
  onSend,
  paddingBottom,
  paddingTop,
  placeholder,
  savingModel,
  selectedModel,
  sending,
}: {
  actingApprovalID: string | null
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
  modelsLoading: boolean
  onApproveApproval: (approval: MobileApproval) => void
  onChangeText: (value: string) => void
  onDenyApproval: (approval: MobileApproval) => void
  onModelSelect: (modelValue: string | null) => void
  onNewChat: () => void
  onOpenDrawer: () => void
  onSend: () => void
  paddingBottom: number
  paddingTop: number
  placeholder: string
  savingModel: boolean
  selectedModel: string | null
  sending: boolean
}) {
  const title = focusedSession?.title ?? "New session"
  const timelineItems = React.useMemo(() => buildThreadTimeline(messages, approvals), [approvals, messages])

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
      style={{ backgroundColor: "#171717", flex: 1 }}
    >
      <View style={{ alignSelf: "center", flex: 1, width: "100%", maxWidth: 430, paddingBottom, paddingTop }}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 10, height: 58, paddingHorizontal: 14 }}>
          <TopIconButton accessibilityLabel="Open projects and sessions" icon="menu" onPress={onOpenDrawer} />
          <View style={{ alignItems: "center", flex: 1, flexDirection: "row" }}>
            <Text numberOfLines={1} style={{ color: "#e8e8e8", flexShrink: 1, fontSize: 25, fontWeight: "800" }}>
              {title}
            </Text>
          </View>
          <TopIconButton accessibilityLabel="New session" disabled={!focusedWorkspace || sending} icon="edit-3" onPress={onNewChat} />
        </View>

        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ gap: 14, paddingBottom: 18, paddingHorizontal: 22, paddingTop: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {messageError ? (
            <DarkNotice title="Composer failed" detail={messageError} tone="danger" />
          ) : null}
          {approvalError ? (
            <DarkNotice title="Approval action failed" detail={approvalError} tone="danger" />
          ) : null}
          {focusedWorkspace && !focusedSession ? (
            <AssistantIntro workspaceName={focusedWorkspace.name} />
          ) : null}
          {focusedSession ? (
            timelineItems.length ? (
              timelineItems.map((item, index) => (
                item.type === "message" ? (
                  <ThreadMessage key={item.message.info?.id ?? `message-${index}`} message={item.message} />
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
              <DarkEmpty title={messagesLoading ? "Loading session" : "No messages"} />
            )
          ) : null}
        </ScrollView>

        <ThreadComposer
          disabled={disabled}
          draft={draft}
          effectiveModel={effectiveModel}
          modelError={modelError}
          modelOptions={modelOptions}
          modelsLoading={modelsLoading}
          onChangeText={onChangeText}
          onModelSelect={onModelSelect}
          onSend={onSend}
          placeholder={placeholder}
          savingModel={savingModel}
          selectedModel={selectedModel}
          sessionReady={Boolean(focusedSession)}
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

function ThreadMessage({ message }: { message: MobileMessage }) {
  const role = messageRole(message)
  const isUser = role === "user"
  const text = messageText(message)
  const contentSegments = messageContentSegments(message)

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
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <Text style={{ color: "#e8e8e8", fontSize: 16, fontWeight: "900" }}>⌘</Text>
        <Text style={{ color: "#e8e8e8", fontSize: 15, fontWeight: "800" }}>anybox</Text>
      </View>
      <AssistantMessageContent segments={contentSegments.length ? contentSegments : [{ kind: "response", text: text || "..." }]} />
    </View>
  )
}

function AssistantMessageContent({ segments }: { segments: MessageContentSegment[] }) {
  const hasReasoning = segments.some((segment) => segment.kind === "reasoning" && segment.text.trim())

  return (
    <View style={{ gap: 10 }}>
      {segments.map((segment, index) => (
        segment.kind === "reasoning" ? (
          <ReasoningSegment key={`reasoning-${index}`} text={segment.text} />
        ) : (
          <ResponseSegment hasReasoning={hasReasoning} key={`response-${index}`} text={segment.text} />
        )
      ))}
    </View>
  )
}

function ReasoningSegment({ text }: { text: string }) {
  if (!text.trim()) return null

  return (
    <View
      style={{
        borderLeftColor: "#4a4a4a",
        borderLeftWidth: 2,
        gap: 5,
        paddingLeft: 10,
        paddingVertical: 2,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        <Feather color="#9a9a9a" name="activity" size={12} />
        <Text style={{ color: "#a7a7a7", fontSize: 12, fontWeight: "800" }}>Reasoning</Text>
      </View>
      <Text selectable style={{ color: "#a0a0a0", fontSize: 14, lineHeight: 20 }}>
        {text}
      </Text>
    </View>
  )
}

function ResponseSegment({ hasReasoning, text }: { hasReasoning: boolean; text: string }) {
  if (!text.trim()) return null

  return (
    <View style={{ gap: hasReasoning ? 5 : 0 }}>
      {hasReasoning ? (
        <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
          <Feather color="#bfbfbf" name="message-circle" size={12} />
          <Text style={{ color: "#c7c7c7", fontSize: 12, fontWeight: "800" }}>Response</Text>
        </View>
      ) : null}
      <Text selectable style={{ color: "#dedede", fontSize: 16, lineHeight: 22 }}>
        {text}
      </Text>
    </View>
  )
}

function AssistantIntro({ workspaceName }: { workspaceName: string }) {
  return (
    <View style={{ gap: 10, paddingTop: 14 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <Text style={{ color: "#e8e8e8", fontSize: 16, fontWeight: "900" }}>⌘</Text>
        <Text style={{ color: "#e8e8e8", fontSize: 15, fontWeight: "800" }}>anybox</Text>
      </View>
      <Text selectable style={{ color: "#dedede", fontSize: 16, lineHeight: 22 }}>
        {`Ready in ${workspaceName}. Send a task to create a focused session.`}
      </Text>
    </View>
  )
}

function ThreadComposer({
  disabled,
  draft,
  effectiveModel,
  modelError,
  modelOptions,
  modelsLoading,
  onChangeText,
  onModelSelect,
  onSend,
  placeholder,
  savingModel,
  selectedModel,
  sessionReady,
  sending,
}: {
  disabled: boolean
  draft: string
  effectiveModel: MobileProviderModel | null
  modelError: string | null
  modelOptions: MobileProviderModel[]
  modelsLoading: boolean
  onChangeText: (value: string) => void
  onModelSelect: (modelValue: string | null) => void
  onSend: () => void
  placeholder: string
  savingModel: boolean
  selectedModel: string | null
  sessionReady: boolean
  sending: boolean
}) {
  const [modelPanelOpen, setModelPanelOpen] = React.useState(false)
  const selectedModelOption = React.useMemo(
    () => modelOptions.find((model) => modelValue(model) === selectedModel) ?? null,
    [modelOptions, selectedModel],
  )
  const modelLabel = selectedModelOption?.name ?? effectiveModel?.name ?? "Model"
  const modelButtonDisabled = !sessionReady || modelsLoading || Boolean(savingModel)

  function selectModel(value: string | null) {
    setModelPanelOpen(false)
    onModelSelect(value)
  }

  return (
    <View style={{ backgroundColor: "#171717", paddingHorizontal: 14, paddingTop: 10 }}>
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
                Loading models
              </Text>
            ) : (
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <ModelOptionRow
                  detail={effectiveModel ? effectiveModelLabel(effectiveModel) : "Use provider default"}
                  selected={!selectedModel}
                  title="Default"
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
                    No models available
                  </Text>
                )}
              </ScrollView>
            )}
          </View>
        ) : null}
        <View style={{ alignItems: "center", flexDirection: "row", height: 36, justifyContent: "space-between" }}>
          <ModelSelectorButton
            disabled={!sessionReady}
            label={savingModel ? "Saving" : modelLabel}
            loading={modelsLoading || Boolean(savingModel)}
            open={modelPanelOpen}
            onPress={() => {
              if (modelButtonDisabled && !modelPanelOpen) return
              setModelPanelOpen((current) => !current)
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
      <Feather color="#cfcfcf" name="cpu" size={15} />
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
