import { generateImage } from "ai"
import type { JSONValue } from "@ai-sdk/provider"
import z from "zod"
import * as Config from "#config/config.ts"
import * as ModelRuntime from "#model/runtime.ts"
import * as ModelSelection from "#model/selection.ts"
import type { ModelReference } from "#model/types.ts"
import * as Tool from "#tool/tool.ts"
import * as ImageAssets from "#session/support/image-assets.ts"

const ImageSize = z.string().regex(/^\d+x\d+$/, "size must use the format WIDTHxHEIGHT, for example 1024x1024")

const GenerateImageParameters = z.object({
  prompt: z.string().min(1).max(4000).describe("Text prompt describing the image to generate."),
  size: ImageSize.optional().describe("Optional output size, for example 1024x1024."),
  count: z.number().int().min(1).max(4).optional().describe("Number of images to generate, between 1 and 4."),
  style: z.string().min(1).max(400).optional().describe("Optional style hint to append to the prompt."),
})

function compactPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim()
  return normalized.length <= 180 ? normalized : `${normalized.slice(0, 177)}...`
}

function normalizePrompt(prompt: string, style?: string) {
  const trimmedPrompt = prompt.trim()
  const trimmedStyle = style?.trim()
  return trimmedStyle ? `${trimmedPrompt}\n\nStyle: ${trimmedStyle}` : trimmedPrompt
}

function imageModelLabel(ref: ModelReference) {
  return `${ref.providerID}/${ref.modelID}`
}

export const GenerateImageTool = Tool.define(
  "generate_image",
  async () => {
    return {
      title: "Generate Image",
      description: "Generate images from a text prompt using the globally configured image generation model.",
      parameters: GenerateImageParameters,
      execute: async (parameters, ctx): Promise<Tool.ToolOutput<Record<string, unknown>, Record<string, unknown>>> => {
        const selection = await Config.get(Config.GLOBAL_CONFIG_ID)
        if (!selection.image_model) {
          throw new Error("No image generation model is configured. Choose an image-capable model in model settings before using generate_image.")
        }

        const imageModelRef = ModelSelection.parseModelReference(selection.image_model)
        if (!imageModelRef) {
          throw new Error(`Configured image model '${selection.image_model}' must use the format provider/model.`)
        }

        const providerModel = await ModelSelection.resolveImageSelectableModel(selection.image_model, Config.GLOBAL_CONFIG_ID)
        const imageModel = await ModelRuntime.getImage(providerModel, Config.GLOBAL_CONFIG_ID)
        const defaults = await Config.getImageGenerationSettings(Config.GLOBAL_CONFIG_ID)
        const prompt = normalizePrompt(parameters.prompt, parameters.style)
        const count = parameters.count ?? defaults.default_count ?? 1
        const size = (parameters.size ?? defaults.default_size) as `${number}x${number}` | undefined
        const result = await generateImage({
          model: imageModel,
          prompt,
          n: count,
          ...(size ? { size } : {}),
          abortSignal: ctx.abort,
          maxRetries: 0,
        })

        const model = imageModelLabel(imageModelRef)
        const assets = await Promise.all(
          result.images.map((image, index) =>
            ImageAssets.saveImageAsset({
              sessionID: ctx.sessionID,
              bytes: image.uint8Array,
              mime: image.mediaType,
              filename: `generated-${index + 1}`,
              sourceTool: "generate_image",
              prompt: parameters.prompt,
            }),
          ),
        )

        const images = assets.map((asset) => ({
          url: asset.url,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mime,
          model,
          prompt: parameters.prompt,
          sourceTool: "generate_image",
        }))

        return {
          title: `Generated ${images.length} image${images.length === 1 ? "" : "s"}`,
          text: [
            `Generated ${images.length} image${images.length === 1 ? "" : "s"} with ${model}.`,
            `Prompt: ${compactPrompt(parameters.prompt)}`,
            ...images.map((image, index) => `Image ${index + 1}: ${image.url}`),
          ].join("\n"),
          metadata: {
            kind: "generated-images",
            sourceTool: "generate_image",
            model,
            prompt: parameters.prompt,
            promptSummary: compactPrompt(parameters.prompt),
            size,
            count,
            images,
          },
          data: {
            images,
          },
          attachments: assets.map((asset) => ({
            url: asset.url,
            mime: asset.mime,
            filename: asset.filename,
            metadata: {
              kind: "image-asset",
              sourceTool: "generate_image",
              width: asset.width,
              height: asset.height,
              mimeType: asset.mime,
              model,
              prompt: parameters.prompt,
            },
          })),
        }
      },
      toModelOutput: (result) => ({
        type: "json" as const,
        value: (result.data ?? result.metadata ?? { text: result.text }) as JSONValue,
      }),
    }
  },
  {
    title: "Generate Image",
    capabilities: {
      kind: "other",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)
