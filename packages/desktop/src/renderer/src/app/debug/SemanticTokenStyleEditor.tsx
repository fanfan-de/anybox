import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import {
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_TOKEN_NAMES,
  APPEARANCE_TOKEN_RUNTIME_MAP,
  type AppearanceTokenLayer,
  type AppearanceTokenMap,
  type AppearanceTokenName,
} from "../../../../shared/appearance"
import {
  parseAppearanceColorLiteral,
  resolveAppearanceTokenCssValues,
} from "../../../../shared/appearance-color"
import type { AppearanceTheme } from "../../../../shared/appearance-themes"
import {
  isValidSemanticRuntimeTokenName,
  isValidSemanticTokenGroupID,
  isBindableSemanticRuntimeToken,
  recommendSemanticRuntimeTokenName,
  semanticTokenAuthoringOperationKey,
  type SemanticTokenAuthoringCapability,
  type SemanticTokenAuthoringDraft,
  type SemanticTokenBindingEdit,
  type SemanticTokenColorChannelResult,
  type SemanticTokenCreation,
} from "../../../../shared/semantic-token-authoring"
import type {
  SemanticTokenInspection,
  SemanticTokenInspectorPropertyResult,
} from "../../../../shared/semantic-token-inspector"
import { normalizeAppearanceColorInputValue } from "../appearance-theme"
import {
  AppearanceColorPicker,
  AppearanceColorTextInput,
} from "../settings/AppearanceColorPicker"
import type { SemanticTokenAuthoringController } from "./use-semantic-token-authoring"

interface SemanticTokenOption {
  runtimeToken: string
  groupID: string
  groupLabel: string
  groupDescription: string
  layer: AppearanceTokenLayer
  rowID: string
  label: string
  description: string
  lightToken: AppearanceTokenName
  darkToken: AppearanceTokenName
}

interface SemanticTokenStyleEditorProps {
  capability: SemanticTokenAuthoringCapability | null
  inspection: SemanticTokenInspection
  targetElement: Element | null
  selectedChannelID: string | null
  onSelectedChannelChange: (channelID: string) => void
  controller: SemanticTokenAuthoringController
  appearanceThemes?: readonly AppearanceTheme[]
  activeAppearanceThemeID?: string
  onCommitted?: (draft: SemanticTokenAuthoringDraft) => void
}

const COLOR_CHANNEL_LABELS = {
  hue: "色相",
  saturation: "饱和度",
  brightness: "明度",
  alpha: "透明度",
}

const semanticTokenOptions: SemanticTokenOption[] = APPEARANCE_TOKEN_GROUPS.flatMap((group) =>
  group.rows.flatMap((row) => {
    const runtimeToken = (APPEARANCE_TOKEN_RUNTIME_MAP as Readonly<Record<string, string>>)[row.id]
    if (!runtimeToken || !isBindableSemanticRuntimeToken(runtimeToken, group.layer)) {
      return []
    }
    return [{
      runtimeToken,
      groupID: group.id,
      groupLabel: group.label,
      groupDescription: group.description,
      layer: group.layer,
      rowID: row.id,
      label: row.label,
      description: row.description,
      lightToken: row.lightToken,
      darkToken: row.darkToken,
    }]
  }),
)

const editableGroups = APPEARANCE_TOKEN_GROUPS.filter((group) => group.layer !== "foundation")
const appearanceTokenNameSet = new Set<string>(APPEARANCE_TOKEN_NAMES)

function propertyForChannel(
  inspection: SemanticTokenInspection,
  channel: SemanticTokenColorChannelResult,
) {
  return inspection.properties.find((property) => property.property === channel.cssProperty) ??
    inspection.properties.find((property) =>
      channel.cssProperty === "border-color" && property.property === "border-color",
    )
}

function sourceLabel(property: SemanticTokenInspectorPropertyResult | undefined) {
  if (!property?.source) return "本地匹配规则"
  if (!property.source.sourceURL) return property.source.selector
  return `${property.source.sourceURL}${property.source.line ? `:${property.source.line}` : ""}`
}

function channelSwatchValue(channel: SemanticTokenColorChannelResult) {
  if (channel.kind === "background-image" || channel.kind === "image-source") return undefined
  const value = channel.computedColor.trim()
  if (parseAppearanceColorLiteral(value)) return value
  return value.match(/rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b|transparent/i)?.[0]
}

function themeTokenValues(theme: AppearanceTheme | undefined) {
  if (!theme) return null
  return resolveAppearanceTokenCssValues({
    brandTheme: theme.brandTheme,
    overrides: theme.overrides,
  })
}

function sourceModeAliases(
  property: SemanticTokenInspectorPropertyResult | undefined,
  currentOption: SemanticTokenOption | undefined,
) {
  if (currentOption) {
    return {
      light: currentOption.lightToken,
      dark: currentOption.darkToken,
    }
  }
  for (const token of property?.tokens ?? []) {
    const tokenName = token.name.replace(/^--/, "")
    const baseName = tokenName.replace(/-(?:light|dark)$/, "")
    const light = `${baseName}-light`
    const dark = `${baseName}-dark`
    if (appearanceTokenNameSet.has(light) && appearanceTokenNameSet.has(dark)) {
      return { light, dark }
    }
  }
  return {}
}

function valuesWithoutOverride(
  theme: AppearanceTheme | undefined,
  token: AppearanceTokenName,
) {
  if (!theme) return null
  const overrides = { ...theme.overrides }
  delete overrides[token]
  return resolveAppearanceTokenCssValues({
    brandTheme: theme.brandTheme,
    overrides,
  })
}

function TokenValueEditor({
  controller,
  option,
  sourceTheme,
}: {
  controller: SemanticTokenAuthoringController
  option: SemanticTokenOption
  sourceTheme?: AppearanceTheme
}) {
  const sourceValues = useMemo(() => themeTokenValues(sourceTheme), [sourceTheme])
  const lightEdit = controller.themeValueEdit(option.runtimeToken, "light")
  const darkEdit = controller.themeValueEdit(option.runtimeToken, "dark")
  const lightResetValues = useMemo(
    () => lightEdit?.action === "reset"
      ? valuesWithoutOverride(sourceTheme, option.lightToken)
      : null,
    [lightEdit?.action, option.lightToken, sourceTheme],
  )
  const darkResetValues = useMemo(
    () => darkEdit?.action === "reset"
      ? valuesWithoutOverride(sourceTheme, option.darkToken)
      : null,
    [darkEdit?.action, option.darkToken, sourceTheme],
  )
  const lightValue = lightEdit?.action === "set"
    ? lightEdit.value ?? sourceValues?.[option.lightToken] ?? "#808080"
    : lightResetValues?.[option.lightToken] ?? sourceValues?.[option.lightToken] ?? "#808080"
  const darkValue = darkEdit?.action === "set"
    ? darkEdit.value ?? sourceValues?.[option.darkToken] ?? "#808080"
    : darkResetValues?.[option.darkToken] ?? sourceValues?.[option.darkToken] ?? "#808080"
  const sourceOverrides = sourceTheme?.overrides as AppearanceTokenMap | undefined

  return (
    <section className="semantic-token-authoring-color-editor" aria-label="Token Light and Dark colors">
      <header>
        <div>
          <strong>Token 颜色</strong>
          <span>写入 {sourceTheme?.name ?? controller.sourceThemeID} 的 overrides</span>
        </div>
      </header>
      {([
        ["light", "Light", option.lightToken, lightValue, lightEdit],
        ["dark", "Dark", option.darkToken, darkValue, darkEdit],
      ] as const).map(([mode, label, modeToken, value, edit]) => (
        <div className="semantic-token-authoring-color-row" key={mode}>
          <span className="mode">{label}</span>
          <AppearanceColorPicker
            ariaLabel={`${option.label} ${label}`}
            channelLabels={COLOR_CHANNEL_LABELS}
            value={value}
            onChange={(nextValue) => controller.setThemeValue(option.runtimeToken, mode, nextValue)}
          />
          <AppearanceColorTextInput
            ariaLabel={`${option.label} ${label} color value`}
            value={value}
            onCommit={(nextValue) => controller.setThemeValue(option.runtimeToken, mode, nextValue)}
          />
          {edit ? (
            <button
              type="button"
              className="semantic-token-authoring-text-button"
              onClick={() => controller.restoreThemeSourceValue(option.runtimeToken, mode)}
            >
              恢复源码值
            </button>
          ) : sourceOverrides?.[modeToken] ? (
            <button
              type="button"
              className="semantic-token-authoring-text-button"
              onClick={() => controller.resetThemeOverride(option.runtimeToken, mode)}
            >
              移除 override
            </button>
          ) : null}
        </div>
      ))}
    </section>
  )
}

function NewTokenDialog({
  baseAliases,
  channel,
  currentOption,
  initialValues,
  onCancel,
  onCreate,
  selector,
}: {
  baseAliases: { light?: string; dark?: string }
  channel: SemanticTokenColorChannelResult
  currentOption?: SemanticTokenOption
  initialValues: { light?: string; dark?: string }
  onCancel: () => void
  onCreate: (creation: SemanticTokenCreation) => void
  selector: string
}) {
  const recommended = recommendSemanticRuntimeTokenName({
    selector,
    channel: channel.kind,
    state: channel.state,
  })
  const defaultColor = normalizeAppearanceColorInputValue(
    channelSwatchValue(channel) ?? "",
    "#808080",
  )
  const initialGroup = currentOption?.groupID ??
    editableGroups.find((group) => group.layer === "component")?.id ??
    editableGroups[0]?.id ??
    "__new__"
  const [runtimeToken, setRuntimeToken] = useState(recommended)
  const [groupID, setGroupID] = useState(initialGroup)
  const [newGroupID, setNewGroupID] = useState(
    `component-${recommended.replace(/^semantic-/, "").split("-").slice(0, -1).join("-")}`,
  )
  const [groupLabel, setGroupLabel] = useState("Component / Custom")
  const [groupDescription, setGroupDescription] = useState(`Semantic colors for ${selector}.`)
  const [layer, setLayer] = useState<Exclude<AppearanceTokenLayer, "foundation">>("component")
  const [label, setLabel] = useState(`${channel.label} · ${channel.stateLabel}`)
  const [description, setDescription] = useState(
    `${selector} 在 ${channel.stateLabel} 状态下的${channel.label}颜色。`,
  )
  const [lightValue, setLightValue] = useState(initialValues.light ?? defaultColor)
  const [darkValue, setDarkValue] = useState(initialValues.dark ?? defaultColor)
  const runtimeConflict = (
    semanticTokenOptions.some((option) => option.runtimeToken === runtimeToken) ||
    appearanceTokenNameSet.has(runtimeToken) ||
    appearanceTokenNameSet.has(`${runtimeToken}-light`) ||
    appearanceTokenNameSet.has(`${runtimeToken}-dark`)
  )
  const newGroupValid = groupID !== "__new__" || isValidSemanticTokenGroupID(newGroupID.trim())
  const valid = (
    isValidSemanticRuntimeTokenName(runtimeToken) &&
    !runtimeConflict &&
    newGroupValid &&
    Boolean(label.trim()) &&
    Boolean(description.trim()) &&
    (
      groupID !== "__new__" ||
      (Boolean(newGroupID.trim()) && Boolean(groupLabel.trim()) && Boolean(groupDescription.trim()))
    )
  )
  const selectedGroup = editableGroups.find((group) => group.id === groupID)

  return (
    <div className="semantic-token-authoring-modal-backdrop">
      <section
        className="semantic-token-authoring-modal"
        role="dialog"
        aria-modal="true"
        aria-label="新建 Semantic Token"
      >
        <header>
          <div>
            <span>新建 Semantic Token</span>
            <strong>{channel.label}</strong>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭新建 Token">×</button>
        </header>
        <div className="semantic-token-authoring-form">
          <label>
            <span>Runtime 名称</span>
            <input
              value={runtimeToken}
              spellCheck={false}
              onChange={(event) => setRuntimeToken(event.currentTarget.value.trim().toLowerCase())}
            />
            <code>--{runtimeToken || "semantic-…"}</code>
          </label>
          {!isValidSemanticRuntimeTokenName(runtimeToken) ? (
            <p className="is-error">名称必须使用 semantic-* kebab-case，且不能包含 -light/-dark。</p>
          ) : runtimeConflict ? (
            <p className="is-error">该 runtime 名称已存在。</p>
          ) : null}
          <label>
            <span>所属分组</span>
            <select
              value={groupID}
              onChange={(event) => {
                const nextGroupID = event.currentTarget.value
                setGroupID(nextGroupID)
                const group = editableGroups.find((candidate) => candidate.id === nextGroupID)
                if (group) setLayer(group.layer)
              }}
            >
              {editableGroups.map((group) => (
                <option key={group.id} value={group.id}>{group.label} · {group.layer}</option>
              ))}
              <option value="__new__">创建新的 component 分组…</option>
            </select>
          </label>
          {groupID === "__new__" ? (
            <div className="semantic-token-authoring-new-group">
              <label>
                <span>分组 ID</span>
                <input value={newGroupID} onChange={(event) => setNewGroupID(event.currentTarget.value)} />
              </label>
              {!newGroupValid ? (
                <p className="is-error">分组 ID 必须使用 kebab-case。</p>
              ) : null}
              <label>
                <span>分组名称</span>
                <input value={groupLabel} onChange={(event) => setGroupLabel(event.currentTarget.value)} />
              </label>
              <label>
                <span>分组说明</span>
                <input
                  value={groupDescription}
                  onChange={(event) => setGroupDescription(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>Layer（高级）</span>
                <select
                  value={layer}
                  onChange={(event) =>
                    setLayer(event.currentTarget.value as Exclude<AppearanceTokenLayer, "foundation">)
                  }
                >
                  <option value="component">component</option>
                  <option value="product">product</option>
                  <option value="status">status</option>
                  <option value="global">global</option>
                </select>
              </label>
            </div>
          ) : null}
          <label>
            <span>显示名称</span>
            <input value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
          </label>
          <label>
            <span>用途说明</span>
            <textarea value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
          </label>
          <div className="semantic-token-authoring-new-colors">
            {([
              ["Light", lightValue, setLightValue],
              ["Dark", darkValue, setDarkValue],
            ] as const).map(([mode, value, onChange]) => (
              <label key={mode}>
                <span>{mode}</span>
                <span className="color-control">
                  <AppearanceColorPicker
                    ariaLabel={`新 Token ${mode}`}
                    channelLabels={COLOR_CHANNEL_LABELS}
                    value={value}
                    onChange={onChange}
                  />
                  <AppearanceColorTextInput
                    ariaLabel={`新 Token ${mode} color value`}
                    value={value}
                    onCommit={onChange}
                  />
                </span>
              </label>
            ))}
          </div>
          <p className="semantic-token-authoring-pairing">
            自动配对：<code>--{runtimeToken}-light</code> / <code>--{runtimeToken}-dark</code>
          </p>
        </div>
        <footer>
          <button type="button" onClick={onCancel}>取消</button>
          <button
            type="button"
            className="is-primary"
            disabled={!valid}
            onClick={() => {
              const finalGroupID = groupID === "__new__" ? newGroupID.trim() : groupID
              onCreate({
                kind: "token-creation",
                runtimeToken,
                groupID: finalGroupID,
                createGroup: groupID === "__new__",
                groupLabel: groupID === "__new__" ? groupLabel.trim() : undefined,
                groupDescription: groupID === "__new__" ? groupDescription.trim() : undefined,
                layer: groupID === "__new__"
                  ? layer
                  : (selectedGroup?.layer as Exclude<AppearanceTokenLayer, "foundation">),
                label: label.trim(),
                description: description.trim(),
                light: {
                  value: lightValue,
                  baseAlias: baseAliases.light,
                },
                dark: {
                  value: darkValue,
                  baseAlias: baseAliases.dark,
                },
              })
            }}
          >
            创建并绑定
          </button>
        </footer>
      </section>
    </div>
  )
}

function ReviewDialog({
  controller,
  onCommitted,
}: {
  controller: SemanticTokenAuthoringController
  onCommitted?: (draft: SemanticTokenAuthoringDraft) => void
}) {
  const review = controller.review
  if (!review) return null
  const bindings = controller.operations.filter(
    (operation): operation is SemanticTokenBindingEdit => operation.kind === "binding-edit",
  )
  const values = controller.operations.filter((operation) => operation.kind === "theme-token-value-edit")
  const creations = controller.operations.filter((operation) => operation.kind === "token-creation")

  return (
    <div className="semantic-token-authoring-modal-backdrop">
      <section
        className="semantic-token-authoring-review"
        role="dialog"
        aria-modal="true"
        aria-label="审阅 Semantic Token 修改"
      >
        <header>
          <div>
            <span>设计会话</span>
            <strong>审阅 {controller.changeCount} 项修改</strong>
          </div>
          <button type="button" onClick={controller.closeReview} aria-label="关闭审阅">×</button>
        </header>
        <div className="semantic-token-authoring-review-body">
          <section>
            <h3>绑定修改 · {bindings.length}</h3>
            {bindings.map((binding) => (
              <div className="review-operation" key={semanticTokenAuthoringOperationKey(binding)}>
                <code>{binding.selector}</code>
                <span>{binding.cssProperty} → var(--{binding.runtimeToken})</span>
              </div>
            ))}
          </section>
          <section>
            <h3>Token 颜色 · {values.length}</h3>
            {values.map((value) => (
              <div className="review-operation" key={semanticTokenAuthoringOperationKey(value)}>
                <code>--{value.runtimeToken}-{value.mode}</code>
                <span>{value.action === "reset" ? "移除主题 override" : value.value}</span>
              </div>
            ))}
          </section>
          <section>
            <h3>新 Token · {creations.length}</h3>
            {creations.map((creation) => (
              <div className="review-operation" key={semanticTokenAuthoringOperationKey(creation)}>
                <code>--{creation.runtimeToken}</code>
                <span>{creation.groupID} · {creation.layer}</span>
              </div>
            ))}
          </section>
          <section>
            <h3>文件差异 · {review.files.length}</h3>
            {review.files.map((file) => (
              <details key={`${file.kind}-${file.path}`} className="semantic-token-authoring-diff">
                <summary>
                  <code>{file.path}</code>
                  <span>+{file.additions} / −{file.deletions}</span>
                </summary>
                <pre>{file.diff}</pre>
              </details>
            ))}
          </section>
        </div>
        {controller.error ? <pre className="semantic-token-authoring-error">{controller.error}</pre> : null}
        <footer>
          <button type="button" onClick={controller.closeReview}>返回编辑</button>
          <button
            type="button"
            className="is-primary"
            disabled={controller.committing}
            onClick={() => {
              const committedDraft: SemanticTokenAuthoringDraft = {
                version: 1,
                sourceThemeID: controller.sourceThemeID,
                operations: [...controller.operations],
              }
              void controller.commitReview().then((result) => {
                if (result?.status === "committed") onCommitted?.(committedDraft)
              })
            }}
          >
            {controller.committing ? "正在写回…" : "确认写回源码"}
          </button>
        </footer>
      </section>
    </div>
  )
}

export function SemanticTokenAuthoringSessionBar({
  controller,
}: {
  controller: SemanticTokenAuthoringController
}) {
  if (
    controller.changeCount === 0 &&
    !controller.canRedo &&
    !controller.lastCommitResult
  ) {
    return null
  }
  return (
    <div className="semantic-token-authoring-session-bar">
      <span>
        {controller.lastCommitResult?.status === "committed"
          ? "源码已写回，等待 HMR 验证"
          : `${controller.changeCount} 项未保存修改`}
      </span>
      {controller.changeCount > 0 || controller.canRedo ? (
        <div>
          <button type="button" disabled={!controller.canUndo} onClick={controller.undo}>撤销</button>
          <button type="button" disabled={!controller.canRedo} onClick={controller.redo}>重做</button>
          <button
            type="button"
            disabled={controller.preparing || controller.changeCount === 0}
            onClick={() => void controller.prepareReview()}
          >
            {controller.preparing ? "准备中…" : "审阅变更"}
          </button>
          <button type="button" className="is-danger" onClick={controller.discard}>放弃会话</button>
        </div>
      ) : null}
    </div>
  )
}

export function SemanticTokenStyleEditor({
  capability,
  inspection,
  targetElement,
  selectedChannelID,
  onSelectedChannelChange,
  controller,
  appearanceThemes = [],
  activeAppearanceThemeID,
  onCommitted,
}: SemanticTokenStyleEditorProps) {
  const channels = Array.isArray(inspection.channels) ? inspection.channels : []
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelID) ??
    channels[0]
  const selectedProperty = selectedChannel
    ? propertyForChannel(inspection, selectedChannel)
    : undefined
  const [query, setQuery] = useState("")
  const [activeOptionIndex, setActiveOptionIndex] = useState(0)
  const [selectedRuntimeToken, setSelectedRuntimeToken] = useState<string | null>(
    selectedChannel?.currentRuntimeToken ?? null,
  )
  const [selectedRuleRef, setSelectedRuleRef] = useState<string | undefined>(
    selectedChannel?.insertionRules.find((rule) => rule.recommended)?.ruleRef,
  )
  const [newTokenOpen, setNewTokenOpen] = useState(false)
  const initializedSourceThemeForSession = useRef<string | null>(null)
  const activeTheme = appearanceThemes.find((theme) => theme.id === activeAppearanceThemeID)
  const sourceTheme = appearanceThemes.find((theme) => theme.id === controller.sourceThemeID)
  const sourceThemeValues = useMemo(() => themeTokenValues(sourceTheme), [sourceTheme])
  const currentBinding = selectedChannel ? controller.bindingForChannel(selectedChannel) : undefined
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = semanticTokenOptions.filter((option) => {
    if (!normalizedQuery) return true
    return [
      option.runtimeToken,
      option.label,
      option.description,
      option.groupLabel,
      option.layer,
    ].some((value) => value.toLowerCase().includes(normalizedQuery))
  })
  const groupedOptions = filteredOptions.reduce((groups, option) => {
    const existing = groups.get(option.groupID) ?? []
    existing.push(option)
    groups.set(option.groupID, existing)
    return groups
  }, new Map<string, SemanticTokenOption[]>())
  const selectedOption = semanticTokenOptions.find((option) =>
    option.runtimeToken === (currentBinding?.runtimeToken ?? selectedRuntimeToken),
  )
  const newTokenBaseAliases = sourceModeAliases(selectedProperty, selectedOption)
  const visibleChannelCount = channels.filter((channel) => channel.visibility === "visible").length

  useEffect(() => {
    const nextRuntime = currentBinding?.runtimeToken ?? selectedChannel?.currentRuntimeToken ?? null
    setSelectedRuntimeToken(nextRuntime)
    setSelectedRuleRef(selectedChannel?.insertionRules.find((rule) => rule.recommended)?.ruleRef)
    setQuery("")
    setActiveOptionIndex(0)
  }, [currentBinding?.runtimeToken, selectedChannel?.currentRuntimeToken, selectedChannel?.id])

  useEffect(() => {
    if (capability?.status !== "available" || controller.changeCount > 0) return
    if (initializedSourceThemeForSession.current === capability.sessionID) return
    initializedSourceThemeForSession.current = capability.sessionID
    const targetThemeID = activeTheme?.source === "built-in"
      ? activeTheme.id
      : capability.defaultSourceThemeID
    controller.setSourceThemeID(targetThemeID)
  }, [activeTheme, capability, controller, controller.changeCount])

  function selectToken(option: SemanticTokenOption) {
    if (!selectedChannel || !targetElement) return
    const selector = selectedProperty?.source?.selector ??
      selectedChannel.insertionRules.find((rule) => rule.ruleRef === selectedRuleRef)?.selector ??
      "<matched rule>"
    controller.bindChannel(
      selectedChannel,
      option.runtimeToken,
      targetElement,
      selector,
      sourceLabel(selectedProperty),
      selectedRuleRef,
    )
    setSelectedRuntimeToken(option.runtimeToken)
  }

  function handleListboxKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (filteredOptions.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveOptionIndex((index) => Math.min(filteredOptions.length - 1, index + 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveOptionIndex((index) => Math.max(0, index - 1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      selectToken(filteredOptions[activeOptionIndex] ?? filteredOptions[0])
    } else if (event.key === "Escape") {
      event.stopPropagation()
      setQuery("")
    }
  }

  return (
    <div className="semantic-token-style-editor">
      <aside className="semantic-token-style-sidebar">
        <header>
          <div>
            <strong>颜色通道</strong>
            <span>选择要绑定或调色的视觉属性</span>
          </div>
          <small>{visibleChannelCount} / {channels.length} 显示</small>
        </header>
        <ul className="semantic-token-channel-list" aria-label="颜色通道">
        {channels.map((channel) => {
          const binding = controller.bindingForChannel(channel)
          const swatch = channelSwatchValue(channel)
          return (
            <li key={channel.id}>
              <button
                type="button"
                className={[
                  "semantic-token-channel-row",
                  channel.id === selectedChannel?.id ? "is-selected" : "",
                  `is-${channel.visibility}`,
                ].filter(Boolean).join(" ")}
                onClick={() => onSelectedChannelChange(channel.id)}
              >
                <span
                  className="semantic-token-inspector-swatch"
                  style={swatch ? { backgroundColor: swatch } : undefined}
                  aria-hidden="true"
                />
                <span className="semantic-token-channel-copy">
                  <strong>{channel.label}</strong>
                  <small>{channel.cssProperty} · {channel.stateLabel}</small>
                </span>
                <code>
                  {binding
                    ? `--${binding.runtimeToken}`
                    : channel.currentRuntimeToken
                      ? `--${channel.currentRuntimeToken}`
                      : channel.computedColor || "—"}
                </code>
                <span className={`semantic-token-channel-status is-${channel.visibility}`}>
                  {channel.visibility === "visible"
                    ? "显示"
                    : channel.visibility === "inactive"
                      ? "隐藏"
                      : "未知"}
                </span>
              </button>
            </li>
          )
        })}
        </ul>
      </aside>

      <div className="semantic-token-style-detail">
        {capability?.status === "available" ? (
          <div className="semantic-token-authoring-source-theme">
            <label>
              <span>源码目标主题</span>
              <select
                value={controller.sourceThemeID}
                disabled={controller.changeCount > 0}
                onChange={(event) => controller.setSourceThemeID(event.currentTarget.value)}
              >
                {capability.sourceThemes.map((theme) => (
                  <option key={theme.id} value={theme.id}>{theme.name}</option>
                ))}
              </select>
            </label>
            {activeTheme && activeTheme.source !== "built-in" ? (
              <p>当前正在预览用户主题；源码颜色将写入所选内置主题。</p>
            ) : null}
          </div>
        ) : (
          <p className="semantic-token-authoring-readonly">
            {capability?.status === "read-only"
              ? capability.message
              : "此 Inspector 会话只读；仍可查看颜色通道。"}
          </p>
        )}

        {selectedChannel ? (
          <section className="semantic-token-channel-editor">
          <header>
            <div>
              <small>正在编辑</small>
              <strong>{selectedChannel.label}</strong>
              <span>{selectedChannel.cssProperty} · {selectedChannel.scopeDescription}</span>
            </div>
            <div className="semantic-token-channel-editor-state">
              <span className="semantic-token-channel-state">{selectedChannel.stateLabel}</span>
              {(currentBinding?.runtimeToken ?? selectedChannel.currentRuntimeToken) ? (
                <code title={`--${currentBinding?.runtimeToken ?? selectedChannel.currentRuntimeToken}`}>
                  --{currentBinding?.runtimeToken ?? selectedChannel.currentRuntimeToken}
                </code>
              ) : null}
            </div>
          </header>
          {selectedChannel.visibilityReason ? <p>{selectedChannel.visibilityReason}</p> : null}
          {selectedChannel.followsChannelID ? (
            <div className="semantic-token-current-color">
              <span>当前跟随“文字与前景”颜色。</span>
              <button
                type="button"
                onClick={() => onSelectedChannelChange(selectedChannel.followsChannelID!)}
              >
                转去修改前景
              </button>
              <small>也可以在下方选择 Token，解除跟随并单独绑定。</small>
            </div>
          ) : null}
          {!selectedChannel.previewable ? (
            <p className="semantic-token-authoring-readonly">{selectedChannel.readOnlyReason}</p>
          ) : (
            <>
              {!selectedChannel.editRef && selectedChannel.insertionRules.length > 0 ? (
                <label className="semantic-token-authoring-rule-select">
                  <span>插入声明到</span>
                  <select
                    value={selectedRuleRef}
                    onChange={(event) => setSelectedRuleRef(event.currentTarget.value)}
                  >
                    {selectedChannel.insertionRules.map((rule) => (
                      <option key={rule.ruleRef} value={rule.ruleRef}>
                        {rule.recommended ? "推荐 · " : ""}{rule.selector}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {!selectedChannel.writable ? (
                <p className="semantic-token-authoring-preview-note">
                  {selectedChannel.readOnlyReason} 选择 Token 时仅做局部预览，不会加入写回会话。
                </p>
              ) : null}
              <div className="semantic-token-picker">
                <header className="semantic-token-picker-heading">
                  <div>
                    <strong>绑定 Semantic Token</strong>
                    <span>选择后立即预览；保存时作用于当前 selector 的所有实例</span>
                  </div>
                  <small>{filteredOptions.length} 个可用</small>
                </header>
                <div className="semantic-token-picker-search">
                  <input
                    role="combobox"
                    aria-label={`搜索 ${selectedChannel.label} Semantic Token`}
                    aria-controls="semantic-token-picker-listbox"
                    aria-expanded="true"
                    value={query}
                    placeholder="搜索名称、说明或 runtime…"
                    onChange={(event) => {
                      setQuery(event.currentTarget.value)
                      setActiveOptionIndex(0)
                    }}
                    onKeyDown={handleListboxKeyDown}
                  />
                  {capability?.status === "available" && selectedChannel.writable ? (
                    <button type="button" onClick={() => setNewTokenOpen(true)}>新建 Token</button>
                  ) : null}
                </div>
                <div
                  id="semantic-token-picker-listbox"
                  className="semantic-token-picker-listbox"
                  role="listbox"
                  aria-label="可绑定的 Semantic runtime tokens"
                >
                  {[...groupedOptions.entries()].map(([groupID, options]) => (
                    <section key={groupID} className="semantic-token-picker-group">
                      <header>
                        <strong>{options[0].groupLabel}</strong>
                        <span>{options[0].layer}</span>
                      </header>
                      {options.map((option) => {
                        const globalIndex = filteredOptions.indexOf(option)
                        const selected = option.runtimeToken === selectedOption?.runtimeToken
                        return (
                          <button
                            key={option.runtimeToken}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            className={[
                              selected ? "is-selected" : "",
                              globalIndex === activeOptionIndex ? "is-active" : "",
                            ].filter(Boolean).join(" ")}
                            onMouseEnter={() => setActiveOptionIndex(globalIndex)}
                            onClick={() => selectToken(option)}
                          >
                            <span className="semantic-token-picker-swatches" aria-hidden="true">
                              <i style={{ backgroundColor: sourceThemeValues?.[option.lightToken] }} />
                              <i style={{ backgroundColor: sourceThemeValues?.[option.darkToken] }} />
                            </span>
                            <span>
                              <strong>{option.label}</strong>
                              <small>{option.description}</small>
                            </span>
                            <code>--{option.runtimeToken}</code>
                          </button>
                        )
                      })}
                    </section>
                  ))}
                  {filteredOptions.length === 0 ? <p>没有匹配的 Semantic runtime token。</p> : null}
                </div>
              </div>
              {selectedOption && capability?.status === "available" && selectedChannel.writable ? (
                <TokenValueEditor
                  controller={controller}
                  option={selectedOption}
                  sourceTheme={sourceTheme}
                />
              ) : null}
            </>
          )}
        </section>
        ) : (
          <p className="semantic-token-inspector-empty">没有可检测的颜色通道。</p>
        )}

        {controller.error && !controller.review ? (
          <pre className="semantic-token-authoring-error">{controller.error}</pre>
        ) : null}
      </div>
      {newTokenOpen && selectedChannel && targetElement ? (
        <NewTokenDialog
          baseAliases={newTokenBaseAliases}
          channel={selectedChannel}
          currentOption={selectedOption}
          initialValues={{
            light: newTokenBaseAliases.light
              ? sourceThemeValues?.[newTokenBaseAliases.light as AppearanceTokenName]
              : undefined,
            dark: newTokenBaseAliases.dark
              ? sourceThemeValues?.[newTokenBaseAliases.dark as AppearanceTokenName]
              : undefined,
          }}
          selector={selectedProperty?.source?.selector ??
            selectedChannel.insertionRules.find((rule) => rule.ruleRef === selectedRuleRef)?.selector ??
            inspection.target.classes[0] ??
            inspection.target.tagName.toLowerCase()}
          onCancel={() => setNewTokenOpen(false)}
          onCreate={(creation) => {
            const selector = selectedProperty?.source?.selector ??
              selectedChannel.insertionRules.find((rule) => rule.ruleRef === selectedRuleRef)?.selector ??
              "<matched rule>"
            controller.createTokenAndBind(
              creation,
              selectedChannel,
              targetElement,
              selector,
              sourceLabel(selectedProperty),
              selectedRuleRef,
            )
            setSelectedRuntimeToken(creation.runtimeToken)
            setNewTokenOpen(false)
          }}
        />
      ) : null}
      <ReviewDialog controller={controller} onCommitted={onCommitted} />
    </div>
  )
}
