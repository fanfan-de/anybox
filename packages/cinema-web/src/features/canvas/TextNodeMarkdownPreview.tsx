import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"

const markdownComponents = {
  a: ({ children }) => (
    <span className="cinema-text-markdown-link">{children}</span>
  ),
  img: ({ alt }) => alt ? (
    <span className="cinema-text-markdown-image-alt">{alt}</span>
  ) : null,
} satisfies Components

const remarkPlugins = [remarkBreaks]

export function TextNodeMarkdownPreview({ text }: { text: string }) {
  return (
    <div className="cinema-text-markdown">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={remarkPlugins}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
