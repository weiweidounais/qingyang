import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("真实高德MCP：城市搜索、门店详情、地图链接和禁止收藏", async ({ page }) => {
  test.skip(process.env.RUN_AMAP !== "1", "需显式启用真实高德查询；不获取测试者当前位置");
  test.setTimeout(120000);
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  await page.request.post("/api/v1/__dev/session", { headers: { "X-CSRF-Token": csrf.data.csrfToken, "Idempotency-Key": randomUUID(), "X-Client-Platform": "h5" }, data: { fixture: "a" } });
  await page.goto("/nutrition");
  await expect(page.locator("#nearby")).toContainText("高德地图实时提供");
  const response = page.waitForResponse((res) => res.url().includes("/api/v1/restaurants/nearby?") && res.request().method() === "GET");
  await page.getByLabel("手动选择搜索中心", { exact: true }).selectOption({ label: "上海市中心" });
  const result = await response;
  expect(result.status()).toBe(200);
  const data = (await result.json()).data;
  expect(data.provider).toBe("amap-mcp"); expect(data.items.length).toBeGreaterThan(0);
  expect(data.items.every((x: any) => x.coordinateSystem === "wgs84" && !x.isFavorited && x.estimatedCaloriesKcal === null)).toBe(true);
  const cards = page.locator(".nt-restaurant");
  await expect(cards).toHaveCount(data.items.length);
  await expect(cards.first().getByRole("button", { name: /^收藏/ })).toBeDisabled();
  await cards.first().locator(".nt-restaurant-open").click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText(data.items[0].address, { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "高德门店暂不支持收藏" })).toBeDisabled();
  const link = detail.getByRole("link", { name: "在高德地图查看", exact: true });
  await expect(link).toHaveAttribute("href", /https:\/\/uri.amap.com\/marker\?poiid=/);
  expect((await link.getAttribute("href"))!).not.toContain("key=");
});
