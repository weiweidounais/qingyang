import type { HealthState } from "./types";
import { makeSeed } from "./seed";
import { shanghaiDate } from "./reducer";
export const STORAGE_KEY = "qingyang-health-v1";
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown) => typeof v === "string";
function valid(s: unknown): s is HealthState {
  if (
    !obj(s) ||
    !obj(s.dailyRecords) ||
    !obj(s.reminder) ||
    typeof s.reminder.enabled !== "boolean" ||
    !str(s.reminder.time) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.reminder.time as string) ||
    !num(s.goal)
  )
    return false;
  if (
    !Object.values(s.dailyRecords).every(
      (r) =>
        obj(r) && num(r.water) && (r.weight === undefined || num(r.weight)),
    )
  )
    return false;
  const checks: Record<string, (v: unknown) => boolean> = {
    meals: (v) =>
      obj(v) &&
      ["id", "date", "meal", "name"].every((k) => str(v[k])) &&
      ["早餐", "午餐", "晚餐", "加餐"].includes(v.meal as string) &&
      num(v.grams) &&
      num(v.calories),
    completedWorkouts: (v) =>
      obj(v) && str(v.id) && str(v.date) && num(v.calories),
    moods: (v) => obj(v) && str(v.date) && str(v.value),
    messages: (v) =>
      obj(v) &&
      str(v.id) &&
      ["user", "assistant"].includes(v.role as string) &&
      str(v.text),
    favorites: str,
    bookings: str,
    ledger: (v) =>
      obj(v) &&
      ["key", "date", "label"].every((k) => str(v[k])) &&
      num(v.points),
  };
  return Object.entries(checks).every(
    ([key, check]) =>
      Array.isArray(s[key]) && (s[key] as unknown[]).every(check),
  );
}
export function readState(storage: Pick<Storage, "getItem">): {
  state: HealthState;
  warning?: string;
} {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: makeSeed(shanghaiDate()) };
    const data: unknown = JSON.parse(raw);
    if (!obj(data) || data.version !== 1 || !valid(data.state))
      throw Error("invalid");
    return { state: data.state };
  } catch {
    return {
      state: makeSeed(shanghaiDate()),
      warning: "本地记录未能恢复，已载入演示数据。",
    };
  }
}
export function writeState(
  storage: Pick<Storage, "setItem">,
  state: HealthState,
): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state }));
    return true;
  } catch {
    return false;
  }
}
