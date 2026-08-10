import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { z } from "zod"
import { ApiError } from "#server/error.ts"
import type { AppEnv } from "#server/types.ts"

export async function parseJsonBody<Schema extends z.ZodType>(
  c: Context<AppEnv>,
  schema: Schema,
  message: string,
  fallback?: unknown,
): Promise<z.infer<Schema>> {
  const payload = schema.safeParse(await c.req.json().catch(() => fallback))
  if (!payload.success) throw new ApiError(400, "INVALID_PAYLOAD", message)
  return payload.data
}

export function parseQuery<Schema extends z.ZodType>(
  input: unknown,
  schema: Schema,
  code: string,
  message: string,
): z.infer<Schema> {
  const payload = schema.safeParse(input)
  if (!payload.success) throw new ApiError(400, code, message)
  return payload.data
}

export function ok(c: Context<AppEnv>, data: unknown, status?: ContentfulStatusCode) {
  const body = { success: true, data, requestId: c.get("requestId") }
  return status ? c.json(body, status) : c.json(body)
}
