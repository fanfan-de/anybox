import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Film, Image, Video } from "lucide-react"
import type { CinemaAssetRef } from "@anybox/shared/cinema"
import type { CinemaRenderJob, CinemaRenderPreflightResult } from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { AssetLibraryApiError, createAssetLibraryApi } from "../../assets/assetLibraryApi"
import { cinemaAssetURL } from "../../media/assetNodeData"
import { formatBytes, formatRenderDuration } from "../model/renderStatus"
import { useI18n } from "../../../i18n"

function outputUnavailableCopy(input: {
  status?: "uploading" | "processing" | "ready" | "failed" | "missing" | "trashed"
  notFound: boolean
  statusCheckFailed: boolean
  previewFailed: boolean
}, t: ReturnType<typeof useI18n>["t"]) {
  if (input.status === "trashed") {
    return {
      title: t("deliver.outputDeletedTitle"),
      message: t("deliver.outputDeletedMessage"),
    }
  }
  if (input.status === "missing" || input.notFound) {
    return {
      title: t("deliver.outputMissingTitle"),
      message: t("deliver.outputMissingMessage"),
    }
  }
  if (input.status && input.status !== "ready") {
    return {
      title: t("deliver.outputNotReadyTitle"),
      message: t("deliver.outputNotReadyMessage", { status: input.status }),
    }
  }
  if (input.statusCheckFailed) {
    return {
      title: t("deliver.outputStatusUnavailableTitle"),
      message: t("deliver.outputStatusUnavailableMessage"),
    }
  }
  if (input.previewFailed) {
    return {
      title: t("deliver.previewUnavailableTitle"),
      message: t("deliver.previewUnavailableMessage"),
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
  const { t } = useI18n()
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
  }, t)
  const outputName = outputJob?.settings.outputName ?? t("deliver.renderFallbackName")
  const recheckOutput = () => {
    setFailedPreviewURL(null)
    void outputAssetQuery.refetch()
  }
  return (
    <section className="cinema-deliver-main" aria-label={t("deliver.preview")}>
      <div className="cinema-deliver-preview-surface">
        {checkingOutput ? (
          <div className="cinema-deliver-preview-empty" role="status">
            <Video size={30} aria-hidden="true" />
            <strong>{t("deliver.checkingOutput")}</strong>
            <span>{t("deliver.verifyingOutput")}</span>
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
                {t("deliver.checkAgain")}
              </button>
              {outputAsset && onShowInAssets && currentAssetStatus !== "trashed" && !outputNotFound ? (
                <button type="button" className="cinema-deliver-secondary-button" onClick={() => onShowInAssets(outputAsset)}>
                  {t("deliver.showInAssets")}
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
              aria-label={t("deliver.outputPreview", { name: outputName })}
              onError={() => setFailedPreviewURL(previewURL)}
            />
            <div className="cinema-deliver-output-caption">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{t("deliver.outputReady", { name: outputName })}</span>
              {outputAsset && onShowInAssets ? (
                <button type="button" className="cinema-deliver-secondary-button" onClick={() => onShowInAssets(outputAsset)}>
                  {t("deliver.showInAssets")}
                </button>
              ) : null}
              <a href={previewURL} target="_blank" rel="noreferrer">{t("deliver.openPreview")}</a>
            </div>
          </div>
        ) : (
          <div className="cinema-deliver-preview-empty" role="status">
            <Video size={30} aria-hidden="true" />
            <strong>{timeline ? timeline.title : t("deliver.selectTimeline")}</strong>
            <span>{t(job ? "deliver.outputPending" : "deliver.preflightPrompt")}</span>
          </div>
        )}
      </div>
      <div className="cinema-deliver-summary" aria-label={t("deliver.summaryLabel")}>
        <div className="cinema-deliver-summary-heading">
          <span>{t("deliver.summary")}</span>
          {preflight?.ready ? <span className="cinema-deliver-ready"><CheckCircle2 size={14} aria-hidden="true" /> {t("deliver.readyShort")}</span> : null}
        </div>
        <div className="cinema-deliver-summary-grid">
          <span><Film size={14} aria-hidden="true" /> {t("deliver.summaryDuration")} <strong>{preflight ? formatRenderDuration(preflight.durationUs) : "—"}</strong></span>
          <span><Image size={14} aria-hidden="true" /> {t("deliver.summaryVideo")} <strong>{preflight?.support.videoClips ?? "—"}</strong></span>
          <span>{t("deliver.summaryAudio")} <strong>{preflight?.support.audioClips ?? "—"}</strong></span>
          <span>{t("deliver.summaryInputSize")} <strong>{preflight ? formatBytes(preflight.estimatedInputBytes) : "—"}</strong></span>
        </div>
      </div>
    </section>
  )
}
