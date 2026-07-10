import type { ContentfulStatusCode } from "hono/utils/http-status"

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}
