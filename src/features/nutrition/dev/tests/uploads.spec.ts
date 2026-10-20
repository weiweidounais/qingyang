import { test, expect, type APIRequestContext } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";

async function account(request: APIRequestContext, fixture: "a" | "b") {
  const csrf = await (await request.get("/api/v1/auth/csrf")).json();
  const headers = { "X-CSRF-Token": csrf.data.csrfToken, "X-Client-Platform": "h5", "Idempotency-Key": randomUUID() };
  expect((await request.post("/api/v1/__dev/session", { headers, data: { fixture } })).ok()).toBe(true);
  return headers;
}
async function prepare(request: APIRequestContext, headers: Record<string,string>, bytes: Buffer) {
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const response = await request.post("/api/v1/uploads/presign", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { purpose: "meal_photo", filename: "upload-test.png", contentType: "image/png", sizeBytes: bytes.length, checksumSha256 },
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()).data, checksumSha256 };
}
test("真实本机上传、校验、幂等完成与跨账号隔离", async ({ page, playwright }) => {
  const request = page.request;
  const headers = await account(request, "a");
  // 截图只作为有效PNG上传夹具，不冒充食物或模型识别。
  await page.goto("/nutrition");
  const bytes = await page.screenshot();
  const signed = await prepare(request, headers, bytes);
  const binary = await request.put(signed.uploadUrl, { data: bytes, headers: signed.requiredHeaders });
  expect(binary.status()).toBe(204);
  const completeOptions = { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { checksumSha256: signed.checksumSha256 } };
  const complete = await request.post(`/api/v1/uploads/${signed.assetId}/complete`, completeOptions);
  expect(complete.status()).toBe(200);
  expect((await complete.json()).data.status).toBe("ready");
  expect((await request.post(`/api/v1/uploads/${signed.assetId}/complete`, completeOptions)).status()).toBe(200);
  expect((await (await request.get(`/api/v1/uploads/${signed.assetId}`)).json()).data.status).toBe("ready");
  const other = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3001" });
  try {
    const b = await account(other, "b");
    expect((await other.get(`/api/v1/uploads/${signed.assetId}`)).status()).toBe(404);
    expect((await other.post("/api/v1/me/recognition-jobs", { headers: { ...b, "Idempotency-Key": randomUUID() }, data: { assetId: signed.assetId } })).status()).toBe(404);
    expect((await other.get(`/api/v1/uploads/${signed.assetId}/content?token=invalid`)).status()).toBe(403);
  } finally { await other.dispose(); }
});
test("拒绝摘要不符、损坏图片与伪造上传授权", async ({ page }) => {
  const request = page.request, headers = await account(request, "a");
  const corrupt = Buffer.from("not an image");
  const signed = await prepare(request, headers, corrupt);
  expect((await request.put(signed.uploadUrl.replace(/token=.*/, "token=forged"), { data: corrupt, headers: signed.requiredHeaders })).status()).toBe(403);
  expect((await request.put(signed.uploadUrl, { data: Buffer.from("wrong"), headers: signed.requiredHeaders })).status()).toBe(422);
  expect((await request.put(signed.uploadUrl, { data: corrupt, headers: signed.requiredHeaders })).status()).toBe(422);
  expect((await (await request.get(`/api/v1/uploads/${signed.assetId}`)).json()).data.status).toBe("rejected");
  expect((await request.post(`/api/v1/uploads/${signed.assetId}/complete`, { headers: { ...headers, "Idempotency-Key": randomUUID() }, data: { checksumSha256: signed.checksumSha256 } })).status()).toBe(422);
});
test("无WebCrypto时仍能真实上传校验，识别服务失败保留照片", async ({ page }) => {
  await account(page.request, "a");
  await page.addInitScript(() => Object.defineProperty(crypto, "subtle", { value: undefined }));
  await page.route("**/api/v1/__dev/capabilities", (route) => route.fulfill({
    json: { data: { mode: "local_fixture", upload: true, recognition: true, poi: false, points: false, dashboard: false } },
  }));
  // 只替换模型调用入口为明确失败，上传与服务端摘要校验使用真实实现。
  await page.route("**/api/v1/me/recognition-jobs", (route) => route.fulfill({
    status: 503, json: { error: { code: "TEST_MODEL_OFFLINE", message: "测试：模型暂不可用" } },
  }));
  await page.goto("/nutrition");
  const bytes = await page.screenshot();
  await page.getByRole("button", { name: "拍照记录", exact: true }).click();
  await page.getByLabel("从相册选择餐食照片", { exact: true }).setInputFiles({ name: "fallback.png", mimeType: "image/png", buffer: bytes });
  const uploaded = page.waitForResponse((response) => response.url().endsWith("/api/v1/uploads/presign") && response.status() === 201);
  await page.getByRole("button", { name: "上传并识别", exact: true }).click();
  const id = (await (await uploaded).json()).data.assetId;
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("测试：模型暂不可用");
  await expect(page.locator(".nt-photo-preview img")).toBeVisible();
  expect((await (await page.request.get(`/api/v1/uploads/${id}`)).json()).data.status).toBe("ready");
});
test("打开拍照窗口刷新旧的服务状态，重新检查保留已选照片", async ({ page }) => {
  await account(page.request, "a");
  let available = false;
  await page.route("**/api/v1/__dev/capabilities", (route) => route.fulfill({
    json: { data: { mode: "local_fixture", upload: available, recognition: available, poi: false, points: false, dashboard: false } },
  }));
  await page.goto("/nutrition");
  await expect(page.locator(".nt-dev-note")).toBeVisible();
  const bytes = await page.screenshot();
  available = true;
  await page.getByRole("button", { name: "拍照记录", exact: true }).click();
  await page.getByLabel("从相册选择餐食照片", { exact: true }).setInputFiles({ name: "retained.png", mimeType: "image/png", buffer: bytes });
  await expect(page.getByRole("button", { name: "上传并识别", exact: true })).toBeEnabled();
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  available = false;
  await page.getByRole("button", { name: "拍照记录", exact: true }).click();
  await expect(page.getByRole("button", { name: "上传与识别待接入", exact: true })).toBeDisabled();
  await expect(page.locator(".nt-photo-preview img")).toBeVisible();
  available = true;
  await page.getByRole("button", { name: "重新检查服务", exact: true }).click();
  await expect(page.getByRole("button", { name: "上传并识别", exact: true })).toBeEnabled();
  await expect(page.locator(".nt-photo-preview img")).toBeVisible();
});
