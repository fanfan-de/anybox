import { useMemo, type CSSProperties } from "react"
import { useI18n } from "../i18n/I18nProvider"
import type { HtmlBackgroundConfig } from "./html-background-config"
import {
  buildTrustedDynamicHtmlBackgroundDocument,
  sanitizeHtmlBackgroundDocument,
} from "./html-background-sanitize"

interface HtmlBackgroundLayerProps {
  config: HtmlBackgroundConfig
}

export function HtmlBackgroundLayer({ config }: HtmlBackgroundLayerProps) {
  const { t } = useI18n()
  const shouldRender = config.enabled && config.html.trim().length > 0
  const html = useMemo(
    () => {
      if (!shouldRender) return ""

      return config.renderMode === "dynamic"
        ? buildTrustedDynamicHtmlBackgroundDocument(config.html, { paused: config.paused })
        : sanitizeHtmlBackgroundDocument(config.html, { paused: config.paused })
    },
    [config.html, config.paused, config.renderMode, shouldRender],
  )

  if (!shouldRender) return null

  const style = {
    "--html-background-blur": `${config.blurPx}px`,
    "--html-background-dim": String(config.dim),
    "--html-background-opacity": String(config.opacity),
  } as CSSProperties

  return (
    <div className="html-background-layer" aria-hidden="true" style={style}>
      <iframe
        className="html-background-frame"
        sandbox={config.renderMode === "dynamic" ? "allow-scripts" : ""}
        srcDoc={html}
        tabIndex={-1}
        title={t("settings.appearance.htmlBackgroundTitle")}
      />
      <div className="html-background-scrim" />
    </div>
  )
}
