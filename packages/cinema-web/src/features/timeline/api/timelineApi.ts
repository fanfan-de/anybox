import {
  CinemaTimelineCommandResultSchema,
  DeleteCinemaTimelineResultSchema,
  CinemaTimelineDocumentSchema,
  CinemaTimelineListResultSchema,
  CinemaTimelineWaveformSchema,
  type CinemaTimelineCommand,
  type CinemaTimelineCommandResult,
  type CinemaTimelineDocument,
  type CreateCinemaTimelineBody,
} from "@anybox/shared/cinema-timeline"
import { resolveCinemaRuntimeURL } from "../../../runtimeUrl"

type ApiEnvelope = {
  success?: boolean
  data?: unknown
  error?: {
    code?: string
    message?: string
    data?: { latestRevision?: number }
  }
}

export class CinemaTimelineApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly latestRevision?: number

  constructor(message: string, status: number, code?: string, latestRevision?: number) {
    super(message)
    this.name = "CinemaTimelineApiError"
    this.status = status
    this.code = code
    this.latestRevision = latestRevision
  }
}

async function requestData(agentBaseURL: string, pathname: string, init?: RequestInit) {
  const response = await fetch(new URL(resolveCinemaRuntimeURL(agentBaseURL, pathname)), init)
  const body = await response.json().catch(() => ({})) as ApiEnvelope
  if (!response.ok || body.success === false) {
    throw new CinemaTimelineApiError(
      body.error?.message ?? `Timeline request failed (${response.status})`,
      response.status,
      body.error?.code,
      body.error?.data?.latestRevision,
    )
  }
  return body.data
}

function timelinePrefix(projectID: string) {
  return `/api/cinema/projects/${encodeURIComponent(projectID)}/timelines`
}

export function createTimelineApi(agentBaseURL: string, projectID: string) {
  const prefix = timelinePrefix(projectID)
  return {
    list: async () => CinemaTimelineListResultSchema.parse(await requestData(agentBaseURL, prefix)),
    create: async (body: CreateCinemaTimelineBody = {}) => CinemaTimelineDocumentSchema.parse(await requestData(
      agentBaseURL,
      prefix,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    )),
    get: async (timelineID: string) => CinemaTimelineDocumentSchema.parse(await requestData(
      agentBaseURL,
      `${prefix}/${encodeURIComponent(timelineID)}`,
    )),
    delete: async (timelineID: string) => DeleteCinemaTimelineResultSchema.parse(await requestData(
      agentBaseURL,
      `${prefix}/${encodeURIComponent(timelineID)}`,
      { method: "DELETE" },
    )),
    sendCommand: async (command: CinemaTimelineCommand): Promise<CinemaTimelineCommandResult> => (
      CinemaTimelineCommandResultSchema.parse(await requestData(
        agentBaseURL,
        `${prefix}/${encodeURIComponent(command.timelineID)}/commands`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        },
      ))
    ),
    getWaveform: async (timelineID: string, clipID: string) => CinemaTimelineWaveformSchema.parse(await requestData(
      agentBaseURL,
      `${prefix}/${encodeURIComponent(timelineID)}/clips/${encodeURIComponent(clipID)}/waveform`,
    )),
  }
}

export type TimelineApi = ReturnType<typeof createTimelineApi>
export type { CinemaTimelineDocument }
