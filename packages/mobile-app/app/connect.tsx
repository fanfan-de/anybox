import { useLocalSearchParams, useRouter } from "expo-router"
import React, { useEffect, useMemo, useState } from "react"
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
import { theme } from "@/theme"
import { getMobileDeviceName } from "@/utils/platform"

const CONNECTION_PREVIEW_TIMEOUT_MS = 4_500

interface PreviewedConnectionOption {
  option: NormalizedConnectionOption
  preview: MobilePairPreview | null
  error?: string
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function formatPairingExpiry(preview: MobilePairPreview | null) {
  if (!preview?.pairing.expiresAt) return null
  const remaining = Math.max(0, preview.pairing.expiresAt - preview.pairing.serverTime)
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return remaining > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : "expired"
}

function formatPreviewDetail(option: NormalizedConnectionOption, preview: MobilePairPreview | null) {
  const connection = option.connection
  if (!preview) {
    const access = connection.transport === "relay" ? "Cloud relay access" : option.kind === "lan" ? "Local network access" : "Legacy token access"
    return `${access}\n${connection.baseUrl}`
  }

  const desktop = preview.desktopName?.trim() || "Anybox desktop"
  const version = preview.appVersion ? ` ${preview.appVersion}` : ""
  const capabilityCount = preview.capabilities?.length ?? 0
  const expires = formatPairingExpiry(preview)
  return [
    `${desktop}${version}`,
    connection.transport === "relay"
      ? `Cloud relay: ${connection.baseUrl}`
      : option.kind === "lan"
        ? `Local network: ${connection.baseUrl}`
        : connection.baseUrl,
    capabilityCount === 1 ? "1 capability" : `${capabilityCount} capabilities`,
    expires ? `QR expires in ${expires}` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

function pairingButtonLabel(option: NormalizedConnectionOption) {
  if (option.kind === "relay") return "Use cloud relay"
  if (option.kind === "lan") return "Use local network"
  return "Confirm connection"
}

function describePreviewError(error: unknown) {
  return error instanceof Error ? error.message : "Unable to preview this connection method."
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
        error: "This pairing QR code is expired or already used.",
      }
    }
    return { option, preview }
  } catch (error) {
    return {
      option,
      preview: null,
      error: describePreviewError(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function ConnectionOptionCard({
  item,
  onPair,
  pairing,
}: {
  item: PreviewedConnectionOption
  onPair: (item: PreviewedConnectionOption) => void
  pairing: boolean
}) {
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
        <Text
          selectable
          style={{
            color: theme.colors.text,
            fontSize: theme.typography.size.lg,
            fontWeight: theme.typography.weight.heavy,
          }}
        >
          {item.option.label}
        </Text>
        <Text
          selectable
          style={{
            color: theme.colors.textMuted,
            fontSize: theme.typography.size.sm,
            lineHeight: theme.typography.lineHeight.sm,
          }}
        >
          {formatPreviewDetail(item.option, item.preview)}
        </Text>
      </View>
      <Button
        label={pairingButtonLabel(item.option)}
        loading={pairing}
        onPress={() => onPair(item)}
      />
    </View>
  )
}

export default function ConnectScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ token?: string; url?: string }>()
  const { account } = useAccount()
  const { connection, loading, saveConnection } = useConnection()
  const [options, setOptions] = useState<PreviewedConnectionOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(true)
  const [pairingOptionID, setPairingOptionID] = useState<string | null>(null)

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
    if (loading) return undefined
    let cancelled = false

    async function loadPreview() {
      setLoadingPreview(true)
      setError(null)
      setOptions([])
      try {
        if (!bridgeUrl) throw new Error("Connection URL is missing.")
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

        const available = previewed.filter((item) => !item.error)
        setOptions(available)
        if (!available.length) {
          const detail = previewed
            .map((item) => `${item.option.label}: ${item.error ?? "Unavailable"}`)
            .join("\n")
          setError(detail || "No available connection method was found.")
          return
        }
      } catch (previewError) {
        if (!cancelled) {
          setOptions([])
          setError(previewError instanceof Error ? previewError.message : "Unable to read this pairing link.")
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
    setError(null)
    try {
      const previousConnection = connection
      const result = await pairDevice(candidate, getMobileDeviceName(), { accountToken: account?.token })
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
      setError(connectError instanceof Error ? connectError.message : "Unable to pair this mobile device.")
    } finally {
      setPairingOptionID(null)
    }
  }

  if (loading || loadingPreview) {
    return (
      <Screen>
        <StateCard title="Reviewing connection" detail={bridgeUrl} />
      </Screen>
    )
  }

  const title = error && !options.length
    ? "Connection failed"
    : isConnectionOptionsLink
      ? "Choose connection method"
      : options[0]?.preview
        ? "Confirm desktop connection"
        : "Confirm legacy connection"

  return (
    <Screen>
      {error && !options.length ? (
        <StateCard
          title={title}
          detail={error}
          tone="danger"
        />
      ) : (
        <Section title={title} caption={options.length === 1 ? "1 available" : `${options.length} available`}>
          {options.map((item) => (
            <ConnectionOptionCard
              item={item}
              key={item.option.id}
              onPair={(selected) => void runPairing(selected)}
              pairing={pairingOptionID === item.option.id}
            />
          ))}
        </Section>
      )}
      {error && options.length ? (
        <StateCard
          title="Connection failed"
          detail={error}
          tone="danger"
        />
      ) : null}
      {connection && options.length ? (
        <StateCard
          title="Replacing current desktop"
          detail={`Current: ${connection.baseUrl}`}
          tone="neutral"
        />
      ) : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" onPress={cancelConnection} variant="secondary" />
        </View>
      </View>
    </Screen>
  )
}
