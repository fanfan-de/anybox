import type {
  BrowserLocatorExpressionV3Type,
  BrowserLocatorPlanV3Type,
  BrowserPlaywrightTextMatcherV3Type,
} from "@anybox/chrome-shared/browser-contract"

function regexLiteral(source: string, flags: string) {
  // The Contract validates both fields before compilation. Let the platform
  // produce the canonical literal so escapes such as \d, literal slashes, and
  // line terminators retain their RegExp meaning inside Playwright's selector.
  const regex = new RegExp(source, flags)
  const literal = regex.toString()
  // Match Playwright's selector escaping: non-Unicode regexes may safely
  // escape quotes and the selector-chain separator. In Unicode modes those
  // identity escapes are invalid, and Playwright consumes the literal as-is.
  if (regex.unicode || regex.flags.includes("v")) return literal
  return literal
    .replace(/(^|[^\\])(\\\\)*(["'`])/g, "$1$2\\$3")
    .replace(/>>/g, "\\>\\>")
}

function textMatcher(
  matcher: BrowserPlaywrightTextMatcherV3Type,
  mode: "text" | "attribute",
) {
  if (matcher.type === "regex") {
    return regexLiteral(matcher.source, matcher.flags)
  }
  if (mode === "text") {
    return `${JSON.stringify(matcher.value)}${matcher.exact ? "s" : "i"}`
  }
  const value = matcher.value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
  return `"${value}"${matcher.exact ? "s" : "i"}`
}

export function compileLocatorExpressionV3(
  expression: BrowserLocatorExpressionV3Type,
): string {
  if (expression.kind === "selector") return expression.value
  if (expression.kind === "role") {
    const name = expression.name
      ? `[name=${textMatcher(expression.name, "attribute")}]`
      : ""
    const includeHidden = expression.includeHidden === undefined
      ? ""
      : `[include-hidden=${String(expression.includeHidden)}]`
    return `internal:role=${expression.role}${name}${includeHidden}`
  }
  if (expression.kind === "text") {
    return `internal:text=${textMatcher(expression.matcher, "text")}`
  }
  if (expression.kind === "label") {
    return `internal:label=${textMatcher(expression.matcher, "text")}`
  }
  if (expression.kind === "placeholder") {
    return `internal:attr=[placeholder=${
      textMatcher(expression.matcher, "attribute")
    }]`
  }
  if (expression.kind === "testId") {
    return `internal:testid=[data-testid=${
      textMatcher(expression.matcher, "attribute")
    }]`
  }
  if (expression.kind === "accessibleName") {
    return `anybox-accessible-name=${
      encodeURIComponent(JSON.stringify(expression.matcher))
    }`
  }
  if (expression.kind === "descendant") {
    const left = compileLocatorExpressionV3(expression.left)
    const right = compileLocatorExpressionV3(expression.right)
    return `${left} >> internal:chain=${JSON.stringify(right)}`
  }
  if (expression.kind === "and" || expression.kind === "or") {
    const left = compileLocatorExpressionV3(expression.left)
    const right = compileLocatorExpressionV3(expression.right)
    return `${left} >> internal:${expression.kind}=${JSON.stringify(right)}`
  }
  if (expression.kind === "nth") {
    return `${compileLocatorExpressionV3(expression.source)} >> nth=${
      expression.index
    }`
  }
  if (expression.kind !== "filter") {
    throw new Error(`Unsupported Locator expression '${expression.kind}'.`)
  }

  let selector = compileLocatorExpressionV3(expression.source)
  if (expression.hasText) {
    selector += ` >> internal:has-text=${
      textMatcher(expression.hasText, "text")
    }`
  }
  if (expression.hasNotText) {
    selector += ` >> internal:has-not-text=${
      textMatcher(expression.hasNotText, "text")
    }`
  }
  if (expression.has) {
    selector += ` >> internal:has=${
      JSON.stringify(compileLocatorExpressionV3(expression.has))
    }`
  }
  if (expression.hasNot) {
    selector += ` >> internal:has-not=${
      JSON.stringify(compileLocatorExpressionV3(expression.hasNot))
    }`
  }
  if (expression.visible !== undefined) {
    selector += ` >> visible=${String(expression.visible)}`
  }
  return selector
}

export function compileLocatorPlanV3(plan: BrowserLocatorPlanV3Type) {
  return {
    framePath: [...plan.framePath],
    selector: compileLocatorExpressionV3(plan.expression),
  }
}
