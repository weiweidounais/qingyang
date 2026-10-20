import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  FoodItemInput,
  MealTotals,
  MealType,
  Instant,
} from "../../../contracts/shared-types.js";

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export function fail(code: string, message: string, status = 422): never {
  throw new DomainError(code, message, status);
}
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    fail("INVALID_UUID", "编号格式不正确");
  return value as string;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_INPUT", "请提交完整的表单内容");
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((k) => !allowed.includes(k)))
    fail("UNKNOWN_FIELD", "提交内容包含不允许的字段");
}
export function text(value: unknown, max: number, label = "名称"): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value.trim()].length > max
  )
    fail("INVALID_INPUT", `${label}需填写1—${max}个字`);
  return (value as string).trim();
}
export function decimal(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    Math.abs(value * 10 - Math.round(value * 10)) > 1e-7
  )
    fail("INVALID_INPUT", `${label}范围为${min}—${max}，最多1位小数`);
  return value as number;
}
export const round = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
export const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
export function mealType(value: unknown): MealType {
  if (!mealTypes.includes(value as MealType))
    fail("INVALID_MEAL_TYPE", "请选择早餐、午餐、晚餐或加餐");
  return value as MealType;
}
export function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    fail("INVALID_DATE", "日期格式不正确");
  return value as string;
}
export const businessDate = (instant: string | Date) =>
  new Date(new Date(instant).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
export function recordedAt(value: unknown, now: string): Instant {
  if (value === undefined) return now;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("INVALID_TIME", "记录时间必须包含时区");
  const n = new Date(value as string);
  date((value as string).slice(0, 10));
  const earliest =
    new Date(`${businessDate(now)}T00:00:00+08:00`).getTime() - 30 * 86400000;
  if (n.getTime() < earliest || n.getTime() > Date.parse(now))
    fail("INVALID_TIME", "可记录现在至过去30天，不能记录未来时间");
  return n.toISOString();
}
export function foodInputs(
  value: unknown,
  allowModel: boolean,
): FoodItemInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30)
    fail("INVALID_ITEMS", "一餐需包含1—30项食物");
  return (value as unknown[]).map((v) => {
    const x = object(v);
    if (x.nutritionSource === "catalog") {
      keys(x, ["nutritionSource", "foodId", "grams"]);
      return {
        nutritionSource: "catalog",
        foodId: uuid(x.foodId),
        grams: decimal(x.grams, 0.1, 5000, "份量"),
      };
    }
    if (x.nutritionSource === "model" && allowModel) {
      keys(x, ["nutritionSource", "candidateIndex"]);
      if (
        !Number.isInteger(x.candidateIndex) ||
        (x.candidateIndex as number) < 0 ||
        (x.candidateIndex as number) > 29
      )
        fail("INVALID_CANDIDATE", "识别候选编号不正确");
      return {
        nutritionSource: "model",
        candidateIndex: x.candidateIndex as number,
      };
    }
    if (x.nutritionSource !== "user")
      fail("INVALID_SOURCE", "营养来源不正确，编辑后的内容请按人工填写保存");
    keys(x, [
      "nutritionSource",
      "foodId",
      "name",
      "grams",
      "caloriesKcal",
      "carbsG",
      "proteinG",
      "fatG",
    ]);
    const nutrient = (k: string) =>
      x[k] === null ? null : decimal(x[k], 0, 1000, "营养素");
    return {
      nutritionSource: "user",
      foodId: x.foodId == null ? null : uuid(x.foodId),
      name: text(x.name, 100),
      grams: decimal(x.grams, 0.1, 5000, "份量"),
      caloriesKcal: decimal(x.caloriesKcal, 0.1, 5000, "热量"),
      carbsG: nutrient("carbsG"),
      proteinG: nutrient("proteinG"),
      fatG: nutrient("fatG"),
    };
  });
}
export function totals(
  items: {
    caloriesKcal: number;
    carbsG: number | null;
    proteinG: number | null;
    fatG: number | null;
  }[],
): MealTotals {
  const sum = (key: "carbsG" | "proteinG" | "fatG") =>
    items.some((x) => x[key] === null)
      ? null
      : round(items.reduce((n, x) => n + (x[key] ?? 0), 0));
  return {
    caloriesKcal: round(items.reduce((n, x) => n + x.caloriesKcal, 0)),
    carbsG: sum("carbsG"),
    proteinG: sum("proteinG"),
    fatG: sum("fatG"),
  };
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const bodyHash = (body: unknown) =>
  createHash("sha256").update(canonical(body)).digest("hex");
export class CursorCodec {
  constructor(private secret: string) {}
  encode(value: object, filter: unknown) {
    const payload = Buffer.from(
      JSON.stringify({ value, filter: bodyHash(filter) }),
    ).toString("base64url");
    return `${payload}.${createHmac("sha256", this.secret).update(payload).digest("base64url")}`;
  }
  decode(
    cursor: string | undefined,
    filter: unknown,
  ): Record<string, unknown> | null {
    if (!cursor) return null;
    try {
      const [p, s, extra] = cursor.split(".");
      const expected = createHmac("sha256", this.secret).update(p).digest();
      const actual = Buffer.from(s ?? "", "base64url");
      if (
        extra ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw Error();
      const parsed = JSON.parse(Buffer.from(p, "base64url").toString());
      if (parsed.filter !== bodyHash(filter)) throw Error();
      return object(parsed.value);
    } catch {
      return fail("INVALID_CURSOR", "搜索条件已变化，请从第一页重新查询");
    }
  }
}
