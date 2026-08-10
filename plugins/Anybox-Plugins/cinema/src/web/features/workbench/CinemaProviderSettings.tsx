import { useEffect, useMemo, useState } from "react"
import { Bot, Cloud, KeyRound, Loader2, Server } from "lucide-react"
import { useI18n, type TranslationKey } from "../../i18n"
import { resolveCinemaRuntimeBaseURL } from "../../runtimeUrl"
import {
  createCinemaProviderSettingsApi,
  type CinemaCredentialPersistence,
  type CinemaProviderCredential,
  type CinemaProviderID,
  type CinemaProviderModelSettings,
  type CinemaProviderSettings,
  type CinemaProviderSettingsInput,
} from "./cinemaProviderSettingsApi"

type ProviderDefinition = {
  id: CinemaProviderID
  nameKey: TranslationKey
  descriptionKey: TranslationKey
  endpoint: string
  requiresCredential: boolean
  credentialLabelKey?: TranslationKey
  credentialPlaceholderKey?: TranslationKey
  icon: typeof Server
}

const PROVIDERS: ReadonlyArray<ProviderDefinition> = [
  {
    id: "comfyui-local",
    nameKey: "settings.provider.comfyui.name",
    descriptionKey: "settings.provider.comfyui.description",
    endpoint: "http://127.0.0.1:8188",
    requiresCredential: false,
    icon: Server,
  },
  {
    id: "google-ai-sdk",
    nameKey: "settings.provider.google.name",
    descriptionKey: "settings.provider.google.description",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    requiresCredential: true,
    credentialLabelKey: "settings.provider.apiKey",
    credentialPlaceholderKey: "settings.provider.google.apiKeyPlaceholder",
    icon: Cloud,
  },
  {
    id: "klingai-cn",
    nameKey: "settings.provider.kling.name",
    descriptionKey: "settings.provider.kling.description",
    endpoint: "https://api-beijing.klingai.com",
    requiresCredential: true,
    credentialLabelKey: "settings.provider.credential",
    credentialPlaceholderKey: "settings.provider.kling.credentialPlaceholder",
    icon: KeyRound,
  },
  {
    id: "openai-compatible",
    nameKey: "settings.provider.openai.name",
    descriptionKey: "settings.provider.openai.description",
    endpoint: "https://api.openai.com/v1",
    requiresCredential: true,
    credentialLabelKey: "settings.provider.apiKey",
    credentialPlaceholderKey: "settings.provider.openai.apiKeyPlaceholder",
    icon: Bot,
  },
]

type ProviderFormState = {
  baseURL: string
  userID: string
  defaultModel: string
  models: string
  textGenerationPrompt: string
}

type Feedback = {
  kind: "success" | "error" | "info"
  message: string
}

type PendingAction = "loading" | "saving" | "testing" | "discovering" | "removing" | null

const EMPTY_CREDENTIAL: CinemaProviderCredential = { configured: false, persistence: "none" }

function providerDefinition(providerID: CinemaProviderID) {
  return PROVIDERS.find((provider) => provider.id === providerID) ?? PROVIDERS[0]
}

function formFromSettings(providerID: CinemaProviderID, settings: CinemaProviderSettings): ProviderFormState {
  const definition = providerDefinition(providerID)
  return {
    baseURL: settings.baseURL ?? definition.endpoint,
    userID: settings.userID ?? "",
    defaultModel: settings.defaultModel ?? "",
    models: settings.models.map((model) => model.id).join("\n"),
    textGenerationPrompt: settings.textGenerationPrompt ?? "",
  }
}

function parseModelIDs(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]
}

function openAIModels(form: ProviderFormState, current: CinemaProviderSettings): CinemaProviderModelSettings[] {
  const ids = parseModelIDs(form.models)
  const defaultModel = form.defaultModel.trim()
  if (defaultModel && !ids.includes(defaultModel)) ids.unshift(defaultModel)
  const existing = new Map(current.models.map((model) => [model.id, model]))
  return ids.map((id) => existing.get(id) ?? { id })
}

function statusText(
  definition: ProviderDefinition,
  credential: CinemaProviderCredential,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (!definition.requiresCredential) return t("settings.provider.status.noCredential")
  if (!credential.configured) return t("settings.provider.status.notConnected")
  return credential.persistence === "session"
    ? t("settings.provider.status.connectedSession")
    : t("settings.provider.status.connectedKeychain")
}

export function CinemaProviderSettings({
  initialProviderID = "comfyui-local",
}: {
  initialProviderID?: CinemaProviderID
}) {
  const { t } = useI18n()
  const api = useMemo(() => createCinemaProviderSettingsApi(resolveCinemaRuntimeBaseURL({
    location: window.location,
  })), [])
  const [activeProviderID, setActiveProviderID] = useState<CinemaProviderID>(initialProviderID)
  const [settings, setSettings] = useState<CinemaProviderSettings>({ models: [] })
  const [credential, setCredential] = useState<CinemaProviderCredential>(EMPTY_CREDENTIAL)
  const [credentialInput, setCredentialInput] = useState("")
  const [credentialPersistence, setCredentialPersistence] = useState<Exclude<CinemaCredentialPersistence, "none">>("system-keychain")
  const [form, setForm] = useState<ProviderFormState>(() => formFromSettings(initialProviderID, { models: [] }))
  const [pendingAction, setPendingAction] = useState<PendingAction>("loading")
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const activeProvider = providerDefinition(activeProviderID)
  const pending = pendingAction !== null

  useEffect(() => {
    setActiveProviderID(initialProviderID)
  }, [initialProviderID])

  useEffect(() => {
    const controller = new AbortController()
    setPendingAction("loading")
    setFeedback(null)
    setCredentialInput("")

    void Promise.all([
      api.getSettings(activeProviderID, controller.signal),
      activeProvider.requiresCredential
        ? api.getCredential(activeProviderID, controller.signal)
        : Promise.resolve(EMPTY_CREDENTIAL),
    ]).then(([nextSettings, nextCredential]) => {
      setSettings(nextSettings)
      setForm(formFromSettings(activeProviderID, nextSettings))
      setCredential(nextCredential)
      setCredentialPersistence(nextCredential.persistence === "session" ? "session" : "system-keychain")
      setPendingAction(null)
    }).catch((error) => {
      if (controller.signal.aborted) return
      setPendingAction(null)
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : t("settings.provider.loadFailed"),
      })
    })

    return () => controller.abort()
  }, [activeProvider.requiresCredential, activeProviderID, api, t])

  function updateForm<Key extends keyof ProviderFormState>(key: Key, value: ProviderFormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }))
    setFeedback(null)
  }

  function settingsInput(): CinemaProviderSettingsInput | null {
    if (activeProviderID === "comfyui-local") {
      return {
        baseURL: form.baseURL.trim() || null,
        userID: form.userID.trim() || null,
      }
    }
    if (activeProviderID === "openai-compatible") {
      return {
        baseURL: form.baseURL.trim() || null,
        defaultModel: form.defaultModel.trim() || null,
        models: openAIModels(form, settings),
        textGenerationPrompt: form.textGenerationPrompt.trim() || null,
      }
    }
    return null
  }

  async function refreshCurrentProvider() {
    const [nextSettings, nextCredential] = await Promise.all([
      api.getSettings(activeProviderID),
      activeProvider.requiresCredential
        ? api.getCredential(activeProviderID)
        : Promise.resolve(EMPTY_CREDENTIAL),
    ])
    setSettings(nextSettings)
    setForm(formFromSettings(activeProviderID, nextSettings))
    setCredential(nextCredential)
    setCredentialPersistence(nextCredential.persistence === "session" ? "session" : "system-keychain")
    setCredentialInput("")
    return { settings: nextSettings, credential: nextCredential }
  }

  async function persistCurrentProvider() {
    const input = settingsInput()
    if (input?.baseURL === null) throw new Error(t("settings.provider.baseURLRequired"))
    const newCredential = credentialInput.trim()
    if (activeProvider.requiresCredential && !credential.configured && !newCredential) {
      throw new Error(t("settings.provider.credentialRequired"))
    }
    await Promise.all([
      input ? api.saveSettings(activeProviderID, input) : Promise.resolve(),
      activeProvider.requiresCredential && newCredential
        ? api.saveCredential(activeProviderID, newCredential, credentialPersistence)
        : Promise.resolve(credential),
    ])
    return await refreshCurrentProvider()
  }

  async function saveProvider() {
    setPendingAction("saving")
    setFeedback(null)
    try {
      await persistCurrentProvider()
      setFeedback({ kind: "success", message: t("settings.provider.saved") })
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : t("settings.provider.saveFailed"),
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function testProvider() {
    setPendingAction("testing")
    setFeedback(null)
    try {
      await persistCurrentProvider()
      const result = await api.testConnection(activeProviderID)
      setFeedback({
        kind: result.ok ? "success" : result.status === "unsupported" ? "info" : "error",
        message: result.message || t(result.ok
          ? "settings.provider.testSucceeded"
          : "settings.provider.testFailed"),
      })
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : t("settings.provider.testFailed"),
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function discoverModels() {
    setPendingAction("discovering")
    setFeedback(null)
    try {
      const persisted = await persistCurrentProvider()
      const models = await api.discoverOpenAIModels()
      if (models.length === 0) throw new Error(t("settings.provider.noModelsDiscovered"))
      const defaultModel = form.defaultModel.trim() || models[0]!.id
      await api.saveSettings("openai-compatible", {
        baseURL: persisted.settings.baseURL ?? activeProvider.endpoint,
        defaultModel,
        models,
        textGenerationPrompt: persisted.settings.textGenerationPrompt ?? null,
      })
      await refreshCurrentProvider()
      setFeedback({
        kind: "success",
        message: t("settings.provider.modelsDiscovered", { count: models.length }),
      })
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : t("settings.provider.discoveryFailed"),
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function removeCredential() {
    if (!window.confirm(t("settings.provider.removeKeyConfirm", { provider: t(activeProvider.nameKey) }))) return
    setPendingAction("removing")
    setFeedback(null)
    try {
      await api.removeCredential(activeProviderID)
      await refreshCurrentProvider()
      setFeedback({ kind: "success", message: t("settings.provider.keyRemoved") })
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : t("settings.provider.removeKeyFailed"),
      })
    } finally {
      setPendingAction(null)
    }
  }

  const status = statusText(activeProvider, credential, t)

  return (
    <div className="cinema-provider-settings">
      <nav className="cinema-provider-list" aria-label={t("settings.provider.navigation")}>
        {PROVIDERS.map((provider) => {
          const Icon = provider.icon
          const active = provider.id === activeProviderID
          return (
            <button
              key={provider.id}
              type="button"
              className={`cinema-provider-list-item ${active ? "is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              disabled={pending}
              onClick={() => setActiveProviderID(provider.id)}
            >
              <Icon size={16} aria-hidden="true" />
              <span>
                <strong>{t(provider.nameKey)}</strong>
                <small>{t(provider.descriptionKey)}</small>
              </span>
            </button>
          )
        })}
      </nav>

      <section className="cinema-provider-detail" aria-labelledby={`cinema-provider-${activeProviderID}-title`}>
        <header className="cinema-provider-detail-header">
          <div>
            <h3 id={`cinema-provider-${activeProviderID}-title`}>{t(activeProvider.nameKey)}</h3>
            <p>{t(activeProvider.descriptionKey)}</p>
          </div>
          <span className={`cinema-provider-status ${!activeProvider.requiresCredential || credential.configured ? "is-connected" : ""}`}>
            <i aria-hidden="true" />
            {status}
          </span>
        </header>

        {pendingAction === "loading" ? (
          <div className="cinema-provider-loading" role="status">
            <Loader2 className="is-spinning" size={16} aria-hidden="true" />
            <span>{t("settings.provider.loading")}</span>
          </div>
        ) : (
          <form
            className="cinema-provider-form"
            onSubmit={(event) => {
              event.preventDefault()
              void saveProvider()
            }}
          >
            <fieldset disabled={pending}>
              {activeProviderID === "comfyui-local" || activeProviderID === "openai-compatible" ? (
                <div className="cinema-provider-field">
                  <label htmlFor="cinema-provider-base-url">{t("settings.provider.baseURL")}</label>
                  <input
                    id="cinema-provider-base-url"
                    type="url"
                    value={form.baseURL}
                    required
                    aria-describedby="cinema-provider-base-url-hint"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={activeProvider.endpoint}
                    onChange={(event) => updateForm("baseURL", event.target.value)}
                  />
                  <small id="cinema-provider-base-url-hint">{t(activeProviderID === "comfyui-local"
                    ? "settings.provider.comfyui.baseURLHint"
                    : "settings.provider.openai.baseURLHint")}</small>
                </div>
              ) : (
                <div className="cinema-provider-readonly-row">
                  <span>{t("settings.provider.endpoint")}</span>
                  <code>{activeProvider.endpoint}</code>
                </div>
              )}

              {activeProviderID === "comfyui-local" ? (
                <div className="cinema-provider-field">
                  <label htmlFor="cinema-provider-user-id">{t("settings.provider.userID")}</label>
                  <input
                    id="cinema-provider-user-id"
                    type="text"
                    value={form.userID}
                    aria-describedby="cinema-provider-user-id-hint"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="default"
                    onChange={(event) => updateForm("userID", event.target.value)}
                  />
                  <small id="cinema-provider-user-id-hint">{t("settings.provider.comfyui.userIDHint")}</small>
                </div>
              ) : null}

              {activeProvider.requiresCredential ? (
                <>
                  <div className="cinema-provider-field">
                    <label htmlFor="cinema-provider-credential">
                      {t(activeProvider.credentialLabelKey ?? "settings.provider.apiKey")}
                    </label>
                    <input
                      id="cinema-provider-credential"
                      type="password"
                      value={credentialInput}
                      aria-describedby="cinema-provider-credential-hint"
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={credential.configured
                        ? t("settings.provider.apiKeyStored")
                        : t(activeProvider.credentialPlaceholderKey ?? "settings.provider.apiKeyPlaceholder")}
                      onChange={(event) => {
                        setCredentialInput(event.target.value)
                        setFeedback(null)
                      }}
                    />
                    <small id="cinema-provider-credential-hint">{credential.configured
                      ? t("settings.provider.apiKeyReplaceHint")
                      : t("settings.provider.apiKeyStorageHint")}</small>
                  </div>
                  <div className="cinema-provider-persistence">
                    <span>{t("settings.provider.persistence")}</span>
                    <div role="radiogroup" aria-label={t("settings.provider.persistence")}>
                      {(["system-keychain", "session"] as const).map((persistence) => (
                        <button
                          key={persistence}
                          type="button"
                          role="radio"
                          className={`cinema-provider-persistence-option ${credentialPersistence === persistence ? "is-active" : ""}`}
                          aria-checked={credentialPersistence === persistence}
                          onClick={() => setCredentialPersistence(persistence)}
                        >
                          {t(persistence === "system-keychain"
                            ? "settings.provider.persistence.keychain"
                            : "settings.provider.persistence.session")}
                        </button>
                      ))}
                    </div>
                    <small>{t(credentialPersistence === "system-keychain"
                      ? "settings.provider.persistence.keychainHint"
                      : "settings.provider.persistence.sessionHint")}</small>
                  </div>
                </>
              ) : null}

              {activeProviderID === "openai-compatible" ? (
                <>
                  <div className="cinema-provider-field">
                    <label htmlFor="cinema-provider-default-model">{t("settings.provider.defaultModel")}</label>
                    <input
                      id="cinema-provider-default-model"
                      type="text"
                      value={form.defaultModel}
                      aria-describedby="cinema-provider-default-model-hint"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="gpt-5"
                      onChange={(event) => updateForm("defaultModel", event.target.value)}
                    />
                    <small id="cinema-provider-default-model-hint">{t("settings.provider.defaultModelHint")}</small>
                  </div>
                  <div className="cinema-provider-field">
                    <label htmlFor="cinema-provider-models">{t("settings.provider.models")}</label>
                    <textarea
                      id="cinema-provider-models"
                      value={form.models}
                      rows={3}
                      aria-describedby="cinema-provider-models-hint"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={"gpt-5\ngpt-5-mini"}
                      onChange={(event) => updateForm("models", event.target.value)}
                    />
                    <small id="cinema-provider-models-hint">{t("settings.provider.modelsHint")}</small>
                  </div>
                  <div className="cinema-provider-field">
                    <label htmlFor="cinema-provider-text-prompt">{t("settings.provider.textPrompt")}</label>
                    <textarea
                      id="cinema-provider-text-prompt"
                      value={form.textGenerationPrompt}
                      rows={3}
                      aria-describedby="cinema-provider-text-prompt-hint"
                      placeholder={t("settings.provider.textPromptPlaceholder")}
                      onChange={(event) => updateForm("textGenerationPrompt", event.target.value)}
                    />
                    <small id="cinema-provider-text-prompt-hint">{t("settings.provider.textPromptHint")}</small>
                  </div>
                </>
              ) : null}

              {feedback ? (
                <div
                  className={`cinema-provider-feedback is-${feedback.kind}`}
                  role={feedback.kind === "error" ? "alert" : "status"}
                >
                  {feedback.message}
                </div>
              ) : null}

              <div className="cinema-provider-actions">
                <div>
                  {activeProvider.requiresCredential && credential.configured ? (
                    <button
                      type="button"
                      className="cinema-provider-action is-danger"
                      onClick={() => void removeCredential()}
                    >
                      {pendingAction === "removing"
                        ? t("settings.provider.removingKey")
                        : t("settings.provider.removeKey")}
                    </button>
                  ) : null}
                </div>
                <div>
                  {activeProviderID === "openai-compatible" ? (
                    <button
                      type="button"
                      className="cinema-provider-action is-secondary"
                      onClick={() => void discoverModels()}
                    >
                      {pendingAction === "discovering"
                        ? t("settings.provider.discoveringModels")
                        : t("settings.provider.discoverModels")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="cinema-provider-action is-secondary"
                    onClick={() => void testProvider()}
                  >
                    {pendingAction === "testing"
                      ? t("settings.provider.testing")
                      : t("settings.provider.saveAndTest")}
                  </button>
                  <button type="submit" className="cinema-provider-action is-primary">
                    {pendingAction === "saving"
                      ? t("settings.provider.saving")
                      : t("settings.provider.save")}
                  </button>
                </div>
              </div>
            </fieldset>
          </form>
        )}
      </section>
    </div>
  )
}
