import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function session(request: APIRequestContext, fixture: "a" | "b" = "a") {
  const csrf = await (await request.get("/api/v1/auth/csrf")).json();
  const headers = {
    "X-CSRF-Token": csrf.data.csrfToken,
    "X-Client-Platform": "h5",
    "Idempotency-Key": randomUUID(),
  };
  await request.post("/api/v1/__dev/session", { data: { fixture }, headers });
  return headers;
}
test("真实记餐、未知营养、刷新、编辑、删除与账号隔离", async ({ page }) => {
  const ids: string[] = [];
  const request = page.request;
  let headers = await session(request);
  test
    .info()
    .annotations.push({
      type: "integration",
      description: "真实MySQL；仅使用本地测试账号，不验证M01/M05真实实现",
    });
  const unique = `浏览器验证餐-${Date.now()}`;
  page.on("response", async (res) => {
    if (
      res.url().endsWith("/api/v1/me/meals") &&
      res.request().method() === "POST" &&
      res.status() === 201
    ) {
      const r = await res.json();
      ids.push(r.data.meal.id);
    }
  });
  try {
    await page.goto("/nutrition");
    await expect(
      page.getByRole("button", { name: "手动记餐", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "手动记餐", exact: true }).click();
    await page.getByLabel("食物名称1", { exact: true }).fill(unique);
    await page.getByLabel("份量1", { exact: true }).fill("150");
    await page.getByLabel("热量1", { exact: true }).fill("240");
    await page
      .getByRole("button", { name: "从食物库添加", exact: true })
      .click();
    await page
      .getByRole("button")
      .filter({ hasText: "白米饭（熟，长粒）" })
      .click();
    await page.getByLabel("份量2", { exact: true }).fill("100");
    await page.getByRole("button", { name: "确认记录", exact: true }).click();
    const meal = page.locator(".nt-meal-card").filter({ hasText: unique });
    await expect(meal).toBeVisible();
    await expect(meal).toContainText("370");
    await page.reload();
    await expect(meal).toBeVisible();
    await meal.click();
    await expect(
      page.getByRole("dialog", { name: "这一餐的记录" }),
    ).toContainText("碳水未知");
    await page.getByRole("button", { name: "编辑记录", exact: true }).click();
    await page.getByLabel("热量1", { exact: true }).fill("260");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(meal).toContainText("390");
    await page.locator(".nt-dev-note summary").click();
    await page
      .getByRole("button", { name: "切换测试账号，检查数据隔离" })
      .click();
    await expect(page.locator(".nt-dev-note")).toContainText("本地测试账号B");
    await expect(meal).toHaveCount(0);
    await page
      .getByRole("button", { name: "切换测试账号，检查数据隔离" })
      .click();
    await expect(meal).toBeVisible();
    await meal.click();
    await page.getByRole("button", { name: "删除记录", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(meal).toHaveCount(0);
    await page.reload();
    await expect(meal).toHaveCount(0);
  } finally {
    headers = await session(request);
    for (const id of ids)
      await request.delete(`/api/v1/me/meals/${id}`, {
        headers: { ...headers, "Idempotency-Key": randomUUID() },
      });
  }
});
test("照片格式校验、系统相机入口、预览、取消不记餐、服务未接入", async ({
  page,
}) => {
  const headers = await session(page.request);
  // 单独验证服务缺失时的退路，避免此用例依赖本机模型安装状态。
  await page.route("**/api/v1/__dev/capabilities", (route) => route.fulfill({
    json: { data: { mode: "local_fixture", upload: false, recognition: false, poi: false, points: false, dashboard: false } },
  }));
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "拍照记录", exact: true }).click();
  const input = page.getByLabel("拍摄餐食照片", { exact: true });
  await expect(input).toHaveAttribute("capture", "environment");
  await input.setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "图片",
  );
  await input.setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "无法读取",
  );
  const before = await (
    await page.request.get(
      `/api/v1/me/meals?date=${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date())}`,
    )
  ).json();
  // 标准1x1 PNG，来自本测试夹具；不作为营养数据或识别结果。
  await input.setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".nt-photo-preview img")).toBeVisible();
  await expect(page.getByRole("button", { name: "上传与识别待接入" })).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  const after = await (
    await page.request.get(
      `/api/v1/me/meals?date=${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date())}`,
    )
  ).json();
  expect(after.data.items.length).toBe(before.data.items.length);
  await expect(page.locator("#nearby")).toContainText("地图服务待接入");
});
test("保存失败保留输入，取消表单不保存", async ({ page }) => {
  await session(page.request);
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "手动记餐", exact: true }).click();
  await page.getByLabel("食物名称1", { exact: true }).fill("未保存的输入");
  await page.getByLabel("份量1", { exact: true }).fill("100");
  await page.getByLabel("热量1", { exact: true }).fill("200");
  await page.route("**/api/v1/me/meals", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "TEST_UNAVAILABLE", message: "测试：服务不可用" },
          }),
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "确认记录", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "测试：服务不可用",
  );
  await expect(page.getByLabel("食物名称1", { exact: true })).toHaveValue(
    "未保存的输入",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".nt-meal-card").filter({ hasText: "未保存的输入" }),
  ).toHaveCount(0);
});
test("窄屏与电脑布局，日期切换，无演示餐厅与默认目标", async ({ page }) => {
  await session(page.request);
  await page.goto("/nutrition");
  await expect(page.locator(".nt-dev-note")).toBeVisible();
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    );
    if (!fits) {
      console.log(
        await page.evaluate(() => ({
          width: innerWidth,
          page: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll("body *")]
            .map((e) => ({
              tag: e.tagName,
              class: e.className,
              left: e.getBoundingClientRect().left,
              right: e.getBoundingClientRect().right,
            }))
            .filter((e) => e.right > innerWidth + 1)
            .slice(-20),
        })),
      );
      await page.screenshot({
        path: ".local/m03-overflow.png",
        fullPage: true,
      });
    }
    expect(fits, `width=${width}`).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".local/m03-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: ".local/m03-desktop.png", fullPage: false });
  await page.getByRole("button", { name: "前一天", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "回看这一天的饮食" }),
  ).toBeVisible();
  await expect(page.locator(".nt-root")).not.toContainText("1,800");
  await expect(page.locator("#nearby")).not.toContainText("绿意食光");
});
