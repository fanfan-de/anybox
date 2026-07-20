export class ComputerUseBrokerError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly requiresFreshState: boolean
  readonly effectMayHaveOccurred: boolean

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean
      requiresFreshState?: boolean
      effectMayHaveOccurred?: boolean
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "ComputerUseBrokerError"
    this.code = code
    this.retryable = options.retryable ?? ["CU_BUSY", "CU_TIMEOUT"].includes(code)
    this.requiresFreshState = options.requiresFreshState ?? false
    this.effectMayHaveOccurred = options.effectMayHaveOccurred ?? false
  }
}

export function computerUseError(
  code: string,
  message: string,
  options?: ConstructorParameters<typeof ComputerUseBrokerError>[2],
) {
  return new ComputerUseBrokerError(code, message, options)
}
