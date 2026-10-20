import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Chromium's virtual video source exercises the real media/video/canvas APIs.
// These flags affect this test browser only; no physical camera is accessed.
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
async function openPhoto(page: Page) {
  const csrf = await (await page.request.get("/api/v1/auth/csrf")).json();
  await page.request.post("/api/v1/__dev/session", {
    data: { fixture: "a" },
    headers: { "X-CSRF-Token": csrf.data.csrfToken, "X-Client-Platform": "h5", "Idempotency-Key": randomUUID() },
  });
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "拍照记录", exact: true }).click();
}
async function recordStreams(page: Page, delayed = false) {
  await page.addInitScript((delay) => {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    const state = window as unknown as { testStreams: MediaStream[]; releaseCamera?: () => void };
    state.testStreams = [];
    media.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      state.testStreams.push(stream);
      if (delay) await new Promise<void>((resolve) => { state.releaseCamera = resolve; });
      return stream;
    };
  }, delayed);
}
async function allStopped(page: Page) {
  return page.evaluate(() => (window as unknown as { testStreams: MediaStream[] }).testStreams
    .every((s) => s.getTracks().every((t) => t.readyState === "ended")));
}
test("电脑打开实时相机、拍摄JPEG预览，拍摄和关闭释放摄像头", async ({ page }) => {
  await recordStreams(page);
  await openPhoto(page);
  await page.getByRole("button", { name: "打开相机", exact: true }).click();
  await expect(page.getByLabel("相机实时取景")).toBeVisible();
  await expect(page.getByRole("button", { name: "拍摄照片", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "拍摄照片", exact: true }).click();
  await expect(page.locator(".nt-photo-preview img")).toBeVisible();
  await expect.poll(() => allStopped(page)).toBe(true);
  const image = await page.locator(".nt-photo-preview img").evaluate(async (img: HTMLImageElement) => {
    const blob = await (await fetch(img.src)).blob();
    return { type: blob.type, size: blob.size, width: img.naturalWidth };
  });
  expect(image.type).toBe("image/jpeg");
  expect(image.size).toBeGreaterThan(0);
  expect(image.width).toBeGreaterThan(0);
  await page.getByRole("button", { name: "重新拍摄", exact: true }).click();
  await expect(page.getByRole("button", { name: "拍摄照片", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect.poll(() => allStopped(page)).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("拒绝权限会明确提示，允许后可重试", async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let first = true;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      if (first) { first = false; return Promise.reject(new DOMException("Denied", "NotAllowedError")); }
      return original(constraints);
    };
  });
  await openPhoto(page);
  await page.getByRole("button", { name: "打开相机", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("未获得摄像头权限");
  await page.getByRole("button", { name: "打开相机", exact: true }).click();
  await expect(page.getByRole("button", { name: "拍摄照片", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "取消拍摄", exact: true }).click();
  await expect(page.getByLabel("相机实时取景")).toHaveCount(0);
});
test("等待授权时取消，迟到的流立即释放且不再展示取景", async ({ page }) => {
  await recordStreams(page, true);
  await openPhoto(page);
  await page.getByRole("button", { name: "打开相机", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseCamera?: () => void }).releaseCamera)).toBe("function");
  await page.getByRole("button", { name: "取消拍摄", exact: true }).click();
  await page.evaluate(() => (window as unknown as { releaseCamera: () => void }).releaseCamera());
  await expect.poll(() => allStopped(page)).toBe(true);
  await expect(page.getByLabel("相机实时取景")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开相机", exact: true })).toBeEnabled();
});
test("移动端保留原生后摄拍照入口，相册入口独立", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1" }));
  await openPhoto(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "打开相机", exact: true }).click();
  expect(await (await chooser).element().getAttribute("capture")).toBe("environment");
  await expect(page.getByLabel("拍摄餐食照片", { exact: true })).toHaveAttribute("accept", "image/*");
  await expect(page.getByLabel("从相册选择餐食照片", { exact: true })).not.toHaveAttribute("capture");
});
