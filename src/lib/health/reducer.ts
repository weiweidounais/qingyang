import type { HealthAction, HealthState } from "./types";
import { workouts, activities, restaurants } from "./seed";
export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function balance(s: HealthState) {
  return s.ledger.reduce((n, x) => n + x.points, 0);
}
function reward(
  s: HealthState,
  key: string,
  date: string,
  label: string,
  points: number,
): HealthState {
  return s.ledger.some((x) => x.key === key)
    ? s
    : { ...s, ledger: [...s.ledger, { key, date, label, points }] };
}
export function healthReducer(s: HealthState, a: HealthAction): HealthState {
  switch (a.type) {
    case "restore":
      return a.state;
    case "water": {
      const r = s.dailyRecords[a.date] ?? { water: 0 };
      if (r.water >= 6000) return s;
      return reward(
        {
          ...s,
          dailyRecords: {
            ...s.dailyRecords,
            [a.date]: { ...r, water: r.water + 250 },
          },
        },
        "water:" + a.date,
        a.date,
        "今日饮水记录",
        5,
      );
    }
    case "weight":
      if (!Number.isFinite(a.value) || a.value < 20 || a.value > 350) return s;
      return {
        ...s,
        dailyRecords: {
          ...s.dailyRecords,
          [a.date]: {
            water: s.dailyRecords[a.date]?.water ?? 0,
            weight: a.value,
          },
        },
      };
    case "sign":
      return reward(s, "sign:" + a.date, a.date, "每日签到", 10);
    case "meal": {
      const m = a.meal;
      if (
        !m.name.trim() ||
        m.name.length > 100 ||
        !Number.isFinite(m.calories) ||
        m.calories <= 0 ||
        m.calories > 5000 ||
        !Number.isFinite(m.grams) ||
        m.grams <= 0 ||
        m.grams > 5000 ||
        s.meals.some((x) => x.id === m.id)
      )
        return s;
      return reward(
        { ...s, meals: [...s.meals, m] },
        "meal:" + m.date,
        m.date,
        "今日饮食记录",
        10,
      );
    }
    case "workout": {
      const w = workouts.find((x) => x.id === a.id);
      if (
        !w ||
        s.completedWorkouts.some((x) => x.id === a.id && x.date === a.date)
      )
        return s;
      return reward(
        {
          ...s,
          completedWorkouts: [
            ...s.completedWorkouts,
            { id: a.id, date: a.date, calories: w.calories },
          ],
        },
        `workout:${a.id}:${a.date}`,
        a.date,
        "完成训练 · " + w.name,
        20,
      );
    }
    case "mood":
      return {
        ...s,
        moods: [
          ...s.moods.filter((x) => x.date !== a.date),
          { date: a.date, value: a.value },
        ],
      };
    case "message":
      if (
        !a.text.trim() ||
        a.text.length > 2000 ||
        s.messages.some((x) => x.id === a.id)
      )
        return s;
      return {
        ...s,
        messages: [...s.messages, { id: a.id, role: a.role, text: a.text }],
      };
    case "favorite":
      if (!restaurants.some((x) => x.id === a.id)) return s;
      return {
        ...s,
        favorites: s.favorites.includes(a.id)
          ? s.favorites.filter((x) => x !== a.id)
          : [...s.favorites, a.id],
      };
    case "book":
      return !activities.some((x) => x.id === a.id) || s.bookings.includes(a.id)
        ? s
        : { ...s, bookings: [...s.bookings, a.id] };
    case "cancel":
      return { ...s, bookings: s.bookings.filter((x) => x !== a.id) };
    case "redeem":
      if (
        !Number.isInteger(a.cost) ||
        a.cost <= 0 ||
        balance(s) < a.cost ||
        s.ledger.some((x) => x.key === `redeem:${a.id}:${a.date}`)
      )
        return s;
      return reward(
        s,
        `redeem:${a.id}:${a.date}`,
        a.date,
        "兑换 · 轻养好物（演示）",
        -a.cost,
      );
    case "reminder":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)
        ? { ...s, reminder: { enabled: a.enabled, time: a.time } }
        : s;
    case "goal":
      return Number.isFinite(a.value) && a.value >= 20 && a.value <= 350
        ? { ...s, goal: a.value }
        : s;
  }
}
