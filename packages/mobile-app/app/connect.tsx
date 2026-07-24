import { useLocalSearchParams, useRouter } from "expo-router"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { Text, View } from "react-native"
import { Button } from "@/components/button"
import { Screen } from "@/components/screen"
import { Section } from "@/components/section"
import { StateCard } from "@/components/state-card"
import {
  normalizeConnectionOptionsInput,
  pairDevice,
  previewPairing,
  readConnectionOptionsFromDeepLink,
  revokeCurrentDevice,
  type MobilePairPreview,
  type NormalizedConnectionOption,
} from "@/api/mobile-api"
import { useAccount } from "@/state/account"
import { useConnection } from "@/state/connection"
import { useI18n } from "@/i18n"
import { theme } from "@/theme"
import { getMobileDeviceName } from "@/utils/platform"

const CONNECTION_PREVIEW_TIMEOUT_MS = 4_500

interface PreviewedConnectionOption {
  option: NormalizedConnectionOption
  preview: MobilePairPreview | null
  unavailable?: boolean
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

async function previewConnectionOption(option: NormalizedConnectionOption): Promise<PreviewedConnectionOption> {
  if (!option.connection.pairingCode) {
    return { option, preview: null }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CONNECTION_PREVIEW_TIMEOUT_MS)
  try {
    const preview = await previewPairing(option.connection, { signal: controller.signal })
    if (!preview.pairing.valid) {
      return {
        option,
        preview,
        unavailable: true,
      }
    }
    return { option, preview }
  } catch (error) {
    console.warn(`[connect] Unable to preview ${option.kind} connection`, error)
    return {
      option,
      preview: null,
      unavailable: true,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function ConnectionOptionCard({
  item,
  onPair,
  pairing,
  primary,
  showRecommended,
}: {
  item: PreviewedConnectionOption
  onPair: (item: PreviewedConnectionOption) => void
  pairing: boolean
  primary: boolean
  showRecommended: boolean
}) {
  const { t } = useI18n()
  const presentation = item.option.kind === "relay"
    ? { title: t("connect.cloud"), detail: t("connect.cloudHint") }
    : item.option.kind === "lan"
      ? { title: t("connect.local"), detail: t("connect.localHint") }
      : { title: t("connect.direct"), detail: t("connect.directHint") }

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        gap: theme.spacing.xl,
        padding: theme.spacing.xxl,
      }}
    >
      <View style={{ gap: theme.spacing.sm }}>
        <View
          style={{
            alignItems: "baseline",
            flexDirection: "row",
            gap: theme.spacing.lg,
            justifyContent: "space-between",
          }}
        >
          <Text
            style={{
              color: theme.colors.text,
              flexShrink: 1,
              fontSize: theme.typography.size.lg,
              fontWeight: theme.typography.weight.heavy,
            }}
          >
            {presentation.title}
          </Text>
          {showRecommended ? (
            <Text
              style={{
                color: theme.colors.status.success.text,
                fontSize: theme.typography.size.sm,
                fontWeight: theme.typography.weight.bold,
              }}
            >
              {t("connect.recommended")}
            </Text>
          ) : null}
        </View>
        <Text
          style={{
            color: item.unavailable ? theme.colors.status.danger.text : theme.colors.textMuted,
            fontSize: theme.typography.size.sm,
            lineHeight: theme.typography.lineHeight.sm,
          }}
        >
          {item.unavailable ? t("connect.unavailableHint") : presentation.detail}
        </Text>
      </View>
      <Button
        accessibilityLabel={`${t("connect.action")}: ${presentation.title}`}
        disabled={item.unavailable}
        label={item.unavailable ? t("connect.unavailable") : t("connect.action")}
        loading={pairing}
        onPress={() => onPair(item)}
        variant={primary ? "primary" : "secondary"}
      />
    </View>
  )
}

export default function ConnectScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ token?: string; url?: string }>()
  const { account } = useAccount()
  const { connection, loading, saveConnection } = useConnection()
  const { t } = useI18n()
  const [options, setOptions] = useState<PreviewedConnectionOption[]>([])
  const [hasError, setHasError] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [pairingOptionID, setPairingOptionID] = useState<string | null>(null)
  const pairingCommittedRef = useRef(false)

  function cancelConnection() {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace("/")
    }
  }

  const bridgeUrl = useMemo(() => firstParam(params.url)?.trim() ?? "", [params.url])
  const bridgeToken = useMemo(() => firstParam(params.token)?.trim() ?? "", [params.token])
  const isConnectionOptionsLink = useMemo(() => Boolean(readConnectionOptionsFromDeepLink(bridgeUrl)), [bridgeUrl])

  useEffect(() => {
    if (loading || pairingCommittedRef.current) return undefined
    let cancelled = false

    async function loadPreview() {
      setLoadingPreview(true)
      setHasError(false)
      setOptions([])
      try {
        if (!bridgeUrl) throw new Error("Connection URL is missing")
        const nextOptions = normalizeConnectionOptionsInput(bridgeUrl, bridgeToken)
        if (
          connection &&
          nextOptions.length === 1 &&
          !nextOptions[0]?.connection.pairingCode &&
          nextOptions[0]?.connection.baseUrl === connection.baseUrl &&
          nextOptions[0]?.connection.token === connection.token
        ) {
          router.replace("/")
          return
        }

        const previewed = await Promise.all(nextOptions.map((option) => previewConnectionOption(option)))
        if (cancelled) return

        const available = previewed.filter((item) => !item.unavailable)
        setOptions(previewed)
        if (!available.length) {
          setHasError(true)
          return
        }
      } catch (previewError) {
        if (!cancelled) {
          console.warn("[connect] Unable to read pairing link", previewError)
          setOptions([])
          setHasError(true)
        }
      } finally {
        if (!cancelled) setLoadingPreview(false)
      }
    }

    void loadPreview()
    return () => {
      cancelled = true
    }
  }, [bridgeToken, bridgeUrl, connection, loading, router])

  async function runPairing(item: PreviewedConnectionOption) {
    const candidate = item.option.connection
    setPairingOptionID(item.option.id)
    setHasError(false)
    try {
      const previousConnection = connection
      const result = await pairDevice(candidate, getMobileDeviceName(), { accountToken: account?.token })
      pairingCommittedRef.current = true
      const saveEndpoint = candidate.transport === "relay" ? item.option.endpoint : candidate.baseUrl
      await saveConnection(saveEndpoint, result.token, result.device.id, {
        transport: candidate.transport,
        desktopID: result.desktopID,
      })
      if (previousConnection?.deviceID) {
        await revokeCurrentDevice(previousConnection).catch(() => undefined)
      }
      router.replace("/")
    } catch (connectError) {
      console.warn(`[connect] Unable to pair using ${item.option.kind} connection`, connectError)
      setHasError(true)
    } finally {
      setPairingOptionID(null)
    }
  }

  if (loading || loadingPreview) {
    return (
      <Screen>
        <StateCard title={t("connect.reviewing")} />
      </Screen>
    )
  }

  const availableOptions = options.filter((item) => !item.unavailable)
  const desktopName = options
    .map((item) => item.preview?.desktopName?.trim())
    .find((name): name is string => Boolean(name))
  const title = desktopName
    ? t("connect.connectTo", { name: desktopName })
    : isConnectionOptionsLink
      ? t("connect.chooseMethod")
      : t("connect.confirmTitle")

  return (
    <Screen>
      {hasError && !availableOptions.length ? (
        <StateCard
          title={t("connect.failed")}
          detail={t("connect.failedHint")}
          tone="danger"
        />
      ) : (
        <Section title={title}>
          {options.map((item) => (
            <ConnectionOptionCard
              item={item}
              key={item.option.id}
              onPair={(selected) => void runPairing(selected)}
              pairing={pairingOptionID === item.option.id}
              primary={availableOptions[0]?.option.id === item.option.id}
              showRecommended={
                availableOptions.length > 1 &&
                item.option.kind === "relay" &&
                !item.unavailable
              }
            />
          ))}
        </Section>
      )}
      {hasError && availableOptions.length ? (
        <StateCard
          title={t("connect.failed")}
          detail={t("connect.failedHint")}
          tone="danger"
        />
      ) : null}
      {connection && availableOptions.length ? (
        <StateCard
          title={t("connect.switchTitle")}
          detail={t("connect.switchHint")}
          tone="neutral"
        />
      ) : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={t("app.cancel")} onPress={cancelConnection} variant="secondary" />
        </View>
      </View>
    </Screen>
  )
}
