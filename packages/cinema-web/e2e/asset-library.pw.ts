import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const cinemaURL = process.env.CINEMA_E2E_URL

test.describe("Cinema asset library", () => {
  test.skip(!cinemaURL, "Set CINEMA_E2E_URL to a running Cinema project and Agent.")

  test("keeps panels exclusive, supports the personal recycle bin, and restores focus", async ({ page }) => {
    await page.goto(cinemaURL!)
    const assetButton = page.getByRole("button", { name: "打开素材库" })
    await assetButton.click()
    await expect(page.getByRole("complementary", { name: "素材库" })).toBeVisible()

    await page.getByRole("tab", { name: "个人" }).click()
    await expect(page.getByRole("searchbox", { name: "搜索当前素材库" })).toBeEnabled()
    const accessibility = await new AxeBuilder({ page }).include(".cinema-asset-library").analyze()
    expect(accessibility.violations).toEqual([])

    await page.getByRole("button", { name: /打开回收站/ }).click()
    await expect(page.getByText("回收站为空", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "返回素材库" }).click()

    await page.setViewportSize({ width: 800, height: 900 })
    await expect(page.getByRole("complementary", { name: "素材库" })).toBeInViewport()

    await page.getByRole("searchbox", { name: "搜索当前素材库" }).press("Escape")
    await expect(assetButton).toBeFocused()
    await page.getByRole("button", { name: "打开项目文件" }).click()
    await expect(page.getByRole("complementary", { name: "素材库" })).toHaveCount(0)
    await page.getByRole("button", { name: "打开素材库" }).click()
    await expect(page.locator(".cinema-file-browser")).toHaveCount(0)
  })
})
