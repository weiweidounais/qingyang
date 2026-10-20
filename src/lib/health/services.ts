import type { FoodDraft } from "./types";
export async function demoRecognize(): Promise<FoodDraft[]> {
  await new Promise((r) => setTimeout(r, 650));
  return [{ name: "鸡胸肉蔬菜沙拉（模拟）", grams: 350, calories: 425 }];
}
export async function demoReply(text: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 650));
  return /累|难|压力|烦/.test(text)
    ? "允许自己慢下来。今天不用把所有事情都做好，先休息一会儿吧。你愿意聊聊，是什么让你觉得累吗？"
    : /吃|餐|饮食/.test(text)
      ? "认真照顾自己，从好好吃饭开始。你可以在「饮食」里记录这一餐，也可以和我聊聊今天吃到了什么喜欢的食物。"
      : "我在这里，听你慢慢说。每一点小小的努力都值得被看见，今天有没有一个让你感觉不错的瞬间？";
}
