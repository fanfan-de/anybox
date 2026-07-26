import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import {
  type AppearanceColorChannels,
  getAppearanceColorChannels,
  normalizeAppearanceColorInputValue,
  withAppearanceColorChannels,
} from "../appearance-theme"

export interface AppearanceColorPickerChannelLabels {
  hue: string
  saturation: string
  brightness: string
  alpha: string
}

interface AppearanceHsvColor {
  hue: number
  saturation: number
  brightness: number
}

export function AppearanceColorTextInput({
  ariaLabel,
  onCommit,
  value,
}: {
  ariaLabel: string
  onCommit: (value: string) => void
  value: string
}) {
  const [draftValue, setDraftValue] = useState(value)

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  function commitDraftValue() {
    const normalizedValue = normalizeAppearanceColorInputValue(draftValue, value)
    setDraftValue(normalizedValue)
    onCommit(normalizedValue)
  }

  return (
    <input
      aria-label={ariaLabel}
      className="settings-theme-color-input"
      inputMode="text"
      spellCheck={false}
      type="text"
      value={draftValue}
      onBlur={commitDraftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
          return
        }
        if (event.key === "Escape") {
          event.preventDefault()
          setDraftValue(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function clampAppearanceColorEditorValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampAppearanceColorUnitValue(value: number) {
  return clampAppearanceColorEditorValue(value, 0, 1)
}

function normalizeAppearanceColorHue(value: number) {
  if (!Number.isFinite(value)) return 0
  return clampAppearanceColorEditorValue(Math.round(value), 0, 360)
}

function getAppearanceColorHsv(channels: AppearanceColorChannels): AppearanceHsvColor {
  const red = channels.red / 255
  const green = channels.green / 255
  const blue = channels.blue / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0

  if (delta > 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6)
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2)
    } else {
      hue = 60 * ((red - green) / delta + 4)
    }
  }
  if (hue < 0) hue += 360

  return {
    hue: normalizeAppearanceColorHue(hue),
    saturation: max === 0 ? 0 : delta / max,
    brightness: max,
  }
}

function getAppearanceColorRgbFromHsv({ hue, saturation, brightness }: AppearanceHsvColor) {
  const normalizedHue = normalizeAppearanceColorHue(hue) % 360
  const normalizedSaturation = clampAppearanceColorUnitValue(saturation)
  const normalizedBrightness = clampAppearanceColorUnitValue(brightness)
  const chroma = normalizedBrightness * normalizedSaturation
  const hueSegment = normalizedHue / 60
  const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1))
  const match = normalizedBrightness - chroma
  let red = 0
  let green = 0
  let blue = 0

  if (hueSegment >= 0 && hueSegment < 1) {
    red = chroma
    green = secondary
  } else if (hueSegment < 2) {
    red = secondary
    green = chroma
  } else if (hueSegment < 3) {
    green = chroma
    blue = secondary
  } else if (hueSegment < 4) {
    green = secondary
    blue = chroma
  } else if (hueSegment < 5) {
    red = secondary
    blue = chroma
  } else {
    red = chroma
    blue = secondary
  }

  return {
    red: Math.round((red + match) * 255),
    green: Math.round((green + match) * 255),
    blue: Math.round((blue + match) * 255),
  }
}

export function AppearanceColorPicker({
  ariaLabel,
  channelLabels,
  onChange,
  value,
}: {
  ariaLabel: string
  channelLabels: AppearanceColorPickerChannelLabels
  onChange: (value: string) => void
  value: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const channels = getAppearanceColorChannels(value)
  const hsvColor = getAppearanceColorHsv(channels)
  const [editorHue, setEditorHue] = useState(() => hsvColor.hue)
  const hue = hsvColor.saturation > 0 && hsvColor.brightness > 0 ? hsvColor.hue : editorHue
  const saturation = hsvColor.saturation
  const brightness = hsvColor.brightness
  const alphaPercent = Math.round(channels.alpha * 100)
  const swatchColor = `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${channels.alpha})`
  const colorFieldStyle = {
    "--settings-theme-color-field-hue": `hsl(${hue} 100% 50%)`,
  } as CSSProperties
  const colorFieldThumbStyle = {
    left: `${saturation * 100}%`,
    top: `${(1 - brightness) * 100}%`,
    backgroundColor: swatchColor,
  }
  const alphaSliderStyle = {
    "--settings-theme-alpha-color": `rgb(${channels.red} ${channels.green} ${channels.blue})`,
  } as CSSProperties

  useEffect(() => {
    if (!isOpen) return

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setIsOpen(false)
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false)
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown)
    window.addEventListener("keydown", handleWindowKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown)
      window.removeEventListener("keydown", handleWindowKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (hsvColor.saturation > 0 && hsvColor.brightness > 0) setEditorHue(hsvColor.hue)
  }, [hsvColor.brightness, hsvColor.hue, hsvColor.saturation])

  function updateHsv(nextColor: Partial<AppearanceHsvColor>) {
    const nextHue = normalizeAppearanceColorHue(nextColor.hue ?? hue)
    const nextSaturation = clampAppearanceColorUnitValue(nextColor.saturation ?? saturation)
    const nextBrightness = clampAppearanceColorUnitValue(nextColor.brightness ?? brightness)
    setEditorHue(nextHue)
    onChange(withAppearanceColorChannels(value, getAppearanceColorRgbFromHsv({
      hue: nextHue,
      saturation: nextSaturation,
      brightness: nextBrightness,
    })))
  }

  function updateAlpha(nextValue: number) {
    if (!Number.isFinite(nextValue)) return
    onChange(withAppearanceColorChannels(value, {
      alpha: clampAppearanceColorEditorValue(nextValue, 0, 1),
    }))
  }

  function updateColorFieldFromPointer(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    updateHsv({
      saturation: (event.clientX - rect.left) / rect.width,
      brightness: 1 - (event.clientY - rect.top) / rect.height,
    })
  }

  return (
    <div className="settings-theme-color-picker" ref={rootRef}>
      <button
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="settings-theme-color-trigger"
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <span className="settings-theme-color-swatch" aria-hidden="true">
          <span style={{ backgroundColor: swatchColor }} />
        </span>
      </button>

      {isOpen ? (
        <div className="settings-theme-color-popover" role="dialog" aria-label={ariaLabel}>
          <button
            aria-label={`${ariaLabel} ${channelLabels.saturation} ${Math.round(saturation * 100)} ${channelLabels.brightness} ${Math.round(brightness * 100)}`}
            className="settings-theme-color-field"
            type="button"
            style={colorFieldStyle}
            onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
              const step = event.shiftKey ? 0.1 : 0.01
              let nextSaturation = saturation
              let nextBrightness = brightness
              if (event.key === "ArrowLeft") nextSaturation -= step
              else if (event.key === "ArrowRight") nextSaturation += step
              else if (event.key === "ArrowDown") nextBrightness -= step
              else if (event.key === "ArrowUp") nextBrightness += step
              else if (event.key === "Home") nextSaturation = 0
              else if (event.key === "End") nextSaturation = 1
              else return
              event.preventDefault()
              updateHsv({ saturation: nextSaturation, brightness: nextBrightness })
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              updateColorFieldFromPointer(event)
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                updateColorFieldFromPointer(event)
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
          >
            <span
              className="settings-theme-color-field-thumb"
              aria-hidden="true"
              style={colorFieldThumbStyle}
            />
          </button>

          <div className="settings-theme-color-slider-list">
            <div className="settings-theme-color-slider is-hue">
              <span>H</span>
              <input
                aria-label={`${ariaLabel} ${channelLabels.hue}`}
                type="range"
                min="0"
                max="360"
                step="1"
                value={hue}
                onChange={(event) => {
                  if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                    updateHsv({ hue: event.currentTarget.valueAsNumber })
                  }
                }}
              />
              <input
                aria-label={`${ariaLabel} ${channelLabels.hue} value`}
                className="settings-theme-color-number"
                type="number"
                min="0"
                max="360"
                step="1"
                value={Math.round(hue)}
                onChange={(event) => {
                  if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                    updateHsv({ hue: event.currentTarget.valueAsNumber })
                  }
                }}
              />
            </div>

            <div className="settings-theme-color-slider is-alpha" style={alphaSliderStyle}>
              <span>A</span>
              <input
                aria-label={`${ariaLabel} ${channelLabels.alpha}`}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={channels.alpha}
                onChange={(event) => updateAlpha(event.currentTarget.valueAsNumber)}
              />
              <input
                aria-label={`${ariaLabel} ${channelLabels.alpha} value`}
                className="settings-theme-color-number"
                type="number"
                min="0"
                max="100"
                step="1"
                value={alphaPercent}
                onChange={(event) => updateAlpha(event.currentTarget.valueAsNumber / 100)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
