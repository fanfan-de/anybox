import React from "react"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import type { MobileApproval, MobileMessage, MobileSessionSummary, MobileWorkspace } from "@/api/mobile-api"
import { messageHasVisibleContent, messageRole, messageText } from "@/utils/message"
import { darkToneColor } from "./shared"
import type { ProviderStatusTone } from "./types"

export function CurrentSessionHomePage({
  appVersion,
  approvals,
  disabled,
  draft,
  focusedSession,
  focusedWorkspace,
  messageError,
  messages,
  messagesLoading,
  onChangeText,
  onNewChat,
  onOpenApprovals,
  onOpenDiagnostics,
  onOpenProvider,
  onOpenSessionPicker,
  onOpenUpdates,
  onOpenWorkspacePicker,
  onRefresh,
  onSend,
  paddingBottom,
  paddingTop,
  placeholder,
  providerDetail,
  providerLabel,
  providerTone,
  refreshing,
  sending,
}: {
  appVersion: string
  approvals: MobileApproval[]
  disabled: boolean
  draft: string
  focusedSession: MobileSessionSummary | null
  focusedWorkspace: MobileWorkspace | null
  messageError: string | null
  messages: MobileMessage[]
  messagesLoading: boolean
  onChangeText: (value: string) => void
  onNewChat: () => void
  onOpenApprovals: () => void
  onOpenDiagnostics: () => void
  onOpenProvider: () => void
  onOpenSessionPicker: () => void
  onOpenUpdates: () => void
  onOpenWorkspacePicker: () => void
  onRefresh: () => void
  onSend: () => void
  paddingBottom: number
  paddingTop: number
  placeholder: string
  providerDetail: string
  providerLabel: string
  providerTone: ProviderStatusTone
  refreshing: boolean
  sending: boolean
}) {
  const title = focusedSession?.title ?? "New session"
  const workspaceName = focusedWorkspace?.name ?? "Select project"
  const visibleMessages = React.useMemo(() => messages.filter(messageHasVisibleContent), [messages])

  return (
    <View style={{ backgroundColor: "#171717", flex: 1, paddingBottom, paddingTop }}>
      <View style={{ alignSelf: "center", flex: 1, maxWidth: 430, width: "100%" }}>
        <View style={{ gap: 10, paddingHorizontal: 16, paddingTop: 10 }}>
          {approvals.length ? <ApprovalPriorityBanner approvals={approvals} onOpen={onOpenApprovals} /> : null}

          <View style={{ alignItems: "center", flexDirection: "row", gap: 10, minHeight: 54 }}>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenSessionPicker}
              style={({ pressed }) => ({
                flex: 1,
                gap: 3,
                opacity: pressed ? 0.78 : 1,
                paddingVertical: 4,
              })}
            >
              <Text style={{ color: "#8f8f8f", fontSize: 12, fontWeight: "800" }}>Current session</Text>
              <Text numberOfLines={1} style={{ color: "#f1f1f1", fontSize: 23, fontWeight: "900" }}>
                {title}
              </Text>
            </Pressable>
            <TopActionButton label={refreshing ? "..." : "Refresh"} onPress={onRefresh} />
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <ContextButton label={workspaceName} onPress={onOpenWorkspacePicker} />
            <ContextButton label={focusedSession ? "Switch session" : "Choose session"} onPress={onOpenSessionPicker} />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ gap: 14, paddingBottom: 18, paddingHorizontal: 22, paddingTop: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {messageError ? <DarkNotice title="Composer failed" detail={messageError} tone="danger" /> : null}
          {focusedWorkspace && !focusedSession ? <AssistantIntro workspaceName={focusedWorkspace.name} /> : null}
          {focusedSession ? (
            visibleMessages.length ? (
              visibleMessages.map((message, index) => (
                <ThreadMessage key={message.info?.id ?? `${index}`} message={message} />
              ))
            ) : (
              <DarkEmpty title={messagesLoading ? "Loading session" : "No messages"} />
            )
          ) : !focusedWorkspace ? (
            <DarkEmpty title="Connect a project to start" />
          ) : null}
        </ScrollView>

        <ThreadComposer
          disabled={disabled}
          draft={draft}
          onChangeText={onChangeText}
          onNewChat={onNewChat}
          onSend={onSend}
          placeholder={placeholder}
          sending={sending}
        />

        <SecondaryActions
          appVersion={appVersion}
          providerDetail={providerDetail}
          providerLabel={providerLabel}
          providerTone={providerTone}
          onOpenDiagnostics={onOpenDiagnostics}
          onOpenProvider={onOpenProvider}
          onOpenUpdates={onOpenUpdates}
        />
      </View>
    </View>
  )
}

function ApprovalPriorityBanner({
  approvals,
  onOpen,
}: {
  approvals: MobileApproval[]
  onOpen: () => void
}) {
  const firstApproval = approvals[0]

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => ({
        backgroundColor: "#fff4df",
        borderColor: "#e9c987",
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
        opacity: pressed ? 0.78 : 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
      })}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <Text style={{ color: "#7a4c00", flex: 1, fontSize: 13, fontWeight: "900" }}>Approval needed</Text>
        <Text selectable style={{ color: "#7a4c00", fontSize: 13, fontVariant: ["tabular-nums"], fontWeight: "900" }}>
          {approvals.length}
        </Text>
      </View>
      <Text numberOfLines={2} style={{ color: "#262016", fontSize: 15, fontWeight: "800", lineHeight: 19 }}>
        {firstApproval?.prompt.title ?? "Review pending request"}
      </Text>
      <Text style={{ color: "#7a4c00", fontSize: 12, fontWeight: "900" }}>Open approvals</Text>
    </Pressable>
  )
}

function SecondaryActions({
  appVersion,
  providerDetail,
  providerLabel,
  providerTone,
  onOpenDiagnostics,
  onOpenProvider,
  onOpenUpdates,
}: {
  appVersion: string
  providerDetail: string
  providerLabel: string
  providerTone: ProviderStatusTone
  onOpenDiagnostics: () => void
  onOpenProvider: () => void
  onOpenUpdates: () => void
}) {
  return (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingTop: 8 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
        <View style={{ backgroundColor: darkToneColor(providerTone), borderRadius: 4, height: 8, width: 8 }} />
        <Text numberOfLines={1} style={{ color: "#8f8f8f", flex: 1, fontSize: 12 }}>
          {providerDetail}
        </Text>
        <Text style={{ color: darkToneColor(providerTone), fontSize: 12, fontWeight: "800" }}>{providerLabel}</Text>
      </View>
      <View style={{ alignItems: "center", flexDirection: "row", justifyContent: "center", minHeight: 30 }}>
        <SecondaryLink label="Provider" onPress={onOpenProvider} />
        <SecondaryDivider />
        <SecondaryLink label={`Updates ${appVersion}`} onPress={onOpenUpdates} />
        <SecondaryDivider />
        <SecondaryLink label="Diagnostics" onPress={onOpenDiagnostics} />
      </View>
    </View>
  )
}

function SecondaryDivider() {
  return <Text style={{ color: "#565656", fontSize: 12 }}> / </Text>
}

function SecondaryLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1, padding: 5 })}>
      <Text numberOfLines={1} style={{ color: "#bdbdbd", fontSize: 12, fontWeight: "800" }}>
        {label}
      </Text>
    </Pressable>
  )
}

function ContextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: "#262626",
        borderRadius: 8,
        flex: 1,
        minHeight: 38,
        opacity: pressed ? 0.78 : 1,
        paddingHorizontal: 12,
        paddingVertical: 9,
      })}
    >
      <Text numberOfLines={1} style={{ color: "#dcdcdc", fontSize: 13, fontWeight: "800" }}>
        {label}
      </Text>
    </Pressable>
  )
}

function ThreadMessage({ message }: { message: MobileMessage }) {
  const role = messageRole(message)
  const isUser = role === "user"
  const text = messageText(message)

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
        <Text style={{ color: "#e8e8e8", fontSize: 16, fontWeight: "900" }}>anybox</Text>
      </View>
      <Text selectable style={{ color: "#dedede", fontSize: 16, lineHeight: 22 }}>
        {text || "..."}
      </Text>
    </View>
  )
}

function AssistantIntro({ workspaceName }: { workspaceName: string }) {
  return (
    <View style={{ gap: 10, paddingTop: 14 }}>
      <Text style={{ color: "#e8e8e8", fontSize: 15, fontWeight: "800" }}>anybox</Text>
      <Text selectable style={{ color: "#dedede", fontSize: 16, lineHeight: 22 }}>
        {`Ready in ${workspaceName}. Send a task to create a focused session.`}
      </Text>
    </View>
  )
}

function ThreadComposer({
  disabled,
  draft,
  onChangeText,
  onNewChat,
  onSend,
  placeholder,
  sending,
}: {
  disabled: boolean
  draft: string
  onChangeText: (value: string) => void
  onNewChat: () => void
  onSend: () => void
  placeholder: string
  sending: boolean
}) {
  return (
    <View style={{ backgroundColor: "#171717", paddingHorizontal: 14, paddingTop: 10 }}>
      <View
        style={{
          backgroundColor: "#262626",
          borderRadius: 20,
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
        <View style={{ alignItems: "center", flexDirection: "row", height: 36, justifyContent: "space-between" }}>
          <ComposerIcon label="New" onPress={onNewChat} />
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
              width: 72,
            })}
          >
            <Text style={{ color: disabled ? "#777777" : "#171717", fontSize: 14, fontWeight: "900" }}>
              {sending ? "Sending" : "Send"}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

function ComposerIcon({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1, paddingVertical: 5 })}>
      <Text style={{ color: "#cfcfcf", fontSize: 13, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  )
}

function TopActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: "#262626",
        borderRadius: 8,
        justifyContent: "center",
        minHeight: 38,
        opacity: pressed ? 0.62 : 1,
        paddingHorizontal: 12,
      })}
    >
      <Text style={{ color: "#e8e8e8", fontSize: 12, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  )
}

function DarkEmpty({ title }: { title: string }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center", minHeight: 300 }}>
      <Text selectable style={{ color: "#777777", fontSize: 15, fontWeight: "700" }}>
        {title}
      </Text>
    </View>
  )
}

function DarkNotice({
  detail,
  title,
  tone,
}: {
  detail?: string
  title: string
  tone: "danger" | "neutral"
}) {
  return (
    <View style={{ backgroundColor: tone === "danger" ? "#341c1c" : "#262626", borderRadius: 12, gap: 5, padding: 12 }}>
      <Text selectable style={{ color: tone === "danger" ? "#ffb7b7" : "#e8e8e8", fontSize: 14, fontWeight: "800" }}>
        {title}
      </Text>
      {detail ? (
        <Text selectable style={{ color: "#cfcfcf", fontSize: 13, lineHeight: 18 }}>
          {detail}
        </Text>
      ) : null}
    </View>
  )
}
