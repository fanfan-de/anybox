import z from "zod"
import * as database from "#database/Sqlite.ts"
import { getEnvValue, type EnvRecord } from "#env/compat.ts"

export const ComputerUseAppDecision = z.object({
  appID: z.string().min(1).max(512),
  displayName: z.string().min(1).max(256),
  decision: z.literal("allow"),
  source: z.enum(["user", "managed"]),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})
export type ComputerUseAppDecision = z.infer<typeof ComputerUseAppDecision>

let generation = -1

export interface ComputerUseAdminPolicyResult {
  denied: boolean
  reason?: string
}

export function evaluateComputerUseAdminPolicy(
  appID: string,
  env: EnvRecord = process.env,
): ComputerUseAdminPolicyResult {
  const disabled = getEnvValue(env, "ANYBOX_COMPUTER_USE_DISABLED")
    ?.trim()
    .toLowerCase()
  if (disabled && ["1", "true", "yes", "on"].includes(disabled)) {
    return {
      denied: true,
      reason: "Computer Use is disabled by administrator policy.",
    }
  }

  const blocked = new Set(
    (getEnvValue(env, "ANYBOX_COMPUTER_USE_DENY_APP_IDS") ?? "")
      .split(/[,;\r\n]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
  if (blocked.has("*") || blocked.has(appID.trim().toLowerCase())) {
    return {
      denied: true,
      reason: "This application is blocked by administrator policy.",
    }
  }
  return { denied: false }
}

function ensureTable() {
  const current = database.getDatabaseGeneration()
  if (current === generation && current > 0) return
  database.db.run(`
    CREATE TABLE IF NOT EXISTS "computer_use_app_decisions" (
      "appID" TEXT PRIMARY KEY,
      "displayName" TEXT NOT NULL,
      "decision" TEXT NOT NULL,
      "source" TEXT NOT NULL,
      "createdAt" INTEGER NOT NULL,
      "updatedAt" INTEGER NOT NULL
    );
  `)
  generation = database.getDatabaseGeneration()
}

export function listComputerUseAppDecisions() {
  ensureTable()
  return database.db.prepare(`
    SELECT "appID", "displayName", "decision", "source", "createdAt", "updatedAt"
    FROM "computer_use_app_decisions"
    ORDER BY "displayName" COLLATE NOCASE ASC, "appID" ASC
  `).all().map((row) => ComputerUseAppDecision.parse(row))
}

export function getComputerUseAppDecision(appID: string) {
  ensureTable()
  const row = database.db.prepare(`
    SELECT "appID", "displayName", "decision", "source", "createdAt", "updatedAt"
    FROM "computer_use_app_decisions"
    WHERE "appID" = ?
  `).get(appID)
  return row ? ComputerUseAppDecision.parse(row) : undefined
}

export function allowComputerUseApp(input: {
  appID: string
  displayName: string
  source?: "user" | "managed"
}) {
  ensureTable()
  const now = Date.now()
  const existing = getComputerUseAppDecision(input.appID)
  const decision = ComputerUseAppDecision.parse({
    appID: input.appID,
    displayName: input.displayName,
    decision: "allow",
    source: input.source ?? "user",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  database.db.prepare(`
    INSERT INTO "computer_use_app_decisions"
      ("appID", "displayName", "decision", "source", "createdAt", "updatedAt")
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT("appID") DO UPDATE SET
      "displayName" = excluded."displayName",
      "decision" = excluded."decision",
      "source" = excluded."source",
      "updatedAt" = excluded."updatedAt"
  `).run(
    decision.appID,
    decision.displayName,
    decision.decision,
    decision.source,
    decision.createdAt,
    decision.updatedAt,
  )
  return decision
}

export function revokeComputerUseApp(appID: string) {
  ensureTable()
  return database.db.prepare(`
    DELETE FROM "computer_use_app_decisions" WHERE "appID" = ?
  `).run(appID).changes > 0
}
