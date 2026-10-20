import { test, expect, type Page } from "@playwright/test";

async function prepare(page: Page, mode: "success" | "denied" | "pending" | "fallback" = "success", insecure = false) {
  await page.addInitScript(({ mode, insecure }) => {
    if (insecure) Object.defineProperty(window, "isSecureContext", { value: false });
    let success: PositionCallback;
    let failure: PositionErrorCallback;
    let next = 1;
    const fixture = (window as any).__locationFixture = {
      cleared: [] as number[], options: null as PositionOptions | null, callbacks: [] as PositionCallback[],
      emit: (latitude: number, longitude: number, accuracy = 15) => success({ coords: { latitude, longitude, accuracy }, timestamp: Date.now() } as GeolocationPosition),
      fail: (code: number) => failure({ code } as GeolocationPositionError),
    };
    Object.defineProperty(navigator, "geolocation", { value: {
      watchPosition(ok: PositionCallback, error: PositionErrorCallback, options: PositionOptions) {
        success = ok; failure = error; fixture.options = options;
        fixture.callbacks.push(ok);
        queueMicrotask(() => {
          if (mode === "success") fixture.emit(31.2304, 121.4737);
          if (mode === "denied") error({ code: 1 } as GeolocationPositionError);
          if (mode === "fallback") {
            if (options.enableHighAccuracy) error({ code: 3 } as GeolocationPositionError);
            else fixture.emit(31.2304, 121.4737, 250);
          }
        });
        return next++;
      },
      clearWatch(id: number) { fixture.cleared.push(id); },
    } });
  }, { mode, insecure });
  await page.route("**/api/v1/__dev/capabilities", (r) => r.fulfill({ json: { data: { mode: "local_fixture", upload: true, recognition: true, poi: true, poiProvider: "amap-mcp", poiFavorites: false, points: false, dashboard: false } } }));
  await page.route("**/api/v1/restaurants/nearby?**", (r) => r.fulfill({ json: { data: { items: [], nextCursor: null } } }));
  await page.goto("/nutrition");
  await expect(page.getByRole("button", { name: "使用实时定位", exact: true })).toBeEnabled();
}
test("实时设备坐标用于搜索，小幅抖动不重复查询；移动后刷新，手选城市停止定位", async ({ page }) => {
  await page.clock.install();
  const queries: URL[] = [];
  page.on("request", (r) => { if (r.url().includes("/restaurants/nearby?")) queries.push(new URL(r.url())); });
  await prepare(page);
  expect(queries).toHaveLength(0);
  await page.getByRole("button", { name: "使用实时定位", exact: true }).click();
  await expect(page.locator("#nearby")).toContainText("设备实时定位");
  await expect.poll(() => queries.length).toBe(1);
  expect(queries[0].searchParams.get("latitude")).toBe("31.2304");
  expect(queries[0].searchParams.get("coordinateSystem")).toBe("wgs84");
  const options = await page.evaluate(() => (window as any).__locationFixture.options);
  expect(options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  await page.evaluate(() => (window as any).__locationFixture.emit(31.23041, 121.4737, 12));
  await expect(page.locator("#nearby")).toContainText("精度约12米");
  expect(queries).toHaveLength(1);
  await page.clock.runFor(16000);
  await page.evaluate(() => (window as any).__locationFixture.emit(31.234, 121.4737));
  await expect.poll(() => queries.length).toBe(2);
  expect(queries[1].searchParams.get("latitude")).toBe("31.234");
  await page.getByLabel("手动选择搜索中心", { exact: true }).selectOption({ label: "北京市中心" });
  await expect(page.locator("#nearby")).toContainText("手动选择，非你的实时位置");
  expect(await page.evaluate(() => (window as any).__locationFixture.cleared.length)).toBe(1);
});
test("拒绝定位时明确说明权限问题，不偷偷查询城市中心", async ({ page }) => {
  let searches = 0;
  page.on("request", (r) => { if (r.url().includes("/restaurants/nearby?")) searches++; });
  await prepare(page, "denied");
  await page.getByRole("button", { name: "使用实时定位", exact: true }).click();
  await expect(page.locator("#nearby")).toContainText("定位权限被拒绝");
  expect(searches).toBe(0);
});
test("取消后迟到位置无效；页面隐藏停止设备监听", async ({ page }) => {
  await prepare(page, "pending");
  await page.getByRole("button", { name: "使用实时定位", exact: true }).click();
  await page.evaluate(() => (window as any).__locationFixture.fail(3));
  await expect(page.locator("#nearby")).toContainText("正在尝试普通精度");
  await page.getByRole("button", { name: "取消定位", exact: true }).click();
  await expect(page.locator("#nearby")).not.toContainText("正在尝试普通精度");
  await page.evaluate(() => (window as any).__locationFixture.emit(31.2304, 121.4737));
  await expect(page.locator("#nearby")).not.toContainText("设备实时定位");
  await page.getByRole("button", { name: "使用实时定位", exact: true }).click();
  await page.evaluate(() => (window as any).__locationFixture.emit(31.2304, 121.4737));
  await expect(page.locator("#nearby")).toContainText("设备实时定位");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { value: true, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(page.getByRole("button", { name: "使用实时定位", exact: true })).toBeEnabled();
  await expect(page.locator("#nearby")).not.toContainText("设备实时定位");
  expect(await page.evaluate(() => (window as any).__locationFixture.cleared.length)).toBe(3);
});
test("局域网HTTP解释定位限制并提供HTTPS设置入口", async ({ page }) => {
  await prepare(page, "pending", true);
  await page.getByRole("button", { name: "使用实时定位", exact: true }).click();
  await expect(page.locator("#nearby")).toContainText("此HTTP地址无法取得设备位置");
  await expect(page.getByRole("link", { name: "手机HTTPS设置", exact: true })).toHaveAttribute("href", "/dev/mobile-setup");
  expect(await page.evaluate(() => (window as any).__locationFixture.options)).toBeNull();
});
test("高精度超时后尝试设备普通精度，标明精度并忽略旧回调", async ({ page }) => {
  await prepare(page, "fallback");
  await page.getByRole("button", { name: "使用实时定位", exact: true }).click();
  await expect(page.locator("#nearby")).toContainText("精度约250米");
  await expect(page.locator("#nearby")).toContainText("网站定位授权：已允许");
  expect(await page.evaluate(() => (window as any).__locationFixture.options.enableHighAccuracy)).toBe(false);
  await page.evaluate(() => (window as any).__locationFixture.callbacks[0]({ coords: { latitude: 30, longitude: 120, accuracy: 1 }, timestamp: Date.now() }));
  await expect(page.locator("#nearby")).toContainText("精度约250米");
});
