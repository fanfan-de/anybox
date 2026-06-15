import { type ReactNode } from "react"

type CodeTokenKind =
  | "attr"
  | "comment"
  | "constant"
  | "function"
  | "keyword"
  | "number"
  | "operator"
  | "plain"
  | "property"
  | "punctuation"
  | "string"
  | "tag"
  | "variable"

interface CodeToken {
  kind: CodeTokenKind
  text: string
}

export interface CodeLanguageInput {
  extension?: string | null
  mime?: string | null
  path?: string | null
  renderer?: string | null
}

interface HighlightedCodeLineProps {
  language?: string | null
  line: string
}

interface CodeBlockPreviewProps {
  className?: string
  content: string
  language?: string | null
}

const EXTENSION_LANGUAGES = new Map([
  ["bash", "shell"],
  ["bat", "batch"],
  ["c", "c"],
  ["cc", "cpp"],
  ["cjs", "javascript"],
  ["cmd", "batch"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["css", "css"],
  ["go", "go"],
  ["h", "c"],
  ["hpp", "cpp"],
  ["htm", "html"],
  ["html", "html"],
  ["java", "java"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsx", "javascript"],
  ["log", "log"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["mjs", "javascript"],
  ["ps1", "powershell"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["scss", "css"],
  ["sh", "shell"],
  ["sql", "sql"],
  ["svg", "html"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["txt", "text"],
  ["xml", "html"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
])

const FILE_NAME_LANGUAGES = new Map([
  ["dockerfile", "dockerfile"],
  ["makefile", "makefile"],
  ["package.json", "json"],
  ["pnpm-lock.yaml", "yaml"],
  ["tsconfig.json", "json"],
])

const KEYWORDS = new Map<string, Set<string>>([
  ["batch", words("call cd cls copy del do echo else errorlevel exist exit for goto if in move not pause rem set shift start title")],
  ["c", words("auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while")],
  ["cpp", words("alignas alignof asm auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register reinterpret_cast return short signed sizeof static_cast struct switch template this throw true try typedef typename union unsigned using virtual void volatile while")],
  ["csharp", words("abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while")],
  ["css", words("align-items animation background border box-shadow color content cursor display flex font gap grid height inset justify-content left margin max-width min-height opacity overflow padding pointer-events position right top transform transition width z-index")],
  ["dockerfile", words("add arg cmd copy entrypoint env expose from healthcheck label maintainer onbuild run shell stopsignal user volume workdir")],
  ["go", words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var")],
  ["html", words("doctype html head body script style meta title link div span section article header footer main nav button input label form img video svg canvas")],
  ["java", words("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while")],
  ["javascript", words("async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while yield")],
  ["json", words("false null true")],
  ["makefile", words("define else endef endif export ifdef ifeq ifndef ifneq include override private undefine unexport vpath")],
  ["markdown", words("todo fixme note warning")],
  ["powershell", words("begin break catch class continue data do dynamicparam else elseif end exit filter finally for foreach from function if in param process return switch throw trap try until using var while workflow")],
  ["python", words("and as assert async await break class continue def del elif else except false finally for from global if import in is lambda none nonlocal not or pass raise return true try while with yield")],
  ["ruby", words("alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield")],
  ["rust", words("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while")],
  ["shell", words("case cd do done elif else esac export fi for function if in local readonly return set shift then unset until while")],
  ["sql", words("alter and as asc by case create delete desc distinct drop else end from group having in insert into is join left like limit not null on or order outer primary right select set table then update values when where")],
  ["typescript", words("abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of private protected public readonly return satisfies set static string super switch symbol this throw true try type typeof undefined unknown var void while yield")],
  ["yaml", words("false no null off on true yes")],
])

const CONSTANTS = words("false true null undefined none nil nan infinity")

function words(value: string) {
  return new Set(value.split(/\s+/).filter(Boolean))
}

function getPathFileName(value: string | null | undefined) {
  const cleanPath = value?.split(/[?#]/)[0]?.trim() ?? ""
  return cleanPath.split(/[\\/]/).filter(Boolean).pop()?.toLowerCase() ?? ""
}

function getPathExtension(value: string | null | undefined) {
  const fileName = getPathFileName(value)
  const dotIndex = fileName.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return null
  return fileName.slice(dotIndex + 1)
}

function normalizeExtension(value: string | null | undefined) {
  return value?.trim().replace(/^\./, "").toLowerCase() || null
}

export function inferCodeLanguage(input: CodeLanguageInput) {
  const fileName = getPathFileName(input.path)
  const namedLanguage = FILE_NAME_LANGUAGES.get(fileName)
  if (namedLanguage) return namedLanguage

  const extension = normalizeExtension(input.extension) ?? getPathExtension(input.path)
  const extensionLanguage = extension ? EXTENSION_LANGUAGES.get(extension) : null
  if (extensionLanguage) return extensionLanguage

  const mime = input.mime?.toLowerCase() ?? ""
  if (mime.includes("json")) return "json"
  if (mime.includes("javascript")) return "javascript"
  if (mime.includes("typescript")) return "typescript"
  if (mime.includes("html") || mime.includes("xml") || mime.includes("svg")) return "html"
  if (mime.includes("css")) return "css"
  if (mime.includes("markdown")) return "markdown"
  if (mime.includes("csv")) return "csv"
  if (input.renderer === "json-viewer") return "json"
  if (input.renderer === "table-preview") return "csv"
  return "text"
}

function isIdentifierStart(character: string) {
  return /[A-Za-z_$]/.test(character)
}

function isIdentifierPart(character: string) {
  return /[\w$-]/.test(character)
}

function isWhitespace(character: string) {
  return /\s/.test(character)
}

function getNextNonWhitespaceIndex(line: string, startIndex: number) {
  let index = startIndex
  while (index < line.length && isWhitespace(line[index])) index += 1
  return index
}

function getPreviousNonWhitespaceCharacter(line: string, startIndex: number) {
  let index = startIndex
  while (index >= 0 && isWhitespace(line[index])) index -= 1
  return index >= 0 ? line[index] : ""
}

function readWhile(line: string, startIndex: number, predicate: (character: string) => boolean) {
  let index = startIndex
  while (index < line.length && predicate(line[index])) index += 1
  return index
}

function readQuotedString(line: string, startIndex: number) {
  const quote = line[startIndex]
  let index = startIndex + 1

  while (index < line.length) {
    if (line[index] === "\\") {
      index += 2
      continue
    }
    if (line[index] === quote) return index + 1
    index += 1
  }

  return line.length
}

function classifyWord(word: string, line: string, startIndex: number, endIndex: number, language: string): CodeTokenKind {
  const normalizedWord = word.toLowerCase()
  const keywordSet = KEYWORDS.get(language)
  const nextIndex = getNextNonWhitespaceIndex(line, endIndex)
  const previousCharacter = getPreviousNonWhitespaceCharacter(line, startIndex - 1)

  if (keywordSet?.has(normalizedWord)) return CONSTANTS.has(normalizedWord) ? "constant" : "keyword"
  if (CONSTANTS.has(normalizedWord)) return "constant"
  if (previousCharacter === ".") return "property"
  if (nextIndex < line.length && line[nextIndex] === "(") return "function"
  if ((language === "css" || language === "yaml" || language === "json") && line[nextIndex] === ":") return "property"
  if (/^[A-Z][A-Z0-9_]*$/.test(word)) return "constant"
  return "plain"
}

function getLineCommentMarker(language: string) {
  if (language === "python" || language === "shell" || language === "powershell" || language === "ruby" || language === "yaml") return "#"
  if (language === "sql") return "--"
  if (language === "batch") return "rem"
  return "//"
}

function isLineCommentStart(line: string, index: number, language: string) {
  const marker = getLineCommentMarker(language)
  if (marker === "rem") {
    return line.slice(index, index + 3).toLowerCase() === "rem" && (index === 0 || isWhitespace(line[index - 1]))
  }
  if (!line.startsWith(marker, index)) return false
  if (marker === "//" && line[index - 1] === ":") return false
  if (marker === "#" && index > 0 && !isWhitespace(line[index - 1])) return false
  return true
}

function tokenizeMarkupLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = []
  let index = 0

  while (index < line.length) {
    if (line.startsWith("<!--", index)) {
      const endIndex = line.indexOf("-->", index + 4)
      const nextIndex = endIndex >= 0 ? endIndex + 3 : line.length
      tokens.push({ kind: "comment", text: line.slice(index, nextIndex) })
      index = nextIndex
      continue
    }

    if (line[index] !== "<") {
      const nextIndex = line.indexOf("<", index)
      tokens.push({ kind: "plain", text: line.slice(index, nextIndex >= 0 ? nextIndex : line.length) })
      index = nextIndex >= 0 ? nextIndex : line.length
      continue
    }

    tokens.push({ kind: "punctuation", text: "<" })
    index += 1
    if (line[index] === "/" || line[index] === "!") {
      tokens.push({ kind: "punctuation", text: line[index] })
      index += 1
    }

    const tagEndIndex = readWhile(line, index, (character) => /[\w:-]/.test(character))
    if (tagEndIndex > index) {
      tokens.push({ kind: "tag", text: line.slice(index, tagEndIndex) })
      index = tagEndIndex
    }

    while (index < line.length && line[index] !== ">") {
      const character = line[index]
      if (isWhitespace(character)) {
        const nextIndex = readWhile(line, index, isWhitespace)
        tokens.push({ kind: "plain", text: line.slice(index, nextIndex) })
        index = nextIndex
        continue
      }
      if (character === "\"" || character === "'") {
        const nextIndex = readQuotedString(line, index)
        tokens.push({ kind: "string", text: line.slice(index, nextIndex) })
        index = nextIndex
        continue
      }
      if (/[=\-/]/.test(character)) {
        tokens.push({ kind: "operator", text: character })
        index += 1
        continue
      }
      if (/[\w:-]/.test(character)) {
        const nextIndex = readWhile(line, index, (value) => /[\w:-]/.test(value))
        tokens.push({ kind: "attr", text: line.slice(index, nextIndex) })
        index = nextIndex
        continue
      }
      tokens.push({ kind: "punctuation", text: character })
      index += 1
    }

    if (line[index] === ">") {
      tokens.push({ kind: "punctuation", text: ">" })
      index += 1
    }
  }

  return tokens
}

function tokenizeMarkdownLine(line: string): CodeToken[] {
  const headingMatch = line.match(/^(\s{0,3}#{1,6})(\s.*)?$/)
  if (headingMatch) {
    return [
      { kind: "keyword", text: headingMatch[1] },
      { kind: "plain", text: headingMatch[2] ?? "" },
    ]
  }

  const listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+)/)
  if (listMatch) {
    return [
      { kind: "plain", text: listMatch[1] },
      { kind: "keyword", text: listMatch[2] },
      { kind: "plain", text: listMatch[3] },
      ...tokenizeGenericLine(line.slice(listMatch[0].length), "markdown"),
    ]
  }

  return tokenizeGenericLine(line, "markdown")
}

function tokenizeGenericLine(line: string, language: string): CodeToken[] {
  const tokens: CodeToken[] = []
  let index = 0

  while (index < line.length) {
    const character = line[index]

    if (isWhitespace(character)) {
      const nextIndex = readWhile(line, index, isWhitespace)
      tokens.push({ kind: "plain", text: line.slice(index, nextIndex) })
      index = nextIndex
      continue
    }

    if (line.startsWith("/*", index)) {
      const endIndex = line.indexOf("*/", index + 2)
      const nextIndex = endIndex >= 0 ? endIndex + 2 : line.length
      tokens.push({ kind: "comment", text: line.slice(index, nextIndex) })
      index = nextIndex
      continue
    }

    if (isLineCommentStart(line, index, language)) {
      tokens.push({ kind: "comment", text: line.slice(index) })
      break
    }

    if (character === "\"" || character === "'" || character === "`") {
      const nextIndex = readQuotedString(line, index)
      const nextNonWhitespaceIndex = getNextNonWhitespaceIndex(line, nextIndex)
      tokens.push({
        kind: nextNonWhitespaceIndex < line.length && line[nextNonWhitespaceIndex] === ":" ? "property" : "string",
        text: line.slice(index, nextIndex),
      })
      index = nextIndex
      continue
    }

    if (character === "#" && /^#[0-9A-Fa-f]{3,8}\b/.test(line.slice(index))) {
      const nextIndex = readWhile(line, index + 1, (value) => /[0-9A-Fa-f]/.test(value))
      tokens.push({ kind: "number", text: line.slice(index, nextIndex) })
      index = nextIndex
      continue
    }

    if (/\d/.test(character)) {
      const nextIndex = readWhile(line, index, (value) => /[\w.%]/.test(value))
      tokens.push({ kind: "number", text: line.slice(index, nextIndex) })
      index = nextIndex
      continue
    }

    if ((language === "css" || language === "yaml") && line.startsWith("--", index)) {
      const nextIndex = readWhile(line, index, (value) => /[\w-]/.test(value))
      tokens.push({ kind: "variable", text: line.slice(index, nextIndex) })
      index = nextIndex
      continue
    }

    if (isIdentifierStart(character)) {
      const nextIndex = readWhile(line, index, isIdentifierPart)
      const text = line.slice(index, nextIndex)
      tokens.push({ kind: classifyWord(text, line, index, nextIndex, language), text })
      index = nextIndex
      continue
    }

    if (/[+\-*/%=!<>|&?:~^]/.test(character)) {
      const nextIndex = readWhile(line, index, (value) => /[+\-*/%=!<>|&?:~^]/.test(value))
      tokens.push({ kind: "operator", text: line.slice(index, nextIndex) })
      index = nextIndex
      continue
    }

    if (/[\[\]{}().,;]/.test(character)) {
      tokens.push({ kind: "punctuation", text: character })
      index += 1
      continue
    }

    tokens.push({ kind: "plain", text: character })
    index += 1
  }

  return tokens
}

function tokenizeCodeLine(line: string, rawLanguage: string | null | undefined) {
  const language = rawLanguage?.toLowerCase() || "text"
  if (language === "html" || language === "xml") return tokenizeMarkupLine(line)
  if (language === "markdown") return tokenizeMarkdownLine(line)
  return tokenizeGenericLine(line, language)
}

function renderCodeTokens(tokens: CodeToken[]) {
  return tokens.map((token, index) => {
    if (token.kind === "plain") return token.text
    return (
      <span key={`${index}:${token.kind}:${token.text}`} className={`code-highlight-token is-${token.kind}`}>
        {token.text}
      </span>
    )
  })
}

export function HighlightedCodeLine({ language, line }: HighlightedCodeLineProps) {
  if (line.length === 0) return " "
  return (
    <>
      <span className="code-highlight-raw-line" aria-hidden="true">
        {line}
      </span>
      {renderCodeTokens(tokenizeCodeLine(line, language))}
    </>
  )
}

export function CodeBlockPreview({ className, content, language }: CodeBlockPreviewProps) {
  const lines = content.split(/\r?\n/)
  const normalizedLanguage = language || "text"
  const classes = ["code-highlight", "code-highlight-block", className].filter(Boolean).join(" ")

  return (
    <pre className={classes} data-language={normalizedLanguage}>
      <code>
        {lines.map((line, index): ReactNode => {
          const lineNumber = index + 1
          return (
            <span key={`${lineNumber}:${line}`} className="code-highlight-row">
              <span className="code-highlight-line-number" aria-hidden="true">
                {String(lineNumber)}
              </span>
              <span className="code-highlight-line-text">
                <HighlightedCodeLine line={line} language={normalizedLanguage} />
              </span>
            </span>
          )
        })}
      </code>
    </pre>
  )
}
