import {
  CinemaRenderJobEventsResultSchema,
  CinemaRenderJobListResultSchema,
  CinemaRenderJobSchema,
  CinemaRenderPreflightResultSchema,
  CinemaRenderRuntimeStatusSchema,
  CinemaRenderSettingsSchema,
  CreateCinemaRenderJobBodySchema,
  RetryCinemaRenderJobBodySchema,
  type CinemaRenderJob,
  type CinemaRenderJobEventsResult,
  type CinemaRenderJobListResult,
  type CinemaRenderPreflightResult,
  type CinemaRenderRuntimeStatus,
  type CinemaRenderSettings,
  type CreateCinemaRenderJobBody,
} from "@anybox/cinema-plugin/contracts/render"
import { CinemaTimelineListResultSchema } from "@anybox/cinema-plugin/contracts/timeline"
import {
  parseCinemaRenderRetentionRequest,
  parseCinemaRenderRetentionResult,
  type CinemaRenderRetentionRequest,
  type CinemaRenderRetentionResult,
} from "../model/renderRetention"
import { resolveCinemaRuntimeURL } from "../../../runtimeUrl"
import { cinemaRuntimeFetch } from "../../../runtimeFetch"

type ApiEnvelope = {
  success?: boolean
  data?: unknown
  error?: {
    code?: string
    message?: string
    data?: unknown
  }
}

export type CinemaToolchainStatus = {
  platform: string
  architecture: string
  runtimeID: string
  status: "ready" | "not_installed"
  download: { sizeBytes: number }
}

export class CinemaRenderApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly data?: unknown
  readonly latestRevision?: number

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message)
    this.name = "CinemaRenderApiError"
    this.status = status
    this.code = code
    this.data = data
    this.latestRevision = data && typeof data === "object" && "latestRevision" in data && typeof data.latestRevision === "number"
      ? data.latestRevision
      : undefined
  }
}

async function requestData(
  agentBaseURL: string,
  pathname: string,
  init?: RequestInit,
  signal?: AbortSignal,
) {
  const response = await cinemaRuntimeFetch(new URL(resolveCinemaRuntimeURL(agentBaseURL, pathname)), { ...init, signal: init?.signal ?? signal })
  const body = await response.json().catch(() => ({})) as ApiEnvelope
  if (!response.ok || body.success === false) {
    throw new CinemaRenderApiError(
      body.error?.message ?? `Render request failed (${response.status})`,
      response.status,
      body.error?.code,
      body.error?.data,
    )
  }
  return body.data
}

function timelinePrefix(projectID: string) {
  return `/api/cinema/projects/${encodeURIComponent(projectID)}/timelines`
}

function renderJobPrefix(projectID: string, jobID: string) {
  return `/api/cinema/projects/${encodeURIComponent(projectID)}/render-jobs/${encodeURIComponent(jobID)}`
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }
}

export function createRenderApi(agentBaseURL: string, projectID: string) {
  const timelinesPath = timelinePrefix(projectID)
  const retentionPath = `/api/cinema/projects/${encodeURIComponent(projectID)}/render-retention/cleanup`

  return {
    listTimelines: async (signal?: AbortSignal) => {
      const result = await requestData(agentBaseURL, timelinesPath, { signal })
      return CinemaTimelineListResultSchema.parse(result)
    },

    getRuntime: async (signal?: AbortSignal): Promise<CinemaRenderRuntimeStatus> => (
      CinemaRenderRuntimeStatusSchema.parse(await requestData(agentBaseURL, "/api/cinema/render-runtime", { signal }))
    ),

    getToolchain: async (signal?: AbortSignal) => (
      await requestData(agentBaseURL, "/api/cinema/toolchain/status", { signal }) as CinemaToolchainStatus
    ),

    installToolchain: async () => (
      await requestData(agentBaseURL, "/api/cinema/toolchain/install", { method: "POST" }) as CinemaToolchainStatus
    ),

    importToolchain: async () => (
      await requestData(agentBaseURL, "/api/cinema/toolchain/import", { method: "POST" }) as {
        cancelled: boolean
        toolchain?: CinemaToolchainStatus
      }
    ),

    cancelToolchainInstall: async () => (
      await requestData(agentBaseURL, "/api/cinema/toolchain/cancel", { method: "POST" }) as { canceled: boolean }
    ),

    runRetentionCleanup: async (
      request: CinemaRenderRetentionRequest,
      signal?: AbortSignal,
    ): Promise<CinemaRenderRetentionResult> => {
      const body = parseCinemaRenderRetentionRequest(request)
      const result = parseCinemaRenderRetentionResult(await requestData(
        agentBaseURL,
        retentionPath,
        { ...jsonRequest("POST", body), signal },
      ))
      if (
        result.operationID !== body.operationID
        || result.retentionDurationMs !== body.retentionDurationMs
        || result.dryRun !== body.dryRun
      ) {
        throw new TypeError("Render retention response does not match the submitted operation")
      }
      return result
    },

    preflight: async (
      timelineID: string,
      settings: CinemaRenderSettings,
      signal?: AbortSignal,
    ): Promise<CinemaRenderPreflightResult> => {
      const parsedSettings = CinemaRenderSettingsSchema.parse(settings)
      const query = new URLSearchParams({ settings: JSON.stringify(parsedSettings) })
      return CinemaRenderPreflightResultSchema.parse(await requestData(
        agentBaseURL,
        `${timelinesPath}/${encodeURIComponent(timelineID)}/delivery-preflight?${query.toString()}`,
        { signal },
      ))
    },

    listJobs: async (timelineID: string, signal?: AbortSignal): Promise<CinemaRenderJobListResult> => (
      CinemaRenderJobListResultSchema.parse(await requestData(
        agentBaseURL,
        `${timelinesPath}/${encodeURIComponent(timelineID)}/render-jobs`,
        { signal },
      ))
    ),

    getJob: async (jobID: string, signal?: AbortSignal): Promise<CinemaRenderJob> => (
      CinemaRenderJobSchema.parse(await requestData(agentBaseURL, renderJobPrefix(projectID, jobID), { signal }))
    ),

    getEvents: async (jobID: string, signal?: AbortSignal): Promise<CinemaRenderJobEventsResult> => (
      CinemaRenderJobEventsResultSchema.parse(await requestData(
        agentBaseURL,
        `${renderJobPrefix(projectID, jobID)}/events`,
        { signal },
      ))
    ),

    createJob: async (
      timelineID: string,
      body: CreateCinemaRenderJobBody,
      signal?: AbortSignal,
    ): Promise<CinemaRenderJob> => {
      const parsedBody = CreateCinemaRenderJobBodySchema.parse(body)
      return CinemaRenderJobSchema.parse(await requestData(
        agentBaseURL,
        `${timelinesPath}/${encodeURIComponent(timelineID)}/render-jobs`,
        { ...jsonRequest("POST", parsedBody), signal },
      ))
    },

    cancelJob: async (jobID: string, signal?: AbortSignal): Promise<CinemaRenderJob> => (
      CinemaRenderJobSchema.parse(await requestData(
        agentBaseURL,
        `${renderJobPrefix(projectID, jobID)}/cancel`,
        { ...jsonRequest("POST", {}), signal },
      ))
    ),

    retryJob: async (jobID: string, operationID: string, signal?: AbortSignal): Promise<CinemaRenderJob> => {
      const body = RetryCinemaRenderJobBodySchema.parse({ operationID })
      return CinemaRenderJobSchema.parse(await requestData(
        agentBaseURL,
        `${renderJobPrefix(projectID, jobID)}/retry`,
        { ...jsonRequest("POST", body), signal },
      ))
    },
  }
}

export type RenderApi = ReturnType<typeof createRenderApi>
