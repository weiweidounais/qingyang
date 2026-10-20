export type MealType = "早餐" | "午餐" | "晚餐" | "加餐";
export type FoodDraft = { name: string; grams: number; calories: number };
export type Meal = FoodDraft & { id: string; date: string; meal: MealType };
export type DailyRecord = { water: number; weight?: number };
export type HealthState = {
  dailyRecords: Record<string, DailyRecord>;
  meals: Meal[];
  completedWorkouts: { id: string; date: string; calories: number }[];
  moods: { date: string; value: string }[];
  messages: { id: string; role: "user" | "assistant"; text: string }[];
  favorites: string[];
  bookings: string[];
  ledger: { key: string; date: string; label: string; points: number }[];
  reminder: { enabled: boolean; time: string };
  goal: number;
};
export type HealthAction =
  | { type: "water" | "sign"; date: string }
  | { type: "weight"; date: string; value: number }
  | { type: "meal"; meal: Meal }
  | { type: "workout"; id: string; date: string }
  | { type: "mood"; date: string; value: string }
  | { type: "message"; id: string; role: "user" | "assistant"; text: string }
  | { type: "favorite" | "book" | "cancel"; id: string }
  | { type: "redeem"; id: string; cost: number; date: string }
  | { type: "reminder"; enabled: boolean; time: string }
  | { type: "goal"; value: number }
  | { type: "restore"; state: HealthState };
