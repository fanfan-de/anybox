import z from "zod"
import * as Tool from "#tool/tool.ts"
import * as ImageAssets from "#session/support/image-assets.ts"

const ViewImageParameters = z.object({
  path: z.string().min(1).describe("Absolute or project-relative path to a local image file."),
})

export const ViewImageTool = Tool.define(
  "view_image",
  async () => {
    return {
      title: "View Image",
      description: "Load a local PNG, JPEG, or WebP image into the model's visual context so its visible contents can be inspected.",
      parameters: ViewImageParameters,
      execute: async (parameters, ctx): Promise<Tool.ToolOutput<Record<string, unknown>, Record<string, unknown>>> => {
        const local = await ImageAssets.readLocalImage(parameters.path)
        if (!ImageAssets.isModelImageMime(local.mime)) {
          throw new Error(
            `Image format ${local.mime} cannot be sent to the model. Convert it to PNG, JPEG, or WebP first.`,
          )
        }

        const asset = await ImageAssets.saveImageAsset({
          sessionID: ctx.sessionID,
          bytes: local.bytes,
          mime: local.mime,
          filename: local.filename,
          sourceTool: "view_image",
          originalPath: local.path,
        })
        const image = {
          path: local.path,
          url: asset.url,
          width: asset.width ?? local.width,
          height: asset.height ?? local.height,
          mimeType: asset.mime,
          sourceTool: "view_image",
        }
        const modelImageRef = {
          sessionID: asset.sessionID,
          assetID: asset.assetID,
        }

        return {
          title: `View ${asset.filename}`,
          text: [
            `Image: ${asset.filename}`,
            `Path: ${local.path}`,
            `MIME: ${asset.mime}`,
            image.width && image.height ? `Size: ${image.width}x${image.height}` : undefined,
            `URL: ${asset.url}`,
          ].filter(Boolean).join("\n"),
          metadata: {
            kind: "view-image",
            sourceTool: "view_image",
            image,
            modelImageRef,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
          },
          data: {
            image,
            images: [image],
          },
          attachments: [
            {
              url: asset.url,
              mime: asset.mime,
              filename: asset.filename,
              metadata: {
                kind: "image-asset",
                sourceTool: "view_image",
                width: image.width,
                height: image.height,
                mimeType: asset.mime,
                originalPath: local.path,
                modelImageRef,
                sizeBytes: asset.sizeBytes,
                sha256: asset.sha256,
              },
            },
          ],
        }
      },
      toModelOutput: async (result) => {
        const metadataRef = result.metadata?.modelImageRef
        const modelImageRef = (
          metadataRef &&
          typeof metadataRef === "object" &&
          typeof (metadataRef as Record<string, unknown>).sessionID === "string" &&
          typeof (metadataRef as Record<string, unknown>).assetID === "string"
        )
          ? {
              sessionID: (metadataRef as Record<string, unknown>).sessionID as string,
              assetID: (metadataRef as Record<string, unknown>).assetID as string,
            }
          : result.attachments
            ?.map((attachment) => ImageAssets.parseImageAssetURL(attachment.url))
            .find((ref): ref is ImageAssets.ImageAssetRef => Boolean(ref))

        if (!modelImageRef) {
          return {
            type: "text" as const,
            value: `${result.text}\n\nThe stored image asset could not be recovered. Please call view_image again before making a visual judgment.`,
          }
        }

        try {
          const asset = await ImageAssets.readImageAssetBytes(modelImageRef)
          return {
            type: "content" as const,
            value: [
              { type: "text" as const, text: result.text },
              {
                type: "file" as const,
                data: { type: "data" as const, data: asset.bytes },
                mediaType: asset.metadata.mime,
                filename: asset.metadata.filename,
              },
            ],
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return {
            type: "text" as const,
            value: `${result.text}\n\nThe image could not be loaded into visual context: ${message} Please call view_image again after correcting the image.`,
          }
        }
      },
    }
  },
  {
    title: "View Image",
    modelRequirements: {
      inputModalities: ["image"],
    },
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
  },
)
