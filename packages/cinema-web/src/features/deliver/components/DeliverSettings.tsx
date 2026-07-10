import {
  CINEMA_RENDER_MAX_TARGET_VIDEO_BITRATE_KBPS,
  type CinemaRenderSettings,
} from "@anybox/shared/cinema-render"
import type { RenderApi } from "../api/renderApi"
import { RENDER_PRESETS, type RenderPresetID } from "../model/renderPresets"
import { RenderRetentionPanel } from "./RenderRetentionPanel"

const COMMON_FRAME_RATES: readonly CinemaRenderSettings["frameRate"][] = [
  { numerator: 24_000, denominator: 1_001 },
  { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 },
  { numerator: 30_000, denominator: 1_001 },
  { numerator: 30, denominator: 1 },
  { numerator: 50, denominator: 1 },
  { numerator: 60_000, denominator: 1_001 },
  { numerator: 60, denominator: 1 },
]

function frameRateKey(frameRate: CinemaRenderSettings["frameRate"]) {
  return `${frameRate.numerator}/${frameRate.denominator}`
}

function frameRateLabel(frameRate: CinemaRenderSettings["frameRate"]) {
  const value = frameRate.numerator / frameRate.denominator
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "")
}

export function DeliverSettings({
  settings,
  presetID,
  onSettingsChange,
  onPresetChange,
  timelineDurationUs,
  renderApi,
  executionAuthorized,
  disabled,
}: {
  settings: CinemaRenderSettings | null
  presetID: RenderPresetID
  onSettingsChange: (patch: Partial<CinemaRenderSettings>) => void
  onPresetChange: (presetID: RenderPresetID) => void
  timelineDurationUs: number
  renderApi: RenderApi
  executionAuthorized: boolean
  disabled?: boolean
}) {
  if (!settings) {
    return (
      <aside className="cinema-deliver-settings" aria-label="Render settings">
        <p>Select a Timeline to edit render settings.</p>
        <RenderRetentionPanel api={renderApi} executionAuthorized={executionAuthorized} />
      </aside>
    )
  }
  const fullDurationUs = Math.max(1, timelineDurationUs)
  const customRange = settings.range.type === "custom"
    ? settings.range
    : { type: "custom" as const, startUs: 0, endUs: fullDurationUs }
  const currentFrameRateKey = frameRateKey(settings.frameRate)
  const frameRates = COMMON_FRAME_RATES.some((frameRate) => frameRateKey(frameRate) === currentFrameRateKey)
    ? COMMON_FRAME_RATES
    : [settings.frameRate, ...COMMON_FRAME_RATES]
  return (
    <aside className="cinema-deliver-settings" aria-label="Render settings">
      <div className="cinema-deliver-section-heading"><span>Render settings</span></div>
      <fieldset disabled={disabled}>
        <legend className="cinema-deliver-field-label">Preset</legend>
        <div className="cinema-deliver-preset-list" role="listbox" aria-label="Render preset">
          {RENDER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={preset.id === presetID}
              className={`cinema-deliver-preset-row ${preset.id === presetID ? "is-selected" : ""}`}
              title={preset.description}
              onClick={() => onPresetChange(preset.id)}
            >
              <strong>{preset.label}</strong>
            </button>
          ))}
        </div>
        <div className="cinema-deliver-form-grid">
          <label>
            <span>Width</span>
            <input type="number" min={2} max={7680} step={2} value={settings.width} onChange={(event) => onSettingsChange({ width: Number(event.target.value) })} />
          </label>
          <label>
            <span>Height</span>
            <input type="number" min={2} max={7680} step={2} value={settings.height} onChange={(event) => onSettingsChange({ height: Number(event.target.value) })} />
          </label>
        </div>
        <div className="cinema-deliver-setting-row is-block">
          <span className="cinema-deliver-field-label">Frame rate</span>
          <div className="cinema-deliver-segmented" role="listbox" aria-label="Frame rate">
            {frameRates.map((frameRate) => {
              const key = frameRateKey(frameRate)
              const label = frameRateLabel(frameRate)
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-label={`${label} frames per second`}
                  aria-selected={key === currentFrameRateKey}
                  className={key === currentFrameRateKey ? "is-selected" : ""}
                  onClick={() => onSettingsChange({ frameRate })}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
        {settings.quality.mode === "target-bitrate" ? (
          <label className="cinema-deliver-output-name">
            <span>Video bitrate (kbps)</span>
            <input
              type="number"
              min={100}
              max={CINEMA_RENDER_MAX_TARGET_VIDEO_BITRATE_KBPS}
              step={100}
              value={settings.quality.targetVideoBitrateKbps}
              onChange={(event) => onSettingsChange({
                quality: {
                  mode: "target-bitrate",
                  targetVideoBitrateKbps: Number(event.target.value),
                },
              })}
            />
          </label>
        ) : null}
        <div className="cinema-deliver-setting-row is-block">
          <span className="cinema-deliver-field-label">Audio bitrate</span>
          <div className="cinema-deliver-segmented" role="listbox" aria-label="Audio bitrate">
            {[128, 192, 256, 320].map((bitrate) => (
              <button
                key={bitrate}
                type="button"
                role="option"
                aria-selected={settings.audioBitrateKbps === bitrate}
                className={settings.audioBitrateKbps === bitrate ? "is-selected" : ""}
                onClick={() => onSettingsChange({ audioBitrateKbps: bitrate as CinemaRenderSettings["audioBitrateKbps"] })}
              >
                {bitrate}
              </button>
            ))}
          </div>
        </div>
        <div className="cinema-deliver-range-block">
          <span className="cinema-deliver-field-label">Range</span>
          <div className="cinema-deliver-segmented" role="listbox" aria-label="Render range">
            <button type="button" role="option" aria-selected={settings.range.type === "full"} className={settings.range.type === "full" ? "is-selected" : ""} onClick={() => onSettingsChange({ range: { type: "full" } })}>Full timeline</button>
            <button type="button" role="option" aria-selected={settings.range.type === "custom"} className={settings.range.type === "custom" ? "is-selected" : ""} onClick={() => onSettingsChange({ range: settings.range.type === "custom" ? settings.range : { type: "custom", startUs: 0, endUs: fullDurationUs } })}>Custom</button>
          </div>
          {settings.range.type === "custom" ? (
            <div className="cinema-deliver-form-grid">
              <label><span>Start (s)</span><input type="number" min={0} max={fullDurationUs / 1_000_000} step={0.001} value={customRange.startUs / 1_000_000} onChange={(event) => onSettingsChange({ range: { ...customRange, startUs: Math.max(0, Math.round(Number(event.target.value) * 1_000_000)) } })} /></label>
              <label><span>End (s)</span><input type="number" min={0} max={fullDurationUs / 1_000_000} step={0.001} value={customRange.endUs / 1_000_000} onChange={(event) => onSettingsChange({ range: { ...customRange, endUs: Math.max(0, Math.round(Number(event.target.value) * 1_000_000)) } })} /></label>
            </div>
          ) : null}
        </div>
        <label className="cinema-deliver-output-name">
          <span>Output name</span>
          <input type="text" maxLength={160} value={settings.outputName} onChange={(event) => onSettingsChange({ outputName: event.target.value })} />
          <small>.mp4 will be added automatically.</small>
        </label>
      </fieldset>
      <RenderRetentionPanel api={renderApi} executionAuthorized={executionAuthorized} />
    </aside>
  )
}
