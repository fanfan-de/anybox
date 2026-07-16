import type { ComponentPropsWithoutRef, MouseEvent } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useI18n } from "../i18n/I18nProvider"

function normalizeExternalUrl(value: string | undefined) {
  if (!value) return null

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    return parsed.toString()
  } catch {
    return null
  }
}

function SafeExternalLink({ children, href, ...props }: ComponentPropsWithoutRef<"a">) {
  const normalizedHref = normalizeExternalUrl(href)
  if (!normalizedHref) return <span>{children}</span>

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    void window.desktop?.openExternalUrl?.({ url: normalizedHref! })
  }

  return (
    <a {...props} href={normalizedHref} rel="noreferrer" onClick={handleClick}>
      {children}
    </a>
  )
}

export function SkillDocumentPreview({ content }: { content: string }) {
  const { t } = useI18n()
  return (
    <article className="skill-library-markdown thread-markdown" data-i18n-skip>
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => <SafeExternalLink {...props} />,
          img: ({ alt }) => (
            <span className="skill-library-blocked-image" role="note">
              {alt ? t("skillLibrary.remoteImageBlocked", { alt }) : t("skillLibrary.remoteImageBlockedNoAlt")}
            </span>
          ),
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={(url, key) => {
          if (key === "src") return ""
          return normalizeExternalUrl(url) ?? ""
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
