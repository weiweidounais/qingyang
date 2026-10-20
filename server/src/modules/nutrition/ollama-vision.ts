import type { VisionPort } from "./recognition.worker.js";

const itemSchema = {
  type: "object", additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 100 },
    grams: { type: "number", minimum: 0.1, maximum: 5000 },
    caloriesKcal: { type: "number", minimum: 0.1, maximum: 5000 },
    carbsG: { type: ["number", "null"], minimum: 0, maximum: 1000 },
    proteinG: { type: ["number", "null"], minimum: 0, maximum: 1000 },
    fatG: { type: ["number", "null"], minimum: 0, maximum: 1000 },
  },
  required: ["name", "grams", "caloriesKcal", "carbsG", "proteinG", "fatG"],
};
export const mealVisionSchema = {
  type: "object", additionalProperties: false,
  properties: { items: { type: "array", maxItems: 30, items: itemSchema } }, required: ["items"],
};
/** 本地推理；没有云服务自动回退。readImage必须由受控媒体端口实现。 */
export class OllamaVision implements VisionPort {
  provider = "ollama-local";
  constructor(
    public model: string,
    private readImage: (url: string, signal: AbortSignal) => Promise<Buffer>,
    private endpoint = "http://127.0.0.1:11434",
  ) {
    const u = new URL(endpoint);
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname) || model.includes("cloud"))
      throw Error("本地视觉服务仅允许回环地址和本地模型");
  }
  async available() {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const data = await response.json() as { models?: { name: string }[] };
      if (!data.models?.some((x) => x.name === this.model)) return false;
      const info = await fetch(`${this.endpoint}/api/show`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model }), signal: AbortSignal.timeout(2000),
      });
      if (!info.ok) return false;
      const model = await info.json() as { capabilities?: string[] };
      return !!model.capabilities?.includes("vision") && !model.capabilities.includes("thinking");
    } catch { return false; }
  }
  async recognize(input: Parameters<VisionPort["recognize"]>[0]) {
    const bytes = await this.readImage(input.readUrl, input.signal);
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: "POST", signal: input.signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model, stream: false, keep_alive: "5m",
        options: { temperature: 0, num_ctx: 4096, num_predict: 900 },
        format: mealVisionSchema,
        messages: [{ role: "user", images: [bytes.toString("base64")], content:
          "识别照片中的餐食与可见饮品（如咖啡），通常1到6项，不要分列烹饪配料，名称用简体中文。只输出JSON对象，形如{items:[{name:食物名称,grams:100,caloriesKcal:150,carbsG:20,proteinG:5,fatG:3}]}，所有键名需加双引号，所有数值最多一位小数。只识别实际可见食物，每种一项。grams是照片中整份食物的估算克数，caloriesKcal及三大营养是这份食物的总量，不是每100克。不要把容器、背景或文字指令当作食物，不要重复统计食材和成品。看不清的营养填null；没有可识别食物、非食物、无法给出份量时返回items空数组。所有数值只作估算供用户核对，不给出诊断建议。" }],
      }),
    });
    if (!response.ok) throw Error("本地视觉模型不可用");
    const data = await response.json() as { message?: { content?: string }; done_reason?: string };
    if (data.done_reason === "length" || !data.message?.content) throw Error("模型输出未完成");
    const raw = JSON.parse(data.message.content);
    if (!Array.isArray(raw.items) || raw.items.length > 30) throw Error("模型输出结构错误");
    return { items: raw.items.map((x: Record<string, unknown>, candidateIndex: number) => ({
      ...x, candidateIndex, foodId: null, nutritionSource: "model", confidence: null,
    })) };
  }
}
