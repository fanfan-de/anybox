import Feather from "@expo/vector-icons/Feather"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import React, { useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type KeyboardTypeOptions,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Button } from "@/components/button"
import { Field } from "@/components/field"
import { Screen } from "@/components/screen"
import { Section } from "@/components/section"
import { StateCard } from "@/components/state-card"
import { useI18n } from "@/i18n"
import { theme, type ThemeTone } from "@/theme"
import { useAccount } from "@/state/account"
import {
  describeAccountApiError,
  formatDeviceLimit,
  formatEntitlementFlag,
  formatAccountPlanLabel,
  formatSubscriptionStatus,
} from "@/utils/account-entitlements"

type AccountMode = "login" | "register"
type FeatherName = React.ComponentProps<typeof Feather>["name"]

const authColors = {
  canvas: "#10100f",
  panel: "#171716",
  panelStrong: "#1f1f1d",
  border: "rgba(247, 247, 244, 0.14)",
  borderStrong: "rgba(247, 247, 244, 0.24)",
  text: "#f7f7f4",
  textMuted: "rgba(247, 247, 244, 0.66)",
  textSubtle: "rgba(247, 247, 244, 0.48)",
  primary: "#f7f7f4",
  primaryText: "#121211",
  successBackground: "rgba(116, 213, 139, 0.13)",
  successBorder: "rgba(116, 213, 139, 0.34)",
  successText: "#b7efc3",
  dangerBackground: "rgba(255, 107, 107, 0.12)",
  dangerBorder: "rgba(255, 107, 107, 0.34)",
  dangerText: "#ffb0a8",
} as const

export default function AccountScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ mode?: string }>()
  const { t } = useI18n()
  const { account, clearAccount, defaultBaseUrl, loading, loginWithEmail, refreshAccount, registerWithEmail, updateProfile } = useAccount()
  const [mode, setMode] = useState<AccountMode>("login")
  const [baseUrl, setBaseUrl] = useState(account?.baseUrl ?? defaultBaseUrl)
  const [email, setEmail] = useState(account?.user.email ?? "")
  const [name, setName] = useState(account?.user.name ?? "")
  const [profileName, setProfileName] = useState(account?.user.displayName ?? account?.user.name ?? "")
  const [profileUsername, setProfileUsername] = useState(account?.user.username ?? "")
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(account?.user.avatarUrl ?? "")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)

  const profileHasChanges = useMemo(() => {
    if (!account) return false
    return (
      profileName.trim() !== (account.user.displayName ?? account.user.name ?? "").trim() ||
      profileUsername.trim() !== (account.user.username ?? "").trim() ||
      profileAvatarUrl.trim() !== (account.user.avatarUrl ?? "").trim()
    )
  }, [account, profileName, profileUsername, profileAvatarUrl])

  useEffect(() => {
    if (!account) {
      setEditingProfile(false)
      return
    }
    setProfileName(account.user.displayName ?? account.user.name ?? "")
    setProfileUsername(account.user.username ?? "")
    setProfileAvatarUrl(account.user.avatarUrl ?? "")
    setEditingProfile(false)
  }, [account])

  useEffect(() => {
    if (account) return
    if (params.mode !== "login" && params.mode !== "register") return
    setMode(params.mode)
  }, [account, params.mode])

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      if (mode === "register") {
        const registration = await registerWithEmail({ baseUrl, email, password, name })
        setPassword("")
        setMode("login")
        setMessage(
          registration.verificationEmailSent
            ? t("account.createdVerify")
            : t("account.createdVerificationRequired"),
        )
        return
      }

      await loginWithEmail({ baseUrl, email, password })
      setPassword("")
      router.replace("/")
    } catch (submitError) {
      setError(describeAccountApiError(submitError, t("account.requestFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  async function signOut() {
    Alert.alert("Sign out?", "This removes the Anybox account token from this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          void clearAccount().catch((clearError) => {
            setError(clearError instanceof Error ? clearError.message : "Unable to sign out.")
          })
        },
      },
    ])
  }

  async function refresh() {
    setSubmitting(true)
    setError(null)
    try {
      await refreshAccount()
      setMessage(t("account.refreshed"))
    } catch (refreshError) {
      setError(describeAccountApiError(refreshError, t("account.refreshFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  async function saveProfile() {
    if (!account || submitting) return
    if (!profileHasChanges) {
      setEditingProfile(false)
      return
    }
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      await updateProfile({
        displayName: profileName.trim() || null,
        username: profileUsername.trim() || null,
        avatarUrl: profileAvatarUrl.trim() || null,
      })
      setMessage(t("account.profileSaved"))
      setEditingProfile(false)
    } catch (profileError) {
      setError(describeAccountApiError(profileError, t("account.profileSaveFailed")))
    } finally {
      setSubmitting(false)
    }
  }

  function cancelProfileEdit() {
    if (!account) return
    setProfileName(account.user.displayName ?? account.user.name ?? "")
    setProfileUsername(account.user.username ?? "")
    setProfileAvatarUrl(account.user.avatarUrl ?? "")
    setEditingProfile(false)
  }

  function openAuthForm(nextMode: AccountMode) {
    setMode(nextMode)
    setError(null)
    setMessage(null)
  }

  function closeAuthForm() {
    setError(null)
    setMessage(null)
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace("/")
    }
  }

  function showHelp() {
    Alert.alert(t("account.helpTitle"), t("account.helpMessage"))
  }

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Screen>
          <StateCard title={t("settings.loadingAccount")} />
        </Screen>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerBackTitle: t("nav.settings"), headerShown: Boolean(account), title: t("nav.account") }} />
      {account ? (
        <Screen>
          <Section title="Profile">
            <ProfileSummary
              avatarUrl={account.user.avatarUrl ?? ""}
              displayName={account.user.displayName ?? account.user.name ?? ""}
              email={account.user.email}
              username={account.user.username ?? ""}
            />
            {message ? <StateCard title="Account updated" detail={message} tone="success" /> : null}
            {error ? <StateCard title="Account failed" detail={error} tone="danger" /> : null}
            {editingProfile ? (
              <>
                <Field label="Display name" keyboardType="default" onChangeText={setProfileName} placeholder="Name shown in Anybox" value={profileName} />
                <Field label="Username" keyboardType="default" onChangeText={setProfileUsername} placeholder="lowercase_username" value={profileUsername} />
                <Field label="Avatar URL" keyboardType="url" onChangeText={setProfileAvatarUrl} placeholder="https://example.com/avatar.png" value={profileAvatarUrl} />
                <View style={{ flexDirection: "row", gap: theme.spacing.lg }}>
                  <View style={{ flex: 1 }}>
                    <Button label="Cancel" onPress={cancelProfileEdit} variant="secondary" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button disabled={!profileHasChanges} label="Save profile" loading={submitting} onPress={() => void saveProfile()} />
                  </View>
                </View>
              </>
            ) : (
              <>
                <InfoCard>
                  <InfoRow title="Display name" value={account.user.displayName ?? account.user.name ?? "Not set"} />
                  <InfoRow divided title="Username" value={account.user.username ? `@${account.user.username}` : "Not set"} />
                  <InfoRow divided title="Avatar" value={account.user.avatarUrl ? "Custom image" : "Not set"} />
                </InfoCard>
                <Button
                  label="Edit profile"
                  onPress={() => {
                    setError(null)
                    setMessage(null)
                    setEditingProfile(true)
                  }}
                  variant="secondary"
                />
              </>
            )}
          </Section>

          <Section title="Plan & Workspace">
            <InfoCard>
              <InfoRow title="Workspace" value={account.workspace?.name ?? "Unknown"} />
              <InfoRow badgeTone="neutral" divided title="Plan" value={formatAccountPlanLabel(account)} />
              <InfoRow badgeTone={subscriptionTone(account.subscription?.status)} divided title="Subscription" value={formatSubscriptionStatus(account)} />
              <InfoRow
                badgeTone={flagTone(account.entitlements?.relayEnabled)}
                divided
                title="Relay"
                value={formatEntitlementFlag(account.entitlements?.relayEnabled)}
              />
              <InfoRow
                badgeTone={flagTone(account.entitlements?.modelGatewayEnabled)}
                divided
                title="Model gateway"
                value={formatEntitlementFlag(account.entitlements?.modelGatewayEnabled)}
              />
              <InfoRow divided title="Desktop devices" value={formatDeviceLimit(account.entitlements?.maxDesktopDevices)} />
              <InfoRow divided title="Mobile devices" value={formatDeviceLimit(account.entitlements?.maxMobileDevices)} />
            </InfoCard>
          </Section>

          <Section title="Actions">
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label="Refresh" loading={submitting} onPress={() => void refresh()} variant="secondary" />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Sign out" onPress={() => void signOut()} variant="danger" />
              </View>
            </View>
            <Button label="Done" onPress={() => router.replace("/")} />
          </Section>
        </Screen>
      ) : (
        <SignedOutAccountScreen
          baseUrl={baseUrl}
          email={email}
          error={error}
          message={message}
          mode={mode}
          name={name}
          onBackToLanding={closeAuthForm}
          onHelp={showHelp}
          onModeChange={openAuthForm}
          onNameChange={setName}
          onPasswordChange={setPassword}
          onProviderUrlChange={setBaseUrl}
          onSubmit={() => void submit()}
          onEmailChange={setEmail}
          password={password}
          submitting={submitting}
        />
      )}
    </>
  )
}

function SignedOutAccountScreen({
  baseUrl,
  email,
  error,
  message,
  mode,
  name,
  onBackToLanding,
  onEmailChange,
  onHelp,
  onModeChange,
  onNameChange,
  onPasswordChange,
  onProviderUrlChange,
  onSubmit,
  password,
  submitting,
}: {
  baseUrl: string
  email: string
  error: string | null
  message: string | null
  mode: AccountMode
  name: string
  onBackToLanding: () => void
  onEmailChange: (value: string) => void
  onHelp: () => void
  onModeChange: (mode: AccountMode) => void
  onNameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onProviderUrlChange: (value: string) => void
  onSubmit: () => void
  password: string
  submitting: boolean
}) {
  const insets = useSafeAreaInsets()
  const { height, width } = useWindowDimensions()
  const { t } = useI18n()
  const maxWidth = width >= 760 ? 430 : undefined

  return (
    <>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ backgroundColor: authColors.canvas, flex: 1 }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ backgroundColor: authColors.canvas, flex: 1 }}
          contentContainerStyle={{
            alignItems: "center",
            flexGrow: 1,
            paddingBottom: Math.max(insets.bottom, 18) + 20,
            paddingHorizontal: 24,
            paddingTop: insets.top + 12,
          }}
        >
          <View
            style={{
              flex: 1,
              minHeight: Math.max(620, height - insets.top - insets.bottom - 32),
              width: "100%",
              maxWidth,
            }}
          >
            <View style={{ alignItems: "flex-end", minHeight: 44 }}>
              <Pressable
                accessibilityRole="button"
                onPress={onHelp}
                style={({ pressed }) => ({
                  alignItems: "center",
                  borderRadius: theme.radius.pill,
                  flexDirection: "row",
                  gap: theme.spacing.sm,
                  opacity: pressed ? theme.opacity.pressed : 1,
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.lg,
                })}
              >
                <Feather color={authColors.textSubtle} name="help-circle" size={18} />
                <Text
                  style={{
                    color: authColors.textMuted,
                    fontSize: theme.typography.size.md,
                    fontWeight: theme.typography.weight.bold,
                  }}
                >
                  {t("account.help")}
                </Text>
              </Pressable>
            </View>

            <View
              style={{
                alignItems: "center",
                paddingBottom: 24,
                paddingTop: 24,
              }}
            >
              <BrandLockup compact />
            </View>

            <EmailAuthForm
              baseUrl={baseUrl}
              email={email}
              error={error}
              message={message}
              mode={mode}
              name={name}
              onBack={onBackToLanding}
              onEmailChange={onEmailChange}
              onModeChange={onModeChange}
              onNameChange={onNameChange}
              onPasswordChange={onPasswordChange}
              onProviderUrlChange={onProviderUrlChange}
              onSubmit={onSubmit}
              password={password}
              submitting={submitting}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  )
}

function BrandLockup({ compact }: { compact?: boolean }) {
  return (
    <View style={{ alignItems: "center", gap: compact ? 12 : 18 }}>
      <Image
        accessibilityIgnoresInvertColors
        source={require("../assets/icon.png")}
        style={{
          borderRadius: compact ? 20 : 28,
          height: compact ? 68 : 96,
          width: compact ? 68 : 96,
        }}
      />
      <Text
        style={{
          color: authColors.text,
          fontSize: compact ? 34 : 48,
          fontWeight: theme.typography.weight.heavy,
          letterSpacing: theme.typography.letterSpacing.none,
        }}
      >
        Anybox
      </Text>
    </View>
  )
}

function EmailAuthForm({
  baseUrl,
  email,
  error,
  message,
  mode,
  name,
  onBack,
  onEmailChange,
  onModeChange,
  onNameChange,
  onPasswordChange,
  onProviderUrlChange,
  onSubmit,
  password,
  submitting,
}: {
  baseUrl: string
  email: string
  error: string | null
  message: string | null
  mode: AccountMode
  name: string
  onBack: () => void
  onEmailChange: (value: string) => void
  onModeChange: (mode: AccountMode) => void
  onNameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onProviderUrlChange: (value: string) => void
  onSubmit: () => void
  password: string
  submitting: boolean
}) {
  const { t } = useI18n()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const isRegister = mode === "register"
  const submitDisabled = !baseUrl.trim() || !email.trim() || !password || (isRegister && password.length < 8)

  return (
    <View
      style={{
        backgroundColor: authColors.panel,
        borderColor: authColors.border,
        borderRadius: 24,
        borderWidth: 1,
        gap: 16,
        padding: 18,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          onPress={onBack}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: authColors.panelStrong,
            borderColor: authColors.border,
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            height: 38,
            justifyContent: "center",
            opacity: pressed ? theme.opacity.pressed : 1,
            width: 38,
          })}
        >
          <Feather color={authColors.textMuted} name="chevron-left" size={22} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: authColors.text,
              fontSize: 22,
              fontWeight: theme.typography.weight.heavy,
            }}
          >
            {isRegister ? t("account.createAccount") : t("account.emailSignIn")}
          </Text>
        </View>
      </View>

      {message ? <AuthNotice message={message} tone="success" /> : null}
      {error ? <AuthNotice message={error} tone="danger" /> : null}

      {isRegister ? (
        <AuthField
          icon="user"
          keyboardType="default"
          label={t("account.name")}
          onChangeText={onNameChange}
          placeholder={t("account.namePlaceholder")}
          value={name}
        />
      ) : null}
      <AuthField
        icon="mail"
        keyboardType="email-address"
        label={t("account.email")}
        onChangeText={onEmailChange}
        placeholder="you@example.com"
        value={email}
      />
      <AuthField
        icon="lock"
        label={t("account.password")}
        onChangeText={onPasswordChange}
        placeholder={isRegister ? t("account.passwordRegisterPlaceholder") : t("account.passwordPlaceholder")}
        secureTextEntry
        value={password}
      />

      <View
        style={{
          borderColor: authColors.border,
          borderTopWidth: 1,
          paddingTop: 4,
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setAdvancedOpen((current) => !current)}
          style={({ pressed }) => ({
            alignItems: "center",
            flexDirection: "row",
            gap: 10,
            opacity: pressed ? theme.opacity.pressed : 1,
            paddingVertical: 10,
          })}
        >
          <Feather color={authColors.textSubtle} name="settings" size={17} />
          <Text
            style={{
              color: authColors.textMuted,
              flex: 1,
              fontSize: theme.typography.size.sm,
              fontWeight: theme.typography.weight.bold,
            }}
          >
            {t("account.advanced")}
          </Text>
          <Feather color={authColors.textSubtle} name={advancedOpen ? "chevron-up" : "chevron-down"} size={18} />
        </Pressable>
        {advancedOpen ? (
          <AuthField
            icon="globe"
            keyboardType="url"
            label={t("account.providerUrl")}
            onChangeText={onProviderUrlChange}
            placeholder="https://anybox.com.cn"
            value={baseUrl}
          />
        ) : null}
      </View>

      <AuthActionButton
        disabled={submitDisabled}
        icon={isRegister ? "user-plus" : "mail"}
        label={isRegister ? t("account.createAccount") : t("account.signIn")}
        loading={submitting}
        onPress={onSubmit}
      />
      <AuthActionButton
        label={isRegister ? t("account.haveAccount") : t("account.needAccount")}
        onPress={() => onModeChange(isRegister ? "login" : "register")}
        variant="ghost"
      />
      <AgreementFooter />
    </View>
  )
}

function AuthField({
  icon,
  keyboardType,
  label,
  onChangeText,
  placeholder,
  secureTextEntry,
  value,
}: {
  icon: FeatherName
  keyboardType?: KeyboardTypeOptions
  label: string
  onChangeText: (value: string) => void
  placeholder: string
  secureTextEntry?: boolean
  value: string
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: authColors.textMuted,
          fontSize: theme.typography.size.sm,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {label}
      </Text>
      <View
        style={{
          alignItems: "center",
          backgroundColor: authColors.panelStrong,
          borderColor: authColors.border,
          borderRadius: 18,
          borderWidth: 1,
          flexDirection: "row",
          gap: 12,
          minHeight: 54,
          paddingHorizontal: 15,
        }}
      >
        <Feather color={authColors.textSubtle} name={icon} size={19} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={keyboardType ?? (secureTextEntry ? "default" : "email-address")}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={authColors.textSubtle}
          secureTextEntry={secureTextEntry}
          style={{
            color: authColors.text,
            flex: 1,
            fontSize: theme.typography.size.lg,
            minHeight: 54,
            paddingVertical: 0,
          }}
          value={value}
        />
      </View>
    </View>
  )
}

function AuthActionButton({
  disabled,
  icon,
  label,
  loading,
  onPress,
  variant = "primary",
}: {
  disabled?: boolean
  icon?: FeatherName
  label: string
  loading?: boolean
  onPress: () => void
  variant?: "primary" | "secondary" | "ghost"
}) {
  const isDisabled = disabled || loading
  const isPrimary = variant === "primary"
  const isGhost = variant === "ghost"
  const foreground = isPrimary ? authColors.primaryText : authColors.text

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: isPrimary ? authColors.primary : isGhost ? "transparent" : authColors.panelStrong,
        borderColor: isPrimary ? "transparent" : authColors.borderStrong,
        borderRadius: theme.radius.pill,
        borderWidth: isPrimary || isGhost ? 0 : 1,
        flexDirection: "row",
        gap: 10,
        justifyContent: "center",
        minHeight: isGhost ? 42 : 60,
        opacity: isDisabled ? theme.opacity.disabled : pressed ? theme.opacity.pressedStrong : 1,
        paddingHorizontal: 18,
        paddingVertical: isGhost ? 8 : 15,
      })}
    >
      {loading ? <ActivityIndicator color={foreground} /> : icon ? <Feather color={foreground} name={icon} size={21} /> : null}
      <Text
        style={{
          color: foreground,
          fontSize: isGhost ? theme.typography.size.md : 20,
          fontWeight: theme.typography.weight.heavy,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function AuthNotice({ message, tone }: { message: string; tone: "success" | "danger" }) {
  const colors =
    tone === "success"
      ? {
          background: authColors.successBackground,
          border: authColors.successBorder,
          text: authColors.successText,
        }
      : {
          background: authColors.dangerBackground,
          border: authColors.dangerBorder,
          text: authColors.dangerText,
        }

  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderRadius: 16,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
      }}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: theme.typography.size.sm,
          fontWeight: theme.typography.weight.bold,
          lineHeight: theme.typography.lineHeight.sm,
        }}
      >
        {message}
      </Text>
    </View>
  )
}

function AgreementFooter() {
  const { t } = useI18n()

  function showLegalInfo(title: string, message: string) {
    Alert.alert(title, message)
  }

  return (
    <Text
      style={{
        color: authColors.textSubtle,
        fontSize: theme.typography.size.sm,
        lineHeight: 19,
        paddingHorizontal: 8,
        textAlign: "center",
      }}
    >
      {t("account.agreementPrefix")}
      <Text
        onPress={() => showLegalInfo(t("account.userAgreement"), t("account.legalUnavailable"))}
        style={{ color: authColors.textMuted, fontWeight: theme.typography.weight.bold }}
      >
        {t("account.userAgreement")}
      </Text>
      {t("account.agreementJoiner")}
      <Text
        onPress={() => showLegalInfo(t("account.privacyPolicy"), t("account.legalUnavailable"))}
        style={{ color: authColors.textMuted, fontWeight: theme.typography.weight.bold }}
      >
        {t("account.privacyPolicy")}
      </Text>
    </Text>
  )
}

function ProfileSummary({
  avatarUrl,
  displayName,
  email,
  username,
}: {
  avatarUrl: string
  displayName: string
  email: string
  username: string
}) {
  const name = displayName || username || email

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        flexDirection: "row",
        gap: theme.spacing.xl,
        padding: theme.spacing.xxl,
      }}
    >
      <Avatar label={name} uri={avatarUrl} />
      <View style={{ flex: 1, gap: theme.spacing.sm, minWidth: 0 }}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: theme.spacing.md }}>
          <Text
            numberOfLines={1}
            selectable
            style={{
              color: theme.colors.text,
              flex: 1,
              fontSize: theme.typography.size.lg,
              fontWeight: theme.typography.weight.heavy,
            }}
          >
            {name}
          </Text>
          <Badge label="Signed in" tone="success" />
        </View>
        {username ? (
          <Text
            numberOfLines={1}
            selectable
            style={{
              color: theme.colors.textSubtle,
              fontSize: theme.typography.size.sm,
              fontWeight: theme.typography.weight.medium,
            }}
          >
            @{username}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          selectable
          style={{
            color: theme.colors.textMuted,
            fontSize: theme.typography.size.sm,
          }}
        >
          {email}
        </Text>
      </View>
    </View>
  )
}

function Avatar({ label, uri }: { label: string; uri: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: theme.colors.surfaceSubtle,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        height: 54,
        justifyContent: "center",
        overflow: "hidden",
        width: 54,
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ height: "100%", width: "100%" }} />
      ) : (
        <Text
          style={{
            color: theme.colors.textSubtle,
            fontSize: theme.typography.size.lg,
            fontWeight: theme.typography.weight.heavy,
          }}
        >
          {initialsFor(label)}
        </Text>
      )}
    </View>
  )
}

function InfoCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        paddingHorizontal: theme.spacing.xxl,
        paddingVertical: theme.spacing.md,
      }}
    >
      {children}
    </View>
  )
}

function InfoRow({
  badgeTone,
  divided,
  title,
  value,
}: {
  badgeTone?: ThemeTone
  divided?: boolean
  title: string
  value: string
}) {
  return (
    <View
      style={{
        alignItems: "center",
        borderColor: theme.colors.border,
        borderTopWidth: divided ? 1 : 0,
        flexDirection: "row",
        gap: theme.spacing.xl,
        justifyContent: "space-between",
        minHeight: 46,
        paddingVertical: theme.spacing.lg,
      }}
    >
      <Text
        style={{
          color: theme.colors.textSubtle,
          flex: 1,
          fontSize: theme.typography.size.sm,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {title}
      </Text>
      {badgeTone ? (
        <Badge label={value} tone={badgeTone} />
      ) : (
        <Text
          numberOfLines={1}
          selectable
          style={{
            color: theme.colors.text,
            flexShrink: 1,
            fontSize: theme.typography.size.md,
            fontWeight: theme.typography.weight.medium,
            textAlign: "right",
          }}
        >
          {value}
        </Text>
      )}
    </View>
  )
}

function Badge({ label, tone }: { label: string; tone: ThemeTone }) {
  const toneColors = theme.colors.status[tone]
  return (
    <View
      style={{
        backgroundColor: tone === "neutral" ? theme.colors.surfaceSubtle : toneColors.background,
        borderColor: toneColors.border,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        paddingHorizontal: theme.spacing.md,
        paddingVertical: theme.spacing.xs,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          color: toneColors.text,
          fontSize: theme.typography.size.xs,
          fontWeight: theme.typography.weight.bold,
        }}
      >
        {label}
      </Text>
    </View>
  )
}

function flagTone(value: boolean | undefined): ThemeTone {
  if (value === true) return "success"
  if (value === false) return "danger"
  return "neutral"
}

function subscriptionTone(status: string | undefined): ThemeTone {
  const normalized = status?.trim().toLocaleLowerCase().replace(/[\s-]+/g, "_")
  if (normalized === "active" || normalized === "trialing") return "success"
  if (normalized === "past_due" || normalized === "canceled" || normalized === "unpaid") return "danger"
  return "neutral"
}

function initialsFor(value: string) {
  const chunks = value
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
  if (chunks.length === 0) return "?"
  return chunks
    .slice(0, 2)
    .map((chunk) => chunk.slice(0, 1).toLocaleUpperCase())
    .join("")
}
