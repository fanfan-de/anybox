import React from "react"
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native"
import Markdown, { MarkdownIt, type ASTNode, type MarkdownStyles, type RenderRules } from "react-native-markdown-renderer"

interface ThreadMarkdownProps {
  text: string
}

const markdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

const markdownRules: RenderRules = {
  link: renderLink,
  blocklink: renderBlockLink,
  code_block: renderCodeBlock,
  fence: renderCodeBlock,
  pre: (node, children) => <View key={node.key}>{children}</View>,
  table: renderResponsiveTable,
  image: renderImageAlt,
  html_block: renderNothing,
  html_inline: renderNothing,
  textgroup: (node, children, _parent, styles) => (
    <Text key={node.key} selectable style={styles.text as object}>
      {children}
    </Text>
  ),
}

const markdownStyles: Partial<MarkdownStyles> = {
  root: {
    alignSelf: "stretch",
    width: "100%",
  },
  text: {
    color: "#dedede",
    fontSize: 16,
    lineHeight: 22,
  },
  paragraph: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
    marginTop: 0,
  },
  strong: {
    fontWeight: "800",
  },
  em: {
    fontStyle: "italic",
  },
  strikethrough: {
    textDecorationLine: "line-through",
  },
  headingContainer: {
    flexDirection: "row",
    marginBottom: 8,
    marginTop: 6,
  },
  heading: {
    color: "#f0f0f0",
    fontWeight: "900",
  },
  heading1: {
    fontSize: 22,
    lineHeight: 28,
  },
  heading2: {
    fontSize: 20,
    lineHeight: 26,
  },
  heading3: {
    fontSize: 18,
    lineHeight: 24,
  },
  heading4: {
    fontSize: 16,
    lineHeight: 22,
  },
  heading5: {
    fontSize: 15,
    lineHeight: 21,
  },
  heading6: {
    color: "#cfcfcf",
    fontSize: 14,
    lineHeight: 20,
  },
  blockquote: {
    borderLeftColor: "#555555",
    borderLeftWidth: 2,
    marginBottom: 10,
    paddingLeft: 10,
    paddingRight: 4,
  },
  codeInline: {
    backgroundColor: "#252525",
    borderRadius: 5,
    color: "#eeeeee",
    fontFamily: "monospace",
    fontSize: 14,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  list: {
    marginBottom: 10,
  },
  listItem: {
    flex: 1,
    flexWrap: "wrap",
    minWidth: 0,
  },
  listUnorderedItem: {
    alignItems: "flex-start",
    flexDirection: "row",
    marginTop: 3,
  },
  listUnorderedItemIcon: {
    color: "#b8b8b8",
    lineHeight: 22,
    marginLeft: 4,
    marginRight: 8,
  },
  listOrderedItem: {
    alignItems: "flex-start",
    flexDirection: "row",
    marginTop: 3,
  },
  listOrderedItemIcon: {
    color: "#b8b8b8",
    lineHeight: 22,
    marginLeft: 0,
    marginRight: 8,
    minWidth: 22,
    textAlign: "right",
  },
  link: {
    color: "#8dbaf2",
    textDecorationLine: "underline",
  },
  hr: {
    backgroundColor: "#3a3a3a",
    height: 1,
    marginBottom: 12,
    marginTop: 4,
  },
}

function ThreadMarkdownComponent({ text }: ThreadMarkdownProps) {
  return (
    <Markdown
      allowedImageHandlers={[]}
      defaultImageHandler={null}
      markdownit={markdownIt}
      rules={markdownRules}
      style={markdownStyles}
    >
      {text}
    </Markdown>
  )
}

export const ThreadMarkdown = React.memo(ThreadMarkdownComponent)

function renderLink(node: ASTNode, children: React.ReactNode[]) {
  const safeUrl = normalizeHttpUrl(node.attributes.href)
  if (!safeUrl) return <Text key={node.key}>{children}</Text>

  return (
    <Text key={node.key} onPress={() => openSafeUrl(safeUrl)} style={markdownStyles.link as object}>
      {children}
    </Text>
  )
}

function renderBlockLink(node: ASTNode, children: React.ReactNode[]) {
  const safeUrl = normalizeHttpUrl(node.attributes.href)
  if (!safeUrl) return <View key={node.key}>{children}</View>

  return (
    <Pressable
      accessibilityRole="link"
      key={node.key}
      onPress={() => openSafeUrl(safeUrl)}
      style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
    >
      {children}
    </Pressable>
  )
}

function renderCodeBlock(node: ASTNode) {
  return (
    <ScrollView
      horizontal
      key={node.key}
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.codeBlockScroll}
      contentContainerStyle={styles.codeBlockContent}
    >
      <Text selectable style={styles.codeBlockText}>
        {trimTrailingNewline(node.content)}
      </Text>
    </ScrollView>
  )
}

function renderResponsiveTable(node: ASTNode) {
  const table = readTable(node)
  if (!table.rows.length) return null

  return (
    <View key={node.key} style={styles.tableStack}>
      {table.rows.map((row, rowIndex) => (
        <View
          key={`${node.key}-row-${rowIndex}`}
          style={[
            styles.tableRecord,
            rowIndex === table.rows.length - 1 ? styles.tableRecordLast : null,
          ]}
        >
          {row.map((value, cellIndex) => {
            const header = table.headers[cellIndex]?.trim()
            const displayValue = value.trim()
            if (!displayValue && !header) return null

            return (
              <View key={`${node.key}-row-${rowIndex}-cell-${cellIndex}`} style={styles.tableRecordCell}>
                {header ? (
                  <Text style={styles.tableRecordHeader}>
                    {header}
                  </Text>
                ) : null}
                <Text selectable style={styles.tableRecordValue}>
                  {displayValue || "-"}
                </Text>
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function renderImageAlt(node: ASTNode) {
  const alt = node.attributes.alt?.trim()
  if (!alt) return null
  return (
    <Text key={node.key} selectable style={styles.imageAlt}>
      {alt}
    </Text>
  )
}

function renderNothing() {
  return null
}

function normalizeHttpUrl(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed.toString()
  } catch {
    return null
  }
}

function openSafeUrl(url: string) {
  void Linking.openURL(url).catch(() => undefined)
}

function readTable(node: ASTNode) {
  const thead = node.children.find((child) => child.type === "thead")
  const tbody = node.children.find((child) => child.type === "tbody")
  const headerRow = thead?.children.find((child) => child.type === "tr")
  const headers = readTableRow(headerRow)
  const bodyRows = (tbody?.children ?? [])
    .filter((child) => child.type === "tr")
    .map(readTableRow)
    .filter((row) => row.some((value) => value.trim()))

  return {
    headers,
    rows: bodyRows.length ? bodyRows : headers.length ? [headers] : [],
  }
}

function readTableRow(node: ASTNode | undefined) {
  return (node?.children ?? [])
    .filter((child) => child.type === "th" || child.type === "td")
    .map(readNodeText)
}

function readNodeText(node: ASTNode): string {
  const childrenText = node.children.map(readNodeText).filter(Boolean).join("")
  return childrenText || node.content || ""
}

function trimTrailingNewline(value: string) {
  return value.endsWith("\n") ? value.slice(0, -1) : value
}

const styles = StyleSheet.create({
  codeBlockContent: {
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  codeBlockScroll: {
    alignSelf: "stretch",
    backgroundColor: "#1d1d1d",
    borderColor: "#303030",
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 10,
    maxWidth: "100%",
  },
  codeBlockText: {
    color: "#d8d8d8",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 19,
  },
  imageAlt: {
    color: "#9d9d9d",
    fontSize: 13,
    fontStyle: "italic",
    lineHeight: 18,
  },
  tableRecord: {
    borderBottomColor: "#303030",
    borderBottomWidth: 1,
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  tableRecordCell: {
    gap: 3,
    minWidth: 0,
  },
  tableRecordHeader: {
    color: "#8f8f8f",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  tableRecordLast: {
    borderBottomWidth: 0,
  },
  tableRecordValue: {
    color: "#dedede",
    fontSize: 15,
    lineHeight: 21,
  },
  tableStack: {
    alignSelf: "stretch",
    backgroundColor: "#1d1d1d",
    borderColor: "#303030",
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
})
