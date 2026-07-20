import {
  BrowserLocatorPlanV3,
  type BrowserContractCommandMethod,
  type BrowserContractCommandParams,
  type BrowserContractCommandResult,
  type BrowserLocatorExpressionV3Type,
  type BrowserLocatorPlanV3Type,
  type BrowserPlaywrightSelectOptionInput,
  type BrowserPlaywrightTextMatcherV3Type,
} from "@anybox/chrome-shared/browser-contract"
import type {
  BrowserExtensionPlaywrightElementInfo,
} from "@anybox/chrome-shared/browser-extension"

export interface PlaywrightCommandRunner {
  run<TMethod extends BrowserContractCommandMethod>(
    method: TMethod,
    params: unknown,
    options?: { timeoutMs?: number },
  ): Promise<BrowserContractCommandResult<TMethod>>
}

type TextInput = string | RegExp
type TimeoutOptions = {
  timeout?: number
  timeoutMs?: number
}
type ReadOptions = TimeoutOptions
type LocatorClickOptions = TimeoutOptions & {
  button?: "left" | "right" | "middle"
  force?: boolean
  modifiers?: Array<
    "Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift"
  >
}
type LocatorFillOptions = TimeoutOptions & {
  sensitive?: boolean
}
type LocatorSetCheckedOptions = TimeoutOptions & {
  force?: boolean
}
type LocatorWaitForOptions = TimeoutOptions & {
  state?: "attached" | "detached" | "visible" | "hidden"
}
type LocatorFilterOptions = {
  has?: BrowserPlaywrightLocator
  hasNot?: BrowserPlaywrightLocator
  hasText?: TextInput
  hasNotText?: TextInput
  visible?: boolean
}
type RoleOptions = {
  name?: TextInput
  exact?: boolean
  includeHidden?: boolean
}
type TextOptions = {
  exact?: boolean
}
type NavigationOptions = TimeoutOptions & {
  url?: string | URL
  waitUntil?: "commit" | "domcontentloaded" | "load" | "networkidle"
}
type LoadStateOptions = TimeoutOptions & {
  state?: "domcontentloaded" | "load" | "networkidle"
}
type URLWaitOptions = TimeoutOptions & {
  waitUntil?: "commit" | "domcontentloaded" | "load" | "networkidle"
}

function timeoutMs(options: TimeoutOptions | undefined) {
  const value = options?.timeoutMs ?? options?.timeout
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value <= 0 || value > 60_000) {
    throw new TypeError("Locator timeout must be between 1 and 60000 ms.")
  }
  return Math.trunc(value)
}

function hostTimeout(options: TimeoutOptions | undefined) {
  const value = timeoutMs(options)
  return value === undefined ? {} : { timeoutMs: value + 5_000 }
}

function commandTimeout(options: TimeoutOptions | undefined) {
  const value = timeoutMs(options)
  return value === undefined ? {} : { timeoutMs: value }
}

function textMatcher(
  value: TextInput,
  exact = false,
): BrowserPlaywrightTextMatcherV3Type {
  if (value instanceof RegExp) {
    return {
      type: "regex",
      source: value.source,
      flags: value.flags,
    }
  }
  return { type: "string", value, ...(exact ? { exact: true } : {}) }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
  }
  return value
}

function immutablePlan(plan: BrowserLocatorPlanV3Type) {
  return deepFreeze(BrowserLocatorPlanV3.parse(plan))
}

function sameFrame(
  left: BrowserLocatorPlanV3Type,
  right: BrowserLocatorPlanV3Type,
) {
  return JSON.stringify(left.framePath) === JSON.stringify(right.framePath)
}

function locatorExpression(
  kind: "text" | "label" | "placeholder" | "testId",
  value: TextInput,
  options: TextOptions = {},
): BrowserLocatorExpressionV3Type {
  return {
    kind,
    matcher: textMatcher(
      value,
      kind === "testId" ? true : options.exact === true,
    ),
  }
}

function pageLocatorPlan(
  expression: BrowserLocatorExpressionV3Type,
  framePath: readonly string[] = [],
) {
  return immutablePlan({
    framePath: [...framePath],
    expression,
  })
}

export class BrowserPlaywrightLocator {
  readonly plan: BrowserLocatorPlanV3Type

  constructor(
    private readonly runner: PlaywrightCommandRunner,
    private readonly tabId: () => number,
    plan: BrowserLocatorPlanV3Type,
  ) {
    this.plan = immutablePlan(plan)
  }

  private next(expression: BrowserLocatorExpressionV3Type) {
    return new BrowserPlaywrightLocator(this.runner, this.tabId, {
      framePath: [...this.plan.framePath],
      expression,
    })
  }

  private assertComposable(other: BrowserPlaywrightLocator) {
    if (
      this.runner !== other.runner
      || this.tabId() !== other.tabId()
      || !sameFrame(this.plan, other.plan)
    ) {
      throw new TypeError(
        "Locator composition requires locators from the same tab and frame.",
      )
    }
  }

  locator(selectorOrLocator: string | BrowserPlaywrightLocator) {
    const right = typeof selectorOrLocator === "string"
      ? { kind: "selector" as const, value: selectorOrLocator }
      : (() => {
          this.assertComposable(selectorOrLocator)
          return selectorOrLocator.plan.expression
        })()
    return this.next({
      kind: "descendant",
      left: this.plan.expression,
      right,
    })
  }

  filter(options: LocatorFilterOptions = {}) {
    if (options.has) this.assertComposable(options.has)
    if (options.hasNot) this.assertComposable(options.hasNot)
    if (
      !options.has
      && !options.hasNot
      && options.hasText === undefined
      && options.hasNotText === undefined
      && options.visible === undefined
    ) {
      return this.next(this.plan.expression)
    }
    return this.next({
      kind: "filter",
      source: this.plan.expression,
      ...(options.has ? { has: options.has.plan.expression } : {}),
      ...(options.hasNot ? { hasNot: options.hasNot.plan.expression } : {}),
      ...(options.hasText !== undefined
        ? { hasText: textMatcher(options.hasText) }
        : {}),
      ...(options.hasNotText !== undefined
        ? { hasNotText: textMatcher(options.hasNotText) }
        : {}),
      ...(options.visible === undefined
        ? {}
        : { visible: options.visible }),
    })
  }

  and(other: BrowserPlaywrightLocator) {
    this.assertComposable(other)
    return this.next({
      kind: "and",
      left: this.plan.expression,
      right: other.plan.expression,
    })
  }

  or(other: BrowserPlaywrightLocator) {
    this.assertComposable(other)
    return this.next({
      kind: "or",
      left: this.plan.expression,
      right: other.plan.expression,
    })
  }

  first() {
    return this.nth(0)
  }

  last() {
    return this.nth(-1)
  }

  nth(index: number) {
    return this.next({
      kind: "nth",
      source: this.plan.expression,
      index,
    })
  }

  async all() {
    const count = await this.count()
    return Array.from({ length: count }, (_, index) => this.nth(index))
  }

  getByRole(role: string, options: RoleOptions = {}) {
    return this.next({
      kind: "descendant",
      left: this.plan.expression,
      right: {
        kind: "role",
        role,
        ...(options.name !== undefined
          ? { name: textMatcher(options.name, options.exact) }
          : {}),
        ...(options.includeHidden === undefined
          ? {}
          : { includeHidden: options.includeHidden }),
      },
    })
  }

  getByText(value: TextInput, options: TextOptions = {}) {
    return this.locatorFromExpression(locatorExpression(
      "text",
      value,
      options,
    ))
  }

  getByLabel(value: TextInput, options: TextOptions = {}) {
    return this.locatorFromExpression(locatorExpression(
      "label",
      value,
      options,
    ))
  }

  getByPlaceholder(value: TextInput, options: TextOptions = {}) {
    return this.locatorFromExpression(locatorExpression(
      "placeholder",
      value,
      options,
    ))
  }

  getByTestId(value: TextInput) {
    return this.locatorFromExpression(locatorExpression("testId", value))
  }

  private locatorFromExpression(expression: BrowserLocatorExpressionV3Type) {
    return this.next({
      kind: "descendant",
      left: this.plan.expression,
      right: expression,
    })
  }

  private params(options?: TimeoutOptions) {
    return {
      tabId: this.tabId(),
      plan: this.plan,
      ...commandTimeout(options),
    }
  }

  async count(options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.count",
      this.params(options),
      hostTimeout(options),
    )
    return result.count
  }

  async allTextContents(options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.allTextContents",
      this.params(options),
      hostTimeout(options),
    )
    return result.values
  }

  async textContent(options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.textContent",
      this.params(options),
      hostTimeout(options),
    )
    return result.value
  }

  async innerText(options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.innerText",
      this.params(options),
      hostTimeout(options),
    )
    return result.value
  }

  async inputValue(options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.inputValue",
      this.params(options),
      hostTimeout(options),
    )
    return result.value
  }

  async getAttribute(name: string, options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.getAttribute",
      { ...this.params(options), name },
      hostTimeout(options),
    )
    return result.value
  }

  async isVisible(options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.isVisible",
      this.params(options),
      hostTimeout(options),
    )
    return result.value
  }

  async isEnabled(options: ReadOptions = {}) {
    const result = await this.runner.run(
      "playwright.locator.isEnabled",
      this.params(options),
      hostTimeout(options),
    )
    return result.value
  }

  async click(options: LocatorClickOptions = {}) {
    await this.runner.run(
      "playwright.locator.click",
      {
        ...this.params(options),
        ...(options.button ? { button: options.button } : {}),
        ...(options.force === undefined ? {} : { force: options.force }),
        ...(options.modifiers ? { modifiers: options.modifiers } : {}),
      },
      hostTimeout(options),
    )
  }

  async dblclick(options: LocatorClickOptions = {}) {
    await this.runner.run(
      "playwright.locator.dblclick",
      {
        ...this.params(options),
        ...(options.button ? { button: options.button } : {}),
        ...(options.force === undefined ? {} : { force: options.force }),
        ...(options.modifiers ? { modifiers: options.modifiers } : {}),
      },
      hostTimeout(options),
    )
  }

  async fill(value: string, options: LocatorFillOptions = {}) {
    await this.runner.run(
      "playwright.locator.fill",
      {
        ...this.params(options),
        value,
        ...(options.sensitive === undefined
          ? {}
          : { sensitive: options.sensitive }),
      },
      hostTimeout(options),
    )
  }

  async type(value: string, options: LocatorFillOptions = {}) {
    await this.runner.run(
      "playwright.locator.type",
      {
        ...this.params(options),
        value,
        ...(options.sensitive === undefined
          ? {}
          : { sensitive: options.sensitive }),
      },
      hostTimeout(options),
    )
  }

  async press(value: string, options: TimeoutOptions = {}) {
    await this.runner.run(
      "playwright.locator.press",
      { ...this.params(options), value },
      hostTimeout(options),
    )
  }

  async selectOption(
    value:
      | BrowserPlaywrightSelectOptionInput
      | BrowserPlaywrightSelectOptionInput[],
    options: TimeoutOptions = {},
  ) {
    const values = Array.isArray(value) ? value : [value]
    const result = await this.runner.run(
      "playwright.locator.selectOption",
      { ...this.params(options), values },
      hostTimeout(options),
    )
    return result.values ?? []
  }

  async setChecked(
    checked: boolean,
    options: LocatorSetCheckedOptions = {},
  ) {
    await this.runner.run(
      "playwright.locator.setChecked",
      {
        ...this.params(options),
        checked,
        ...(options.force === undefined ? {} : { force: options.force }),
      },
      hostTimeout(options),
    )
  }

  async check(options: LocatorSetCheckedOptions = {}) {
    await this.setChecked(true, options)
  }

  async uncheck(options: LocatorSetCheckedOptions = {}) {
    await this.setChecked(false, options)
  }

  async waitFor(options: LocatorWaitForOptions = {}) {
    await this.runner.run(
      "playwright.locator.waitFor",
      {
        ...this.params(options),
        state: options.state ?? "visible",
      },
      hostTimeout(options),
    )
  }
}

export class BrowserPlaywrightFrameLocator {
  readonly framePath: readonly string[]

  constructor(
    private readonly runner: PlaywrightCommandRunner,
    private readonly tabId: () => number,
    framePath: readonly string[],
  ) {
    this.framePath = deepFreeze([...framePath])
  }

  frameLocator(selector: string) {
    return new BrowserPlaywrightFrameLocator(
      this.runner,
      this.tabId,
      [...this.framePath, selector],
    )
  }

  locator(selector: string) {
    return new BrowserPlaywrightLocator(
      this.runner,
      this.tabId,
      pageLocatorPlan(
        { kind: "selector", value: selector },
        this.framePath,
      ),
    )
  }

  getByRole(role: string, options: RoleOptions = {}) {
    return new BrowserPlaywrightLocator(
      this.runner,
      this.tabId,
      pageLocatorPlan({
        kind: "role",
        role,
        ...(options.name !== undefined
          ? { name: textMatcher(options.name, options.exact) }
          : {}),
        ...(options.includeHidden === undefined
          ? {}
          : { includeHidden: options.includeHidden }),
      }, this.framePath),
    )
  }

  getByText(value: TextInput, options: TextOptions = {}) {
    return this.fromExpression(locatorExpression("text", value, options))
  }

  getByLabel(value: TextInput, options: TextOptions = {}) {
    return this.fromExpression(locatorExpression("label", value, options))
  }

  getByPlaceholder(value: TextInput, options: TextOptions = {}) {
    return this.fromExpression(
      locatorExpression("placeholder", value, options),
    )
  }

  getByTestId(value: TextInput) {
    return this.fromExpression(locatorExpression("testId", value))
  }

  private fromExpression(expression: BrowserLocatorExpressionV3Type) {
    return new BrowserPlaywrightLocator(
      this.runner,
      this.tabId,
      pageLocatorPlan(expression, this.framePath),
    )
  }
}

export class BrowserPlaywrightDownload {
  constructor(
    private readonly runner: PlaywrightCommandRunner,
    private readonly tabId: () => number,
    readonly eventID: string,
  ) {}

  async path(options: TimeoutOptions = {}) {
    const result = await this.runner.run(
      "playwright.download.path",
      {
        tabId: this.tabId(),
        eventID: this.eventID,
        ...commandTimeout(options),
      },
      hostTimeout(options),
    )
    return result.path
  }
}

export class BrowserPlaywrightFileChooser {
  constructor(
    private readonly runner: PlaywrightCommandRunner,
    private readonly tabId: () => number,
    readonly eventID: string,
    readonly multiple: boolean,
  ) {}

  async setFiles(files: string | string[], options: TimeoutOptions = {}) {
    await this.runner.run(
      "playwright.fileChooser.setFiles",
      {
        tabId: this.tabId(),
        eventID: this.eventID,
        files: Array.isArray(files) ? files : [files],
        ...commandTimeout(options),
      },
      hostTimeout(options),
    )
  }
}

export class BrowserPlaywrightAPI {
  private documentGeneration: number | undefined

  constructor(
    private readonly runner: PlaywrightCommandRunner,
    private readonly tabId: () => number,
  ) {}

  locator(selector: string) {
    return new BrowserPlaywrightLocator(
      this.runner,
      this.tabId,
      pageLocatorPlan({ kind: "selector", value: selector }),
    )
  }

  frameLocator(selector: string) {
    return new BrowserPlaywrightFrameLocator(
      this.runner,
      this.tabId,
      [selector],
    )
  }

  getByRole(role: string, options: RoleOptions = {}) {
    return new BrowserPlaywrightLocator(
      this.runner,
      this.tabId,
      pageLocatorPlan({
        kind: "role",
        role,
        ...(options.name !== undefined
          ? { name: textMatcher(options.name, options.exact) }
          : {}),
        ...(options.includeHidden === undefined
          ? {}
          : { includeHidden: options.includeHidden }),
      }),
    )
  }

  getByText(value: TextInput, options: TextOptions = {}) {
    return this.fromExpression(locatorExpression("text", value, options))
  }

  getByLabel(value: TextInput, options: TextOptions = {}) {
    return this.fromExpression(locatorExpression("label", value, options))
  }

  getByPlaceholder(value: TextInput, options: TextOptions = {}) {
    return this.fromExpression(
      locatorExpression("placeholder", value, options),
    )
  }

  getByTestId(value: TextInput) {
    return this.fromExpression(locatorExpression("testId", value))
  }

  private fromExpression(expression: BrowserLocatorExpressionV3Type) {
    return new BrowserPlaywrightLocator(
      this.runner,
      this.tabId,
      pageLocatorPlan(expression),
    )
  }

  async domSnapshot(options: {
    maxNodes?: number
    maxChars?: number
  } = {}) {
    const result = await this.runner.run("playwright.domSnapshot", {
      tabId: this.tabId(),
      ...options,
    })
    this.documentGeneration = result.documentGeneration
    return result.snapshot
  }

  async elementInfo(options: {
    x: number
    y: number
    includeNonInteractable?: boolean
  }): Promise<BrowserExtensionPlaywrightElementInfo[]> {
    const result = await this.runner.run("playwright.elementInfo", {
      tabId: this.tabId(),
      ...options,
    })
    this.documentGeneration = result.documentGeneration
    return result.elements
  }

  async expectNavigation<TResult>(
    action: () => TResult | Promise<TResult>,
    options: NavigationOptions = {},
  ): Promise<TResult> {
    const registered = await this.runner.run(
      "playwright.waitForNavigation",
      {
        tabId: this.tabId(),
        mode: "register",
        ...(options.url
          ? { url: String(options.url) }
          : {}),
        ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
        ...commandTimeout(options),
      },
      hostTimeout(options),
    )
    if (!registered.waiterID) {
      throw new Error("The Browser Host did not register navigation waiting.")
    }
    let result: TResult
    try {
      result = await action()
    } catch (error) {
      await this.runner.run(
        "playwright.waitForNavigation",
        {
          tabId: this.tabId(),
          mode: "cancel",
          waiterID: registered.waiterID,
          timeoutMs: 1_000,
        },
        { timeoutMs: 2_000 },
      ).catch(() => undefined)
      throw error
    }
    const navigated = await this.runner.run(
      "playwright.waitForNavigation",
      {
        tabId: this.tabId(),
        mode: "wait",
        waiterID: registered.waiterID,
        ...commandTimeout(options),
      },
      hostTimeout(options),
    )
    this.documentGeneration = navigated.documentGeneration
    return result
  }

  async waitForURL(
    url: string | URL,
    options: URLWaitOptions = {},
  ) {
    const result = await this.runner.run(
      "playwright.waitForURL",
      {
        tabId: this.tabId(),
        url: String(url),
        ...(options.waitUntil ? { waitUntil: options.waitUntil } : {}),
        ...commandTimeout(options),
      },
      hostTimeout(options),
    )
    this.documentGeneration = result.documentGeneration
  }

  async waitForLoadState(options: LoadStateOptions = {}) {
    const result = await this.runner.run(
      "playwright.waitForLoadState",
      {
        tabId: this.tabId(),
        ...(options.state ? { state: options.state } : {}),
        ...commandTimeout(options),
      },
      hostTimeout(options),
    )
    this.documentGeneration = result.documentGeneration
  }

  async waitForTimeout(delayMs: number) {
    if (
      !Number.isFinite(delayMs)
      || delayMs < 0
      || delayMs > 60_000
    ) {
      throw new TypeError("waitForTimeout requires 0 to 60000 ms.")
    }
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.trunc(delayMs))
    )
  }

  async waitForEvent(
    event: "download",
    options?: TimeoutOptions,
  ): Promise<BrowserPlaywrightDownload>
  async waitForEvent(
    event: "filechooser",
    options?: TimeoutOptions,
  ): Promise<BrowserPlaywrightFileChooser>
  async waitForEvent(
    event: "download" | "filechooser",
    options: TimeoutOptions = {},
  ) {
    const result = await this.runner.run(
      "playwright.waitForEvent",
      {
        tabId: this.tabId(),
        event,
        ...commandTimeout(options),
      },
      hostTimeout(options),
    )
    this.documentGeneration = result.documentGeneration
    return event === "download"
      ? new BrowserPlaywrightDownload(
          this.runner,
          this.tabId,
          result.eventID,
        )
      : new BrowserPlaywrightFileChooser(
          this.runner,
          this.tabId,
          result.eventID,
          result.multiple === true,
        )
  }
}
