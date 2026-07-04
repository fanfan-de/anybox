---
name: zhihu-md-publisher
description: Publish local Markdown articles to Zhihu from Codex. Use when the user asks to prepare, validate, automate, upload, or publish a .md article to Zhihu/Zhuanlan, including parsing frontmatter, resolving local images, filling the Zhihu editor, setting topics, handling draft links, and updating the source Markdown with the published Zhihu URL.
---

# Zhihu Markdown Publisher

Use this skill to move a local Markdown article into Zhihu's article editor and publish it with images. Treat Zhihu login, CAPTCHA, and final publishing as live external actions.

## Required Inputs

Expect a Markdown article path. If the user does not provide one, search the workspace for likely Zhihu drafts under paths such as `03_内容生产/知乎`.

The article should have frontmatter:

```yaml
---
zhihu-title: 文章标题
zhihu-topics:
  - 大语言模型
  - 桌面应用
zhihu-cover:
zhihu-link:
---
```

Support body images in either Markdown or Obsidian wiki syntax:

```markdown
![说明](../../assets/screenshot.png)
![[assets/screenshot.png|说明]]
```

## Workflow

1. Run the bundled preparer:

```powershell
node "<skill-dir>\scripts\prepare-zhihu-article.mjs" "<article.md>" "<output-dir>"
```

Use a workspace output directory such as `07_自动化脚本/out/zhihu`. The script writes:

- `<name>.manifest.json`: title, topics, cover, image paths, output paths.
- `<name>.html`: local preview.
- `<name>.txt`: plain-text fallback.

Stop and fix any missing frontmatter or missing images before using the browser.

2. Open `https://zhuanlan.zhihu.com/write` in the in-app browser when available. If Zhihu redirects to login, ask the user to finish login/CAPTCHA, then continue.

3. Fill the editor from the manifest:

- Put `manifest.title` into the title textbox.
- Clear the body if it contains an old draft or duplicate content.
- Paste rich HTML chunks, not raw Markdown, so headings/lists/links render correctly.
- Paste local images as clipboard image items in the original image order.
- Verify `figure` count equals `manifest.images.length`.
- Verify raw Markdown heading text such as `## ` is not present.
- Verify key tail content and links exist.

4. Set publishing metadata:

- Add no more topics than Zhihu accepts. Prefer exact topic suggestions surfaced by Zhihu over forcing frontmatter names.
- If topic search returns ambiguous results, pick fewer high-confidence topics rather than incorrect ones.
- Leave column/question/source settings unchanged unless the user explicitly asks.
- Add a cover only if the page supports it reliably; otherwise rely on the article's first product image.

5. Publish:

- Click final `发布` only if the user explicitly asked to publish in this turn or already approved publishing.
- After success, capture the final URL, usually `https://zhuanlan.zhihu.com/p/<id>`.
- Update the article frontmatter `zhihu-link:` with the final URL.
- Re-run the preparer once to verify the source still parses.

## Browser Implementation Notes

Use the Browser/in-app browser skill when available. A robust sequence is:

1. Inspect the current DOM and locate the two textboxes: title then body.
2. Fill title.
3. If the body must be cleared, click editor undo until the body is empty if ordinary `Ctrl+A` does not work. Verify `字数：0` and zero `figure` elements.
4. Paste chunks:

```js
await tab.clipboard.write([{ entries: [
  { mimeType: "text/html", text: htmlChunk },
  { mimeType: "text/plain", text: plainChunk }
] }]);
await bodyBox.press("Control+V", { timeoutMs: 10000 });
```

5. Paste each image:

```js
await tab.clipboard.write([{ entries: [{
  mimeType: "image/png",
  base64: imageBytes.toString("base64")
}] }]);
await bodyBox.press("Control+V", { timeoutMs: 10000 });
```

Use `image/jpeg` for `.jpg` or `.jpeg`. Wait briefly after every image paste so Zhihu finishes inserting/uploading it.

## Validation Checklist

Before publishing, check:

- Title textbox contains the intended title.
- Body has the intro and final paragraph.
- GitHub/download links are visible and clickable when present.
- `document.querySelectorAll("figure").length` equals expected image count.
- No duplicated body content.
- No raw heading markers remain, for example `## 是 Agent 工作台`.
- Topics are relevant and visible in publish settings.
- The `发布` button is enabled.

If any validation fails, do not publish. Restore a clean draft and re-fill it.
