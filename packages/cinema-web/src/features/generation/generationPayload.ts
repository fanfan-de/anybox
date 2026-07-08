import type {
  GenerationInputControl,
  GenerationMediaInputSlot,
} from "./generationContract"

export type GenerationSourceAsset = {
  id: string
  path: string
  kind?: string
  nodeID: string
  edgeID?: string
}

export type GenerationSourceTextParameter = {
  edgeID: string
  nodeID: string
  text: string
}

export type GenerationActiveInputAsset = {
  input: GenerationInputControl & { slot: GenerationMediaInputSlot }
  asset: GenerationSourceAsset
}

export type GenerationLegacyAssetsBySlot = Partial<Record<GenerationMediaInputSlot, GenerationSourceAsset[]>>

export type BuildGenerationTaskParametersOptions = {
  baseParameters: Record<string, unknown>
  hiddenDefaultParameters: Record<string, unknown>
  fixedParameters: Record<string, unknown>
  sourceTextParameters: GenerationSourceTextParameter[]
  activeInputAssets: GenerationActiveInputAsset[]
  legacyAssetsBySlot: GenerationLegacyAssetsBySlot
  includeSourceImageFields: boolean
}

export function buildGenerationTaskParameters({
  baseParameters,
  hiddenDefaultParameters,
  fixedParameters,
  sourceTextParameters,
  activeInputAssets,
  legacyAssetsBySlot,
  includeSourceImageFields,
}: BuildGenerationTaskParametersOptions) {
  const inputSlots = buildGenerationInputSlots(sourceTextParameters, activeInputAssets)
  const sourceImageAssets = legacyAssetsBySlot.sourceImage ?? []
  const sourceImageAssetForPayload = sourceImageAssets[0] ?? null
  const referenceImageAssets = legacyAssetsBySlot.referenceImage ?? []
  const startFrameAsset = legacyAssetsBySlot.startFrame?.[0] ?? null
  const endFrameAsset = legacyAssetsBySlot.endFrame?.[0] ?? null
  const sourceVideoAsset = legacyAssetsBySlot.sourceVideo?.[0] ?? null
  const maskAsset = legacyAssetsBySlot.mask?.[0] ?? null

  return {
    ...baseParameters,
    ...hiddenDefaultParameters,
    ...fixedParameters,
    inputSlots,
    ...(includeSourceImageFields && sourceImageAssetForPayload
      ? {
        sourceImageAssetID: sourceImageAssetForPayload.id,
        sourceImageAssetIDs: sourceImageAssets.map((asset) => asset.id),
        sourceImagePath: sourceImageAssetForPayload.path,
        sourceImagePaths: sourceImageAssets.map((asset) => asset.path),
      }
      : {}),
    ...(startFrameAsset
      ? {
        startFrameAssetID: startFrameAsset.id,
        startFramePath: startFrameAsset.path,
      }
      : {}),
    ...(endFrameAsset
      ? {
        endFrameAssetID: endFrameAsset.id,
        endFramePath: endFrameAsset.path,
      }
      : {}),
    ...(referenceImageAssets.length > 0
      ? {
        referenceImageAssetID: referenceImageAssets[0]!.id,
        referenceImageAssetIDs: referenceImageAssets.map((asset) => asset.id),
        referenceImagePath: referenceImageAssets[0]!.path,
        referenceImagePaths: referenceImageAssets.map((asset) => asset.path),
      }
      : {}),
    ...(sourceVideoAsset
      ? {
        sourceVideoAssetID: sourceVideoAsset.id,
        sourceVideoPath: sourceVideoAsset.path,
      }
      : {}),
    ...(maskAsset
      ? {
        maskAssetID: maskAsset.id,
        maskPath: maskAsset.path,
      }
      : {}),
  }
}

export function generationLegacyAssetsBySlot(activeInputAssets: GenerationActiveInputAsset[]) {
  const bySlot: GenerationLegacyAssetsBySlot = {}
  for (const { input, asset } of activeInputAssets) {
    const current = bySlot[input.slot] ?? []
    bySlot[input.slot] = input.slot === "referenceImage"
      ? mergeGenerationSourceAssets([...current, asset])
      : [asset]
  }
  return bySlot
}

function buildGenerationInputSlots(
  sourceTextParameters: GenerationSourceTextParameter[],
  activeInputAssets: GenerationActiveInputAsset[],
) {
  return [
    ...sourceTextParameters.map((parameter) => ({
      key: "textParameter",
      inputKey: "textParameter",
      slot: "textParameter",
      role: "prompt",
      modality: "text",
      nodeID: parameter.nodeID,
      edgeID: parameter.edgeID,
    })),
    ...activeInputAssets.map(({ input, asset }) => ({
      key: input.inputKey,
      inputKey: input.inputKey,
      slot: input.slot,
      role: input.role,
      modality: input.modality,
      nodeID: asset.nodeID,
      edgeID: asset.edgeID,
      assetID: asset.id,
      path: asset.path,
      kind: asset.kind,
    })),
  ]
}

function mergeGenerationSourceAssets(assets: GenerationSourceAsset[]) {
  const result: GenerationSourceAsset[] = []
  const seen = new Set<string>()
  for (const asset of assets) {
    const key = `${asset.id}:${asset.path}:${asset.nodeID}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(asset)
  }
  return result
}
