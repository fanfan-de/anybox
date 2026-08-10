export class InitError extends Error {
  static isInstance(value: unknown): value is InitError {
    return value instanceof InitError
  }

  readonly data: { providerID: string }

  constructor(data: { providerID: string }, options?: ErrorOptions) {
    super(`Provider '${data.providerID}' is not configured.`, options)
    this.name = "ProviderInitError"
    this.data = data
  }
}
