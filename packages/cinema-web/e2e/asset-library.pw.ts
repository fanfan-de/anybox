import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const externalCinemaURL = process.env.CINEMA_E2E_URL
const managedAgentPort = process.env.CINEMA_E2E_AGENT_PORT || "4187"
const agentBaseURL = `http://127.0.0.1:${managedAgentPort}`

test.describe("Cinema asset library", () => {
  test("keeps panels exclusive, exposes folder actions through the context menu, and restores focus", async ({ page, request }) => {
    let cinemaURL = externalCinemaURL
    if (!cinemaURL) {
      const projectResponse = await request.get(`${agentBaseURL}/e2e/project`)
      expect(projectResponse.ok()).toBe(true)
      const projectEnvelope = await projectResponse.json() as { data?: { cinemaURL?: string } }
      cinemaURL = projectEnvelope.data?.cinemaURL
      expect(cinemaURL).toBeTruthy()
      const resetResponse = await request.post(`${agentBaseURL}/e2e/reset`)
      expect(resetResponse.ok()).toBe(true)
    }

    await page.goto(cinemaURL!)
    const assetButton = page.getByRole("button", { name: /^(打开素材库|Open asset library)$/ })
    await assetButton.click()
    await expect(page.getByRole("complementary", { name: "素材库" })).toBeVisible()

    const content = page.locator(".cinema-asset-library-content")
    const openBlankAreaMenu = async () => {
      await content.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        element.dispatchEvent(new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + 24,
          clientY: bounds.top + 24,
        }))
      })
    }

    await expect(page.getByRole("tab", { name: "项目", selected: true })).toBeVisible()
    await page.getByRole("button", { name: "上传素材" }).click()
    const uploadPicker = page.getByRole("dialog", { name: "选择上传位置" })
    await expect(uploadPicker).toBeVisible()
    await expect(uploadPicker.getByRole("button", { name: "上传到这里" })).toBeVisible()
    await uploadPicker.getByRole("button", { name: "取消" }).click()

    await openBlankAreaMenu()
    await page.getByRole("menuitem", { name: "新建文件夹" }).click()
    const createFolderDialog = page.getByRole("dialog", { name: "新建文件夹" })
    await expect(createFolderDialog).toBeVisible()
    await createFolderDialog.getByRole("button", { name: "取消" }).click()

    if (!externalCinemaURL) {
      await page.getByRole("button", { name: /生成素材/ }).click()
      await page.getByRole("button", { name: /图片/ }).click()
      const asset = page.getByRole("gridcell", { name: /Fixture image 1/ })
      await expect(asset).toBeVisible()
      await asset.click({ button: "right" })
      await page.getByRole("menuitem", { name: "删除" }).click()
      await expect(page.getByRole("alertdialog")).toHaveCount(0)
      const deleteToast = page.locator(".cinema-asset-library-toast", { hasText: "已删除 1 项" })
      await expect(deleteToast).toBeVisible()
      await deleteToast.getByRole("button", { name: "撤销" }).click()
      await expect(deleteToast).toHaveCount(0)
      await expect(asset).toBeVisible()
    }

    await page.getByRole("tab", { name: "个人" }).click()
    await expect(page.getByRole("searchbox", { name: "搜索当前素材库" })).toBeEnabled()
    await expect(page.getByRole("button", { name: "上传素材" })).toBeEnabled()
    await expect(page.getByRole("button", { name: "新建文件夹" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /回收站/ })).toHaveCount(0)

    await openBlankAreaMenu()
    await expect(page.getByRole("menu")).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "上传到这里" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "新建文件夹" })).toBeVisible()

    const accessibility = await new AxeBuilder({ page })
      .include(".cinema-asset-library")
      .include(".cinema-asset-library-context-menu")
      .analyze()
    expect(accessibility.violations).toEqual([])

    await page.keyboard.press("Escape")
    await expect(page.getByRole("menu")).toHaveCount(0)
    await expect(content).toBeFocused()

    await page.setViewportSize({ width: 800, height: 900 })
    await expect(page.getByRole("complementary", { name: "素材库" })).toBeInViewport()

    await page.getByRole("searchbox", { name: "搜索当前素材库" }).press("Escape")
    await expect(assetButton).toBeFocused()
    await page.getByRole("button", { name: /^(打开项目文件|Open project files)$/ }).click()
    await expect(page.getByRole("complementary", { name: "素材库" })).toHaveCount(0)
    await page.getByRole("button", { name: /^(打开素材库|Open asset library)$/ }).click()
    await expect(page.locator(".cinema-file-browser")).toHaveCount(0)
  })
})
