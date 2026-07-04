import React from "react"
import Feather from "@expo/vector-icons/Feather"
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native"
import type { MobileSessionSummary, MobileWorkspace } from "@/api/mobile-api"
import { compareSessions } from "@/home/format"
import { useI18n } from "@/i18n"
import { formatRelativeTime } from "@/utils/format"

export function SessionDrawerPage({
  focusedSessionID,
  focusedWorkspaceID,
  onOpenSettings,
  onDeleteSession,
  onRenameSession,
  onSelectSession,
  onSelectWorkspace,
  onTogglePinSession,
  paddingBottom,
  paddingTop,
  sessions,
  workspaces,
}: {
  focusedSessionID?: string
  focusedWorkspaceID?: string
  onOpenSettings: () => void
  onDeleteSession: (session: MobileSessionSummary, workspace: MobileWorkspace) => Promise<void> | void
  onRenameSession: (session: MobileSessionSummary, workspace: MobileWorkspace, title: string) => Promise<void> | void
  onSelectSession: (session: MobileSessionSummary, workspace: MobileWorkspace) => void
  onSelectWorkspace: (workspace: MobileWorkspace) => void
  onTogglePinSession: (session: MobileSessionSummary, workspace: MobileWorkspace, pinned: boolean) => Promise<void> | void
  paddingBottom: number
  paddingTop: number
  sessions: MobileSessionSummary[]
  workspaces: MobileWorkspace[]
}) {
  const { t } = useI18n()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchText, setSearchText] = React.useState("")
  const [actionTarget, setActionTarget] = React.useState<{ session: MobileSessionSummary; workspace: MobileWorkspace } | null>(null)
  const [actionMode, setActionMode] = React.useState<"actions" | "rename" | "delete">("actions")
  const [actionPending, setActionPending] = React.useState<"pin" | "rename" | "delete" | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [renameText, setRenameText] = React.useState("")
  const [expandedWorkspaceIDs, setExpandedWorkspaceIDs] = React.useState<Set<string>>(() =>
    focusedWorkspaceID ? new Set([focusedWorkspaceID]) : new Set(),
  )
  const searchQuery = searchText.trim().toLocaleLowerCase()
  const drawerWorkspaces = React.useMemo(() => {
    return workspaces
      .map((workspace) => {
        const workspaceSessions = workspace.id === focusedWorkspaceID ? sessions : sortDrawerSessions(workspace.sessions)
        const workspaceMatches = searchQuery ? workspace.name.toLocaleLowerCase().includes(searchQuery) : false
        const visibleSessions = searchQuery && !workspaceMatches
          ? workspaceSessions.filter((session) => sessionMatchesSearch(session, searchQuery))
          : workspaceSessions
        const selected = workspace.id === focusedWorkspaceID
        return {
          expanded: searchQuery ? visibleSessions.length > 0 : expandedWorkspaceIDs.has(workspace.id),
          matches: workspaceMatches,
          selected,
          sessionCount: visibleSessions.length,
          sessions: visibleSessions,
          workspace,
        }
      })
      .filter((workspace) => !searchQuery || workspace.matches || workspace.sessions.length > 0)
  }, [expandedWorkspaceIDs, focusedWorkspaceID, searchQuery, sessions, workspaces])

  React.useEffect(() => {
    if (!focusedWorkspaceID) return
    setExpandedWorkspaceIDs((current) => {
      if (current.has(focusedWorkspaceID)) return current
      const next = new Set(current)
      next.add(focusedWorkspaceID)
      return next
    })
  }, [focusedWorkspaceID])

  function handleSearchButtonPress() {
    if (searchOpen) {
      setSearchText("")
      setSearchOpen(false)
      return
    }
    setSearchOpen(true)
  }

  function handleWorkspacePress(workspace: MobileWorkspace) {
    onSelectWorkspace(workspace)
    if (searchQuery) return
    setExpandedWorkspaceIDs((current) => {
      const next = new Set(current)
      if (next.has(workspace.id)) {
        next.delete(workspace.id)
      } else {
        next.add(workspace.id)
      }
      return next
    })
  }

  function openSessionActions(session: MobileSessionSummary, workspace: MobileWorkspace) {
    setActionTarget({ session, workspace })
    setActionMode("actions")
    setActionPending(null)
    setActionError(null)
    setRenameText(session.title)
  }

  function closeSessionActions() {
    if (actionPending) return
    setActionTarget(null)
    setActionMode("actions")
    setActionError(null)
    setRenameText("")
  }

  async function handleTogglePin() {
    if (!actionTarget || actionPending) return
    setActionPending("pin")
    setActionError(null)
    try {
      await onTogglePinSession(actionTarget.session, actionTarget.workspace, !actionTarget.session.pinned)
      closeSessionActionsAfterAction()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("drawer.actionFailed"))
    } finally {
      setActionPending(null)
    }
  }

  async function handleRenameSubmit() {
    if (!actionTarget || actionPending) return
    const title = renameText.trim()
    if (!title) return
    if (title === actionTarget.session.title) {
      closeSessionActions()
      return
    }
    setActionPending("rename")
    setActionError(null)
    try {
      await onRenameSession(actionTarget.session, actionTarget.workspace, title)
      closeSessionActionsAfterAction()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("drawer.actionFailed"))
    } finally {
      setActionPending(null)
    }
  }

  async function handleDeleteConfirm() {
    if (!actionTarget || actionPending) return
    setActionPending("delete")
    setActionError(null)
    try {
      await onDeleteSession(actionTarget.session, actionTarget.workspace)
      closeSessionActionsAfterAction()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("drawer.actionFailed"))
    } finally {
      setActionPending(null)
    }
  }

  function closeSessionActionsAfterAction() {
    setActionTarget(null)
    setActionMode("actions")
    setActionError(null)
    setRenameText("")
  }

  return (
    <View style={{ backgroundColor: "#191919", flex: 1, paddingBottom, paddingTop }}>
      <View style={{ alignSelf: "center", flex: 1, width: "100%", maxWidth: 430 }}>
        <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 14 }}>
          <View style={{ alignItems: "center", flexDirection: "row", minHeight: 46, paddingBottom: 10 }}>
            <DrawerHeaderButton onPress={onOpenSettings} />
            <Text numberOfLines={1} style={{ color: "#f2f2f2", flex: 1, fontSize: 30, fontWeight: "900", textAlign: "center" }}>
              Anybox
            </Text>
            <DrawerSearchButton active={searchOpen} onPress={handleSearchButtonPress} />
          </View>
          {searchOpen ? (
            <View
              style={{
                alignItems: "center",
                backgroundColor: "#272727",
                borderColor: "#3a3a3a",
                borderRadius: 18,
                borderWidth: 1,
                flexDirection: "row",
                gap: 8,
                height: 44,
                marginBottom: 10,
                paddingHorizontal: 12,
              }}
            >
              <Feather color="#a9a9a9" name="search" size={18} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                clearButtonMode="while-editing"
                onChangeText={setSearchText}
                placeholder={t("drawer.searchSessions")}
                placeholderTextColor="#777777"
                returnKeyType="search"
                spellCheck={false}
                style={{ color: "#e8e8e8", flex: 1, fontSize: 15, fontWeight: "700", padding: 0 }}
                value={searchText}
              />
              {searchText ? (
                <Pressable
                  accessibilityLabel="Clear session search"
                  accessibilityRole="button"
                  onPress={() => setSearchText("")}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    height: 28,
                    justifyContent: "center",
                    opacity: pressed ? 0.62 : 1,
                    width: 28,
                  })}
                >
                  <Feather color="#cfcfcf" name="x" size={16} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <ScrollView
            contentContainerStyle={{ gap: 4, paddingBottom: 18, paddingTop: 14 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {drawerWorkspaces.length ? (
              drawerWorkspaces.map(({ expanded, selected, sessionCount, sessions: visibleSessions, workspace }) => {
                return (
                  <View key={workspace.id} style={{ gap: 3 }}>
                    <DrawerProjectRow
                      expanded={expanded}
                      selected={selected}
                      sessionCount={sessionCount}
                      title={workspace.name}
                      onPress={() => handleWorkspacePress(workspace)}
                    />
                    {expanded ? (
                      <View style={{ borderLeftColor: "#2b2b2b", borderLeftWidth: 1, gap: 3, marginLeft: 18, paddingLeft: 10, paddingVertical: 2 }}>
                        {visibleSessions.length ? (
                          visibleSessions.map((session) => (
                            <DrawerSessionRow
                              key={session.id}
                              meta={session.workflow?.status}
                              pinned={session.pinned}
                              pinnedLabel={t("drawer.pinned")}
                              selected={session.id === focusedSessionID}
                              title={session.title}
                              updated={session.updated}
                              onLongPress={() => openSessionActions(session, workspace)}
                              onPress={() => onSelectSession(session, workspace)}
                            />
                          ))
                        ) : (
                          <Text selectable style={{ color: "#8c8c8c", fontSize: 13, paddingHorizontal: 10, paddingVertical: 8 }}>
                            {t("drawer.noSessions")}
                          </Text>
                        )}
                      </View>
                    ) : null}
                  </View>
                )
              })
            ) : (
              <View style={{ alignItems: "center", justifyContent: "center", minHeight: 220 }}>
                <Text selectable style={{ color: "#8c8c8c", fontSize: 15, fontWeight: "700" }}>
                  {searchQuery ? t("drawer.noMatchingSessions") : t("drawer.noProjects")}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>

      </View>
      <SessionActionModal
        error={actionError}
        mode={actionMode}
        pending={actionPending}
        renameText={renameText}
        target={actionTarget}
        onCancel={closeSessionActions}
        onChangeRenameText={setRenameText}
        onConfirmDelete={handleDeleteConfirm}
        onRenameSubmit={handleRenameSubmit}
        onRequestDelete={() => {
          setActionError(null)
          setActionMode("delete")
        }}
        onRequestRename={() => {
          setActionError(null)
          setActionMode("rename")
          setRenameText(actionTarget?.session.title ?? "")
        }}
        onTogglePin={handleTogglePin}
      />
    </View>
  )
}

function DrawerHeaderButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Account and settings"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 38,
        justifyContent: "center",
        opacity: pressed ? 0.78 : 1,
        width: 38,
      })}
    >
      <Feather color="#f2f2f2" name="user" size={30} />
    </Pressable>
  )
}

function DrawerSearchButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={active ? "Close session search" : "Search sessions"}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 38,
        justifyContent: "center",
        opacity: pressed ? 0.78 : 1,
        width: 38,
      })}
    >
      <Feather color="#f2f2f2" name={active ? "x" : "search"} size={30} />
    </Pressable>
  )
}

function DrawerProjectRow({
  expanded,
  selected,
  sessionCount,
  title,
  onPress,
}: {
  expanded: boolean
  selected: boolean
  sessionCount: number
  title: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${title}`}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: selected ? (pressed ? "#303030" : "#242424") : pressed ? "#202020" : "transparent",
        borderRadius: 9,
        flexDirection: "row",
        gap: 9,
        minHeight: 44,
        paddingHorizontal: 10,
      })}
    >
      <Feather color={selected ? "#ffffff" : "#bdbdbd"} name={expanded ? "chevron-down" : "chevron-right"} size={16} />
      <Text numberOfLines={1} style={{ color: selected ? "#ffffff" : "#e8e8e8", flex: 1, fontSize: 15, fontWeight: "700" }}>
        {title}
      </Text>
      <View
        style={{
          alignItems: "center",
          backgroundColor: selected ? "#3a3a3a" : "#252525",
          borderRadius: 9,
          minWidth: 28,
          paddingHorizontal: 7,
          paddingVertical: 3,
        }}
      >
        <Text style={{ color: selected ? "#f2f2f2" : "#a9a9a9", fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "800" }}>
          {sessionCount}
        </Text>
      </View>
    </Pressable>
  )
}

function DrawerSessionRow({
  meta,
  pinned,
  pinnedLabel,
  selected,
  title,
  updated,
  onLongPress,
  onPress,
}: {
  meta?: string
  pinned?: boolean
  pinnedLabel: string
  selected: boolean
  title: string
  updated: number
  onLongPress: () => void
  onPress: () => void
}) {
  const statusLabel = importantSessionStatusLabel(meta)
  const detailLabel = statusLabel ?? formatRelativeTime(updated)
  const detailTone = statusLabel ? sessionStatusColor(meta) : "#8c8c8c"
  const longPressTriggeredRef = React.useRef(false)

  function handleLongPress() {
    longPressTriggeredRef.current = true
    onLongPress()
  }

  function handlePress() {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }
    onPress()
  }

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={2}
      onLongPress={handleLongPress}
      onPress={handlePress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: selected ? (pressed ? "#555555" : "#474747") : pressed ? "#252525" : "transparent",
        borderRadius: 10,
        flexDirection: "row",
        gap: 9,
        minHeight: 38,
        paddingHorizontal: 10,
      })}
    >
      <View style={{ backgroundColor: selected ? "#f2f2f2" : "transparent", borderRadius: 2, height: 18, width: 3 }} />
      <Text numberOfLines={1} style={{ color: selected ? "#ffffff" : "#d6d6d6", flex: 1, fontSize: 13, fontWeight: selected ? "800" : "600" }}>
        {title}
      </Text>
      {pinned ? (
        <Feather accessibilityLabel={pinnedLabel} color={selected ? "#f2f2f2" : "#a9a9a9"} name="bookmark" size={13} />
      ) : null}
      {detailLabel ? (
        <Text numberOfLines={1} style={{ color: detailTone, flexShrink: 0, fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "700" }}>
          {detailLabel}
        </Text>
      ) : null}
    </Pressable>
  )
}

function SessionActionModal({
  error,
  mode,
  pending,
  renameText,
  target,
  onCancel,
  onChangeRenameText,
  onConfirmDelete,
  onRenameSubmit,
  onRequestDelete,
  onRequestRename,
  onTogglePin,
}: {
  error: string | null
  mode: "actions" | "rename" | "delete"
  pending: "pin" | "rename" | "delete" | null
  renameText: string
  target: { session: MobileSessionSummary; workspace: MobileWorkspace } | null
  onCancel: () => void
  onChangeRenameText: (text: string) => void
  onConfirmDelete: () => void
  onRenameSubmit: () => void
  onRequestDelete: () => void
  onRequestRename: () => void
  onTogglePin: () => void
}) {
  const { t } = useI18n()
  const visible = Boolean(target)
  const title = target?.session.title ?? ""
  const pinned = Boolean(target?.session.pinned)
  const renameDisabled = pending !== null || !renameText.trim()

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
      <View style={{ alignItems: "center", backgroundColor: "rgba(0, 0, 0, 0.58)", flex: 1, justifyContent: "center", padding: 22 }}>
        <Pressable accessibilityLabel={t("app.cancel")} onPress={onCancel} style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }} />
        <View
          style={{
            backgroundColor: "#242424",
            borderColor: "#3a3a3a",
            borderRadius: 18,
            borderWidth: 1,
            maxWidth: 340,
            overflow: "hidden",
            padding: 14,
            shadowColor: "#000000",
            shadowOpacity: 0.34,
            shadowRadius: 18,
            width: "100%",
          }}
        >
          <View style={{ gap: 5, paddingHorizontal: 4, paddingVertical: 4 }}>
            <Text numberOfLines={1} style={{ color: "#f2f2f2", fontSize: 17, fontWeight: "800" }}>
              {mode === "rename" ? t("drawer.renameSession") : mode === "delete" ? t("drawer.deleteSession") : t("drawer.sessionActions")}
            </Text>
            <Text numberOfLines={2} style={{ color: "#a9a9a9", fontSize: 13, fontWeight: "600", lineHeight: 18 }}>
              {title}
            </Text>
          </View>

          {mode === "actions" ? (
            <View style={{ gap: 4, paddingTop: 10 }}>
              <SessionActionRow
                disabled={Boolean(pending)}
                icon="bookmark"
                label={pinned ? t("drawer.unpinSession") : t("drawer.pinSession")}
                loading={pending === "pin"}
                onPress={onTogglePin}
              />
              <SessionActionRow
                disabled={Boolean(pending)}
                icon="edit-2"
                label={t("drawer.renameSession")}
                onPress={onRequestRename}
              />
              <SessionActionRow
                danger
                disabled={Boolean(pending)}
                icon="trash-2"
                label={t("drawer.deleteSession")}
                onPress={onRequestDelete}
              />
            </View>
          ) : mode === "rename" ? (
            <View style={{ gap: 12, paddingTop: 14 }}>
              <TextInput
                autoCapitalize="sentences"
                autoCorrect
                autoFocus
                editable={!pending}
                onChangeText={onChangeRenameText}
                onSubmitEditing={onRenameSubmit}
                placeholder={t("drawer.renamePlaceholder")}
                placeholderTextColor="#777777"
                returnKeyType="done"
                style={{
                  backgroundColor: "#191919",
                  borderColor: "#3a3a3a",
                  borderRadius: 12,
                  borderWidth: 1,
                  color: "#f2f2f2",
                  fontSize: 15,
                  fontWeight: "700",
                  minHeight: 46,
                  paddingHorizontal: 12,
                }}
                value={renameText}
              />
              <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                <DialogButton disabled={Boolean(pending)} label={t("app.cancel")} onPress={onCancel} />
                <DialogButton primary disabled={renameDisabled} label={pending === "rename" ? t("thread.saving") : t("app.done")} onPress={onRenameSubmit} />
              </View>
            </View>
          ) : (
            <View style={{ gap: 13, paddingTop: 12 }}>
              <Text style={{ color: "#d6d6d6", fontSize: 14, fontWeight: "600", lineHeight: 20 }}>
                {t("drawer.deleteConfirm")}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                <DialogButton disabled={Boolean(pending)} label={t("app.cancel")} onPress={onCancel} />
                <DialogButton danger disabled={Boolean(pending)} label={pending === "delete" ? t("drawer.deleting") : t("drawer.deleteSession")} onPress={onConfirmDelete} />
              </View>
            </View>
          )}

          {error ? (
            <Text selectable style={{ color: "#ff9a9a", fontSize: 12, fontWeight: "700", lineHeight: 17, paddingHorizontal: 4, paddingTop: 12 }}>
              {error}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}

function SessionActionRow({
  danger,
  disabled,
  icon,
  label,
  loading,
  onPress,
}: {
  danger?: boolean
  disabled: boolean
  icon: React.ComponentProps<typeof Feather>["name"]
  label: string
  loading?: boolean
  onPress: () => void
}) {
  const color = danger ? "#ff9a9a" : "#f2f2f2"

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? "#303030" : "transparent",
        borderRadius: 12,
        flexDirection: "row",
        gap: 12,
        minHeight: 46,
        opacity: disabled && !loading ? 0.58 : 1,
        paddingHorizontal: 10,
      })}
    >
      <Feather color={color} name={loading ? "loader" : icon} size={18} />
      <Text style={{ color, flex: 1, fontSize: 15, fontWeight: "800" }}>
        {label}
      </Text>
    </Pressable>
  )
}

function DialogButton({
  danger,
  disabled,
  label,
  primary,
  onPress,
}: {
  danger?: boolean
  disabled?: boolean
  label: string
  primary?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: danger ? "#4a2424" : primary ? "#f2f2f2" : "#303030",
        borderRadius: 12,
        minHeight: 40,
        justifyContent: "center",
        opacity: disabled ? 0.52 : pressed ? 0.78 : 1,
        paddingHorizontal: 14,
      })}
    >
      <Text style={{ color: danger ? "#ffb8b8" : primary ? "#151515" : "#f2f2f2", fontSize: 14, fontWeight: "800" }}>
        {label}
      </Text>
    </Pressable>
  )
}

function sessionMatchesSearch(session: MobileSessionSummary, query: string) {
  return session.title.toLocaleLowerCase().includes(query)
}

function sortDrawerSessions(sessions: MobileSessionSummary[]) {
  return [...sessions].sort(compareSessions)
}

function importantSessionStatusLabel(status?: string) {
  if (status === "running") return "Running"
  if (status === "blocked") return "Blocked"
  if (status === "failed") return "Failed"
  return null
}

function sessionStatusColor(status?: string) {
  if (status === "running") return "#74d58b"
  if (status === "blocked") return "#ffd166"
  if (status === "failed") return "#ff9a9a"
  return "#8c8c8c"
}
