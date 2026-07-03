import React from "react"
import Feather from "@expo/vector-icons/Feather"
import { Pressable, ScrollView, Text, TextInput, View } from "react-native"
import type { MobileSessionSummary, MobileWorkspace } from "@/api/mobile-api"
import { formatRelativeTime } from "@/utils/format"
import { DarkToolbarButton } from "./shared"

export function SessionDrawerPage({
  focusedSessionID,
  focusedWorkspaceID,
  onNewChat,
  onOpenSettings,
  onSelectSession,
  onSelectWorkspace,
  paddingBottom,
  paddingTop,
  sending,
  sessions,
  workspaces,
}: {
  focusedSessionID?: string
  focusedWorkspaceID?: string
  onNewChat: () => void
  onOpenSettings: () => void
  onSelectSession: (session: MobileSessionSummary, workspace: MobileWorkspace) => void
  onSelectWorkspace: (workspace: MobileWorkspace) => void
  paddingBottom: number
  paddingTop: number
  sending: boolean
  sessions: MobileSessionSummary[]
  workspaces: MobileWorkspace[]
}) {
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchText, setSearchText] = React.useState("")
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
                placeholder="Search sessions"
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
                              selected={session.id === focusedSessionID}
                              title={session.title}
                              updated={session.updated}
                              onPress={() => onSelectSession(session, workspace)}
                            />
                          ))
                        ) : (
                          <Text selectable style={{ color: "#8c8c8c", fontSize: 13, paddingHorizontal: 10, paddingVertical: 8 }}>
                            No sessions yet
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
                  {searchQuery ? "No matching sessions" : "No projects"}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>

        <View style={{ alignItems: "center", paddingHorizontal: 14, paddingTop: 10 }}>
          <View style={{ alignItems: "center", flexDirection: "row", gap: 18, justifyContent: "center", minHeight: 34 }}>
            <DarkToolbarButton label={sending ? "Sending" : "New"} onPress={onNewChat} />
          </View>
        </View>
      </View>
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
  selected,
  title,
  updated,
  onPress,
}: {
  meta?: string
  selected: boolean
  title: string
  updated: number
  onPress: () => void
}) {
  const statusLabel = importantSessionStatusLabel(meta)
  const detailLabel = statusLabel ?? formatRelativeTime(updated)
  const detailTone = statusLabel ? sessionStatusColor(meta) : "#8c8c8c"

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={2}
      onPress={onPress}
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
      {detailLabel ? (
        <Text numberOfLines={1} style={{ color: detailTone, flexShrink: 0, fontSize: 11, fontVariant: ["tabular-nums"], fontWeight: "700" }}>
          {detailLabel}
        </Text>
      ) : null}
    </Pressable>
  )
}

function sessionMatchesSearch(session: MobileSessionSummary, query: string) {
  return session.title.toLocaleLowerCase().includes(query)
}

function sortDrawerSessions(sessions: MobileSessionSummary[]) {
  return [...sessions].sort((left, right) => right.updated - left.updated)
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
