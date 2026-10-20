import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

test("真实本机模型：上传、候选核对、确认、刷新与私有餐照", async ({ page }) => {
  test.skip(process.env.RUN_LOCAL_VISION !== "1", "需显式启用真实模型测试并准备餐照夹具");
  test.setTimeout(240000);
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  const headers = { "X-CSRF-Token": csrf.data.csrfToken, "X-Client-Platform": "h5", "Idempotency-Key": randomUUID() };
  await page.request.post("/api/v1/__dev/session", { headers, data: { fixture: "a" } });
  const capability = await (await page.request.get("/api/v1/__dev/capabilities")).json();
  expect(capability.data.recognition).toBe(true);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const listUrl = `/api/v1/me/meals?date=${date}&limit=100`;
  const before = (await (await page.request.get(listUrl)).json()).data.items.length;
  const marker = `本机识别验证-${Date.now()}`;
  let mealId: string | undefined;
  page.on("response", async (response) => {
    if (response.url().endsWith("/api/v1/me/meals") && response.request().method() === "POST" && response.status() === 201) {
      mealId = (await response.json()).data.meal.id;
    }
  });
  try {
    await page.goto("/nutrition");
    await page.getByRole("button", { name: "拍照记录", exact: true }).click();
    await page.getByLabel("从相册选择餐食照片", { exact: true }).setInputFiles(process.env.M03_MEAL_PHOTO ?? ".local/m03-test-meal.jpg");
    await expect(page.getByRole("button", { name: "上传并识别", exact: true })).toBeEnabled();
    const began = Date.now();
    await page.getByRole("button", { name: "上传并识别", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "确认识别结果", exact: true });
    await expect(confirmation.or(page.getByRole("dialog").getByRole("alert"))).toBeVisible({ timeout: 185000 });
    await expect(confirmation).toBeVisible();
    const names = await page.locator('input[aria-label^="食物名称"]').evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.length > 0)).toBe(true);
    expect((await (await page.request.get(listUrl)).json()).data.items.length).toBe(before);
    await writeFile(".local/m03-real-vision-result.json", JSON.stringify({ provider: "ollama-local", model: "qwen3-vl:4b-instruct", elapsedMs: Date.now() - began, names, date, fixtureSource: "https://github.com/thejusdutt/nutrilens/blob/HEAD/masala-dosa-recipe-500x500.jpg", note: "真实推理与保存流程验证；不代表营养准确率" }, null, 2));
    await page.getByLabel("食物名称1", { exact: true }).fill(marker);
    await page.getByRole("button", { name: "确认记录", exact: true }).click();
    const card = page.locator(".nt-meal-card").filter({ hasText: marker });
    await expect(card).toBeVisible();
    await page.reload();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.getByAltText("这一餐的餐食照片", { exact: true })).toBeVisible();
    const photo = page.getByAltText("这一餐的餐食照片", { exact: true });
    await expect.poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
    const detail = (await (await page.request.get(`/api/v1/me/meals/${mealId}`)).json()).data;
    expect(detail.source).toBe("photo");
    expect(detail.photoAssetId).toBeTruthy();
    expect((await page.request.get(detail.photoUrl.replace(/token=.*/, "token=invalid"))).status()).toBe(403);
  } finally {
    if (mealId) {
      // 页面上传会轮换CSRF cookie，清理时重新取得与当前cookie匹配的令牌。
      const latest = await (await page.request.get("/api/v1/auth/csrf")).json();
      const removed = await page.request.delete(`/api/v1/me/meals/${mealId}`, { headers: { ...headers, "X-CSRF-Token": latest.data.csrfToken, "Idempotency-Key": randomUUID() } });
      expect(removed.status()).toBe(204);
    }
  }
});
