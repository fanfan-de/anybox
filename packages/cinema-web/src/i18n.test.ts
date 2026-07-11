import { describe, expect, it } from "vitest"
import {
  resolveLocale,
  translate,
  translateGenerationOptionLabel,
  translateGenerationParameterLabel,
  translateGenerationProgress,
  translateGenerationStatus,
  translateVideoInputEmptyText,
  translateVideoInputLabel,
  translateVideoModeLabel,
  translateVideoPromptPlaceholder,
} from "./i18n"

describe("cinema i18n", () => {
  it("maps Chinese system locales and falls back to English", () => {
    expect(resolveLocale("zh-Hans-CN")).toBe("zh-CN")
    expect(resolveLocale("en-GB")).toBe("en-US")
    expect(resolveLocale(undefined)).toBe("en-US")
  })

  it("interpolates translated parameters", () => {
    expect(translate("zh-CN", "text.referenceImages", { count: 3 })).toBe("参考图：3 张")
    expect(translate("en-US", "text.referenceImages", { count: 2 })).toBe("Reference images: 2")
  })

  it("localizes common provider parameter labels without changing their keys", () => {
    expect(translateGenerationParameterLabel("zh-CN", "resolution", "Resolution")).toBe("分辨率")
    expect(translateGenerationParameterLabel("zh-CN", "aspect_ratio", "Aspect Ratio")).toBe("宽高比")
    expect(translateGenerationParameterLabel("zh-CN", "count", "Count")).toBe("数量")
    expect(translateGenerationParameterLabel("en-US", "aspect_ratio", "Aspect Ratio")).toBe("Aspect Ratio")
  })

  it("falls back to provider labels and only localizes known option display text", () => {
    expect(translateGenerationParameterLabel("zh-CN", "seed", "Creative Seed")).toBe("Creative Seed")
    expect(translateGenerationOptionLabel("zh-CN", "auto", "auto")).toBe("自动")
    expect(translateGenerationOptionLabel("zh-CN", "1:1", "1:1")).toBe("1:1")
  })

  it("localizes semantic video modes while preserving unknown provider labels", () => {
    expect(translateVideoModeLabel("zh-CN", "text-to-video", "Text to video")).toBe("文生视频")
    expect(translateVideoModeLabel("zh-CN", "image-to-video.multi-shot", "Image to video multi-shot")).toBe("图生视频（多镜头）")
    expect(translateVideoModeLabel("en-US", "frames-to-video", "First and last frame")).toBe("First and last frame")
    expect(translateVideoModeLabel("zh-CN", "custom-provider-mode", "Director mode")).toBe("Director mode")
  })

  it("localizes video input labels and guidance from stable roles and slots", () => {
    expect(translateVideoInputLabel("zh-CN", "startFrame", "first_frame_image", "First frame")).toBe("首帧")
    expect(translateVideoInputLabel("zh-CN", "referenceImage", "style_image", "Style image")).toBe("风格图")
    expect(translateVideoInputEmptyText("zh-CN", "endFrame", "Import or connect a last-frame image.")).toBe("导入或连接尾帧图片。")
    expect(translateVideoInputLabel("en-US", "endFrame", "last_frame_image", "Last frame")).toBe("Last frame")
  })

  it("localizes the built-in video prompt, progress, and status labels", () => {
    expect(translateVideoPromptPlaceholder("zh-CN", "Describe content, motion, camera, and visual changes...")).toBe("描述内容、动作、镜头和画面变化……")
    expect(translateVideoPromptPlaceholder("zh-CN", "Follow the provider-specific camera syntax.")).toBe("Follow the provider-specific camera syntax.")
    expect(translateGenerationProgress("zh-CN", "processing", "Processing")).toBe("处理中")
    expect(translateGenerationStatus("zh-CN", "running")).toBe("运行中")
  })
})
