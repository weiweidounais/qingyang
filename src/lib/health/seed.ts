import type { HealthState } from "./types";
export const workouts = [
  {
    id: "flow",
    name: "全身舒展 · 唤醒活力",
    category: "拉伸",
    minutes: 15,
    calories: 65,
    level: "新手友好",
    color: "lilac",
    emoji: "🧘🏻‍♀️",
    desc: "舒展肩颈和背部，跟随自己的呼吸，给身体一段轻松的时间。",
  },
  {
    id: "power",
    name: "核心力量 · 稳稳向前",
    category: "力量",
    minutes: 20,
    calories: 120,
    level: "进阶挑战",
    color: "peach",
    emoji: "🏋🏻‍♀️",
    desc: "包含平板支撑、臀桥与核心控制。按自身情况调整强度，随时暂停休息。",
  },
  {
    id: "walk",
    name: "轻快走 · 自由呼吸",
    category: "有氧",
    minutes: 30,
    calories: 160,
    level: "不限基础",
    color: "mint",
    emoji: "🚶🏻‍♀️",
    desc: "穿上舒适的鞋，找一条喜欢的路线，以能轻松说话的速度走一走。",
  },
  {
    id: "stretch",
    name: "睡前放松 · 慢慢入眠",
    category: "拉伸",
    minutes: 10,
    calories: 30,
    level: "轻松放松",
    color: "blue",
    emoji: "🌙",
    desc: "温和拉伸，放慢节奏。动作以舒适为准，不强求幅度。",
  },
];
export const restaurants = [
  {
    id: "green",
    name: "绿意食光 · 轻食厨房",
    tag: "高蛋白",
    distance: "350m",
    rating: "4.8",
    price: 32,
    calories: 425,
    desc: "香煎鸡胸藜麦碗，搭配时蔬与独立酱汁。",
    emoji: "🥗",
  },
  {
    id: "grain",
    name: "谷物日记 · 健康简餐",
    tag: "均衡膳食",
    distance: "680m",
    rating: "4.7",
    price: 38,
    calories: 510,
    desc: "糙米饭、时令蔬菜与豆腐，温热的一餐。",
    emoji: "🍱",
  },
  {
    id: "fresh",
    name: "鲜果与麦 · 早餐工坊",
    tag: "轻盈早餐",
    distance: "1.2km",
    rating: "4.9",
    price: 26,
    calories: 310,
    desc: "燕麦酸奶碗与当季水果，可选择无糖款。",
    emoji: "🥣",
  },
];
export const activities = [
  {
    id: "yoga",
    name: "周末公园 · 一起舒展",
    category: "户外瑜伽",
    time: "周六 09:00–10:00",
    place: "城市公园 · 草坪区",
    people: "已有 8 位伙伴",
    emoji: "🧘🏻‍♀️",
    color: "lilac",
    desc: "带上瑜伽垫，跟着轻松的节奏活动身体。适合初学者，一起享受户外时光。",
  },
  {
    id: "walking",
    name: "下班后，走一小段",
    category: "城市漫步",
    time: "周五 18:30–19:30",
    place: "滨江步道 · 南入口",
    people: "已有 12 位伙伴",
    emoji: "🚶🏻‍♀️",
    color: "mint",
    desc: "以聊天的速度散步，认识同样在意健康生活的朋友。",
  },
];
export function makeSeed(date = "2026-10-18"): HealthState {
  const dailyRecords: HealthState["dailyRecords"] = {};
  const meals: HealthState["meals"] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(date + "T12:00:00+08:00");
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyRecords[key] = {
      water: i ? 1500 + (i % 3) * 250 : 1250,
      weight: Number((58.6 + i * 0.14).toFixed(1)),
    };
    if (i)
      meals.push({
        id: "seed-" + i,
        date: key,
        meal: "午餐",
        name: "均衡饮食示例",
        grams: 400,
        calories: 1300 + i * 25,
      });
  }
  meals.push(
    {
      id: "breakfast",
      date,
      meal: "早餐",
      name: "牛油果鸡蛋全麦吐司",
      grams: 200,
      calories: 380,
    },
    {
      id: "lunch",
      date,
      meal: "午餐",
      name: "香煎鸡胸藜麦沙拉",
      grams: 350,
      calories: 425,
    },
  );
  return {
    dailyRecords,
    meals,
    completedWorkouts: [],
    moods: [],
    messages: [],
    favorites: [],
    bookings: [],
    ledger: [{ key: "welcome", date, label: "新朋友见面礼", points: 320 }],
    reminder: { enabled: true, time: "19:00" },
    goal: 55,
  };
}
