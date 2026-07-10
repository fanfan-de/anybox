import { memo, useMemo } from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import type { Root } from "hast"
import { toJsxRuntime } from "hast-util-to-jsx-runtime"
import type { Components } from "react-markdown"

type HastRuntimeComponents = NonNullable<Parameters<typeof toJsxRuntime>[1]["components"]>

export interface ThreadMarkdownHastBlockProps {
  components: Components
  /** Treat the cached tree as immutable and replace its identity when it changes. */
  root: Root
}

export const ThreadMarkdownHastBlock = memo(function ThreadMarkdownHastBlock({
  components,
  root,
}: ThreadMarkdownHastBlockProps) {
  return useMemo(
    () => toJsxRuntime(root, {
      Fragment,
      components: components as unknown as HastRuntimeComponents,
      jsx,
      jsxs,
      passKeys: true,
      passNode: true,
    }),
    [components, root],
  )
})
