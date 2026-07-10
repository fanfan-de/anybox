import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Film, Image, Video } from "lucide-react"
import type { CinemaAssetRef } from "@anybox/shared/cinema"
import type { CinemaRenderJob, CinemaRenderPreflightResult } from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { AssetLibraryApiError, createAssetLibraryApi } from "../../assets/assetLibraryApi"
import { cinemaAssetURL } from "../../media/assetNodeData"
import { formatBytes, formatRenderDuration } from "../model/renderStatus"

function outputUnavailableCopy(input: {
  status?: "uploading" | "processing" | "ready" | "failed" | "missing" | "trashed"
  notFound: boolean
  statusCheckFailed: boolean
  previewFailed: boolean
}) {
  if (input.status === "trashed") {
    return {
      title: "Output is in Trash",
      message: "Restore this render in Assets before previewing it.",
    }
  }
  if (input.status === "missing" || input.notFound) {
    return {
      title: "Output is missing",
      message: "The registered output is no longer available. Reconcile or restore it from Assets.",
    }
  }
  if (input.status && input.status !== "ready") {
    return {
      title: "Output is not ready",
      message: `The registered output is currently ${input.status}. Check its status in Assets.`,
    }
  }
  if (input.statusCheckFailed) {
    return {
      title: "Output status unavailable",
      message: "The current Assets status could not be checked. Try again before opening the preview.",
    }
  }
  if (input.previewFailed) {
    return {
      title: "Preview unavailable",
      message: "The registered output could not be loaded. It may have moved or become unavailable.",
    }
  }
  return null
}

export function DeliverPreview({
  agentBaseURL,
  timeline,
  preflight,
  job,
  onShowInAssets,
}: {
  agentBaseURL: string
  timeline: CinemaTimelineDocument | null
  preflight?: CinemaRenderPreflightResult
  job?: CinemaRenderJob
  onShowInAssets?: (assetRef: CinemaAssetRef) => void
}) {
  const outputAsset = job?.status === "succeeded" ? job.outputAssetRef : undefined
  const previewURL = outputAsset ? cinemaAssetURL(agentBaseURL, outputAsset, "preview") : null
  const outputJob = job?.status === "succeeded" ? job : undefined
  const [failedPreviewURL, setFailedPreviewURL] = useState<string | null>(null)
  const outputAssetQuery = useQuery({
    queryKey: [
      "cinema-deliver-output-asset-status",
      agentBaseURL,
      outputJob?.projectID,
      outputAsset?.scope,
      outputAsset?.assetID,
    ],
    queryFn: ({ signal }) => createAssetLibraryApi(
      agentBaseURL,
      outputJob!.projectID,
      outputAsset!.scope,
    ).getAsset(outputAsset!.assetID, signal),
    enabled: Boolean(outputAsset && outputJob),
    staleTime: 5_000,
    refetchInterval: outputAsset ? 5_000 : false,
    retry: false,
  })
  const currentAssetStatus = outputAssetQuery.data?.asset.status
  const outputNotFound = outputAssetQuery.error instanceof AssetLibraryApiError
    && outputAssetQuery.error.status === 404
  const checkingOutput = Boolean(previewURL && outputAssetQuery.isPending)
  const unavailable = outputUnavailableCopy({
    status: currentAssetStatus,
    notFound: outputNotFound,
    statusCheckFailed: Boolean(outputAssetQuery.error && !outputNotFound),
    previewFailed: Boolean(previewURL && failedPreviewURL === previewURL),
  })
  const recheckOutput = () => {
    setFailedPreviewURL(null)
    void outputAssetQuery.refetch()
  }
  return (
    <section className="cinema-deliver-main" aria-label="Delivery preview">
      <div className="cinema-deliver-preview-surface">
        {checkingOutput ? (
          <div className="cinema-deliver-preview-empty" role="status">
            <Video size={30} aria-hidden="true" />
            <strong>Checking output</strong>
            <span>Verifying the current render status in Assets…</span>
          </div>
        ) : previewURL && unavailable ? (
          <div className="cinema-deliver-preview-empty is-error" role="alert">
            <AlertTriangle size={30} aria-hidden="true" />
            <strong>{unavailable.title}</strong>
            <span>{unavailable.message}</span>
            <div className="cinema-deliver-preview-actions">
              <button
                type="button"
                className="cinema-deliver-secondary-button"
                disabled={outputAssetQuery.isFetching}
                onClick={recheckOutput}
              >
                Check again
              </button>
              {outputAsset && onShowInAssets ? (
                <button type="button" className="cinema-deliver-secondary-button" onClick={() => onShowInAssets(outputAsset)}>
                  Show in Assets
                </button>
              ) : null}
            </div>
          </div>
        ) : previewURL ? (
          <div className="cinema-deliver-output-preview">
            <video
              controls
              preload="metadata"
              src={previewURL}
              aria-label={`${outputJob?.settings.outputName ?? "Render"} output preview`}
              onError={() => setFailedPreviewURL(previewURL)}
            />
            <div className="cinema-deliver-output-caption">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span><strong>{outputJob?.settings.outputName ?? "Render"}.mp4</strong> is ready in Assets.</span>
              {outputAsset && onShowInAssets ? (
                <button type="button" className="cinema-deliver-secondary-button" onClick={() => onShowInAssets(outputAsset)}>
                  Show in Assets
                </button>
              ) : null}
              <a href={previewURL} target="_blank" rel="noreferrer">Open preview</a>
            </div>
          </div>
        ) : (
          <div className="cinema-deliver-preview-empty" role="status">
            <Video size={30} aria-hidden="true" />
            <strong>{timeline ? timeline.title : "Select a Timeline"}</strong>
            <span>{job ? "Your output will appear here when rendering finishes." : "Review the preflight summary, then start a real FFmpeg render."}</span>
          </div>
        )}
      </div>
      <div className="cinema-deliver-summary" aria-label="Timeline delivery summary">
        <div className="cinema-deliver-summary-heading">
          <span>Delivery summary</span>
          {preflight?.ready ? <span className="cinema-deliver-ready"><CheckCircle2 size={14} aria-hidden="true" /> Ready</span> : null}
        </div>
        <div className="cinema-deliver-summary-grid">
          <span><Film size={14} aria-hidden="true" /> Duration <strong>{preflight ? formatRenderDuration(preflight.durationUs) : "—"}</strong></span>
          <span><Image size={14} aria-hidden="true" /> Video <strong>{preflight?.support.videoClips ?? "—"}</strong></span>
          <span>Audio <strong>{preflight?.support.audioClips ?? "—"}</strong></span>
          <span>Input size <strong>{preflight ? formatBytes(preflight.estimatedInputBytes) : "—"}</strong></span>
        </div>
      </div>
    </section>
  )
}
