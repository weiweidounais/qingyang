import { test, expect } from "@playwright/test";
test("shell fits phone and desktop and modal restores focus", async ({
  page,
}) => {
  await page.goto("/dashboard");
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await expect(
      page.getByRole("heading", { name: "每一点改变，都算数。" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const b = page.getByRole("button", { name: "记录体重" });
  await b.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(b).toBeFocused();
});
test("water and meal persist, invalid photo is rejected", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "喝一杯水" }).click();
  await expect(page.getByTestId("water-value")).toHaveText("1,500");
  await page.reload();
  await expect(page.getByTestId("water-value")).toHaveText("1,500");
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "拍照记录", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("no"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "图片",
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "meal.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "演示识别" }).click();
  await page.getByLabel("食物名称").fill("我的午餐");
  await page.getByRole("button", { name: "确认记录" }).click();
  await expect(page.getByText("我的午餐", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("我的午餐", { exact: true })).toBeVisible();
});
test("training, companion, bookings and overview", async ({ page }) => {
  await page.goto("/training");
  await page
    .getByRole("button", { name: "开始训练", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "开始计时" }).click();
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
  await page.getByRole("button", { name: "完成训练" }).click();
  await expect(page.getByText("今日已完成", { exact: true })).toBeVisible();
  await page.goto("/companion");
  await page.getByPlaceholder("想聊什么，都可以告诉我…").fill("今天有点累");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText("今天有点累", { exact: true })).toBeVisible();
  await expect(page.getByText(/允许自己慢下来/)).toBeVisible();
  await page.goto("/profile");
  await page.getByRole("button", { name: "查看活动" }).first().click();
  await page.getByRole("button", { name: "预约活动" }).click();
  await expect(page.getByRole("button", { name: "取消预约" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "查看活动" }).first().click();
  await expect(page.getByRole("button", { name: "取消预约" })).toBeVisible();
  await page.getByRole("button", { name: "取消预约" }).click();
  await expect(page.getByRole("button", { name: "预约活动" })).toBeVisible();
  await page.goto("/overview");
  await page.getByRole("button", { name: "近 30 天" }).click();
  await expect(page.getByRole("button", { name: "近 30 天" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
test("every page fits narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const route of [
    "dashboard",
    "nutrition",
    "training",
    "companion",
    "profile",
    "overview",
  ]) {
    await page.goto("/" + route);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      route,
    ).toBe(true);
  }
});

test("daily rewards, reminder and exchange survive reload", async ({
  page,
}) => {
  await page.goto("/profile");
  await page.getByRole("button", { name: "签到领 10 积分" }).click();
  await expect(page.getByTestId("points-balance")).toHaveText("330");
  await page.reload();
  await expect(page.getByRole("button", { name: "今日已签到" })).toBeDisabled();
  await page.getByRole("button", { name: "积分好物" }).click();
  await page.getByRole("button", { name: "确认兑换 · 200 积分" }).click();
  await expect(page.getByRole("button", { name: "今日已兑换" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByTestId("points-balance")).toHaveText("130");
  await page.goto("/training");
  await page.getByRole("button", { name: "训练提醒设置" }).click();
  await page.getByLabel("提醒时间").fill("20:30");
  await page.getByRole("button", { name: "保存设置" }).click();
  await page.reload();
  await page.getByRole("button", { name: "训练提醒设置" }).click();
  await expect(page.getByLabel("提醒时间")).toHaveValue("20:30");
});

test("corrupt image cannot be recognized", async ({ page }) => {
  await page.goto("/nutrition");
  await page.getByRole("button", { name: "拍照记录", exact: true }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "bad.png",
      mimeType: "image/png",
      buffer: Buffer.from("not an image"),
    });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "无法读取",
  );
  await expect(page.getByRole("button", { name: "演示识别" })).toBeDisabled();
});

test("blocked storage is visible without breaking the application", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new Error("denied");
    };
  });
  await page.goto("/dashboard");
  await expect(
    page.getByRole("alert").filter({ hasText: "无法保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "喝一杯水" }).click();
  await expect(page.getByTestId("water-value")).toHaveText("1,500");
});

test("an action after Shanghai midnight records the new day before timers refresh", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-18T15:59:59Z") });
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "喝一杯水" })).toBeEnabled();
  await page.clock.setSystemTime(new Date("2026-10-18T16:00:01Z"));
  await page.getByRole("button", { name: "喝一杯水" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("qingyang-health-v1")!).state
            .dailyRecords["2026-10-19"]?.water,
      ),
    )
    .toBe(250);
});
