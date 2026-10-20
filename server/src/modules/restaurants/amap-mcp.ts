import { createRequire } from "node:module";
import type { RestaurantDto } from "../../../contracts/shared-types.js";
import type { PoiPort } from "./restaurants.service.js";
import { DomainError, fail } from "../nutrition/domain.js";

type Place = Omit<RestaurantDto, "id" | "isFavorited">;
type RpcResult = { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
// gcoord 1.x为CommonJS，显式require避免NodeNext默认导入的类型互操作差异。
const gcoord = createRequire(import.meta.url)("gcoord") as typeof import("gcoord").default;

/** 只调用高德官方MCP；不接收任意URL，不将Key或上游错误返回H5。 */
export class AmapMcpPoi implements PoiPort {
  readonly provider = "amap-mcp";
  // 高德标准协议不允许直接缓存门店数据。0表示实时展示，不落库/收藏。
  readonly cacheTtlSeconds = 0;
  private nextId = 0;
  private session = "";
  private ready = false;
  private searches = 0;
  private windowStart = Date.now();
  private activeSearches = 0;
  constructor(private apiKey: string, private request: typeof fetch = fetch) {
    if (!apiKey.trim() || apiKey.length > 256) throw Error("高德服务端Key配置无效");
  }
  async initialize() {
    await this.rpc("initialize", {
      protocolVersion: "2025-03-26", capabilities: {},
      clientInfo: { name: "qingyang-nutrition", version: "1.0.0" },
    });
    await this.rpc("notifications/initialized", {}, true);
    const result = record(await this.rpc("tools/list", {}));
    const names = Array.isArray(result.tools) ? result.tools.map((x) => record(x).name) : [];
    if (!names.includes("maps_around_search") || !names.includes("maps_search_detail"))
      fail("AMAP_TOOLS_UNAVAILABLE", "高德周边搜索工具暂不可用", 503);
    this.ready = true;
  }
  isReady() { return this.ready; }
  private async rpc(method: string, params: unknown, notification = false): Promise<unknown> {
    const id = ++this.nextId;
    try {
      const response = await this.request(`https://mcp.amap.com/mcp?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20000),
        headers: {
          "Content-Type": "application/json", Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-03-26",
          ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }),
      });
      if (!response.ok) fail("AMAP_UNAVAILABLE", "高德服务暂不可用，请稍后重试", 502);
      this.session = response.headers.get("mcp-session-id") ?? this.session;
      if (notification) { await response.body?.cancel(); return null; }
      const reader = response.body?.getReader();
      if (!reader) throw Error("empty response");
      let raw = "", size = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2 * 1024 * 1024) throw Error("response too large");
          raw += decoder.decode(chunk.value, { stream: true });
          if (response.headers.get("content-type")?.includes("text/event-stream")) {
            for (const event of raw.split(/\r?\n\r?\n/).slice(0, -1)) {
              const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
              if (!data) continue;
              const message = record(JSON.parse(data));
              if (message.id === id) {
                if (message.error || !("result" in message)) throw Error("rpc error");
                return message.result;
              }
            }
          }
        }
        raw += decoder.decode();
        const message = record(JSON.parse(raw));
        if (message.id !== id || message.error || !("result" in message)) throw Error("rpc error");
        return message.result;
      } finally { await reader.cancel().catch(() => {}); }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      fail("AMAP_UNAVAILABLE", "高德查询未完成，请检查网络或稍后重试", 502);
    }
  }
  private async tool(name: "maps_around_search" | "maps_search_detail", args: Record<string, unknown>) {
    const result = record(await this.rpc("tools/call", { name, arguments: args })) as RpcResult;
    if (result.isError) fail("AMAP_QUERY_FAILED", "高德查询失败，请检查Key权限或服务配额", 502);
    let payload: unknown = result.structuredContent;
    if (payload === undefined) payload = result.content?.filter((x) => x.type === "text").map((x) => x.text ?? "").join("\n");
    try {
      for (let i = 0; i < 3 && typeof payload === "string"; i++) payload = JSON.parse(payload);
    } catch { fail("AMAP_INVALID_RESPONSE", "高德返回的数据暂时无法读取", 502); }
    const body = record(payload);
    if (body.status === "0" || body.error || !Object.keys(body).length)
      fail("AMAP_QUERY_FAILED", "高德查询失败，请检查Key权限或服务配额", 502);
    return body;
  }
  async nearby(input: Parameters<PoiPort["nearby"]>[0]) {
    if (!this.ready) fail("AMAP_UNAVAILABLE", "高德服务尚未就绪", 503);
    if (input.cursor !== undefined) fail("INVALID_CURSOR", "高德MCP当前不支持翻页，请调整范围重新搜索");
    if (Date.now() - this.windowStart > 60000) { this.windowStart = Date.now(); this.searches = 0; }
    if (this.activeSearches >= 2 || this.searches >= 12)
      fail("AMAP_RATE_LIMITED", "搜索较频繁，请稍等片刻再试", 429);
    const keywords: Record<string, string> = { "": "餐厅", "轻食": "轻食", "高蛋白": "健身餐", "均衡膳食": "健康餐" };
    if (!Object.hasOwn(keywords, input.tag ?? "")) fail("INVALID_TAG", "请选择支持的餐厅筛选条件");
    this.searches++; this.activeSearches++;
    try {
      const point = gcoord.transform([input.longitude, input.latitude], gcoord.WGS84, gcoord.GCJ02);
      const body = await this.tool("maps_around_search", {
        keywords: keywords[input.tag ?? ""], location: point.map((n) => n.toFixed(6)).join(","), radius: String(input.radiusMeters),
      });
      if (!Array.isArray(body.pois)) fail("AMAP_INVALID_RESPONSE", "高德返回的门店列表无效", 502);
      const ids = [...new Set(body.pois.map(record)
        .filter((p) => string(p.typecode, 20).startsWith("05"))
        .map((p) => string(p.id, 40)).filter((id) => /^[A-Za-z0-9]{5,40}$/.test(id)))].slice(0, Math.min(input.limit, 12));
      const places: (Place | null)[] = new Array(ids.length).fill(null);
      let index = 0, failed = 0;
      // 周边工具未返回坐标；从详情获取坐标，最多4个并发，不将搜索中心伪装为门店位置。
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (index < ids.length) {
          const i = index++;
          try { places[i] = await this.detail(ids[i]); } catch { failed++; }
        }
      }));
      if (ids.length && failed === ids.length) fail("AMAP_DETAIL_UNAVAILABLE", "高德门店详情暂不可用，请稍后重试", 502);
      const items = places.filter((p): p is Place => p !== null).map((place) => ({
        ...place, distanceMeters: distance(input.latitude, input.longitude, place.latitude, place.longitude),
      })).filter((p) => p.distanceMeters <= input.radiusMeters).sort((a, b) => a.distanceMeters - b.distanceMeters);
      return { items, nextCursor: null };
    } finally { this.activeSearches--; }
  }
  async detail(providerPlaceId: string): Promise<Place | null> {
    if (!/^[A-Za-z0-9]{5,40}$/.test(providerPlaceId)) fail("INVALID_PLACE", "门店编号无效");
    const p = await this.tool("maps_search_detail", { id: providerPlaceId });
    if (!p.id) return null;
    if (p.id !== providerPlaceId) fail("AMAP_INVALID_RESPONSE", "高德门店编号不匹配", 502);
    const name = string(p.name, 200), location = string(p.location, 100).split(",");
    const lng = Number(location[0]), lat = Number(location[1]);
    if (!name || location.length !== 2 || !location.every((v) => v.trim()) || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)
      fail("AMAP_INVALID_RESPONSE", "门店缺少有效的位置资料", 502);
    const [longitude, latitude] = gcoord.transform([lng, lat], gcoord.GCJ02, gcoord.WGS84);
    const rawCost = typeof p.cost === "string" && /^\d+(\.\d{1,2})?$/.test(p.cost) ? Number(p.cost) : null;
    return {
      provider: this.provider, providerPlaceId, name, address: string(p.address, 1000) || "地址暂未提供",
      latitude, longitude, coordinateSystem: "wgs84", distanceMeters: null,
      // MCP未声明评分量表，暂不把原始rating映射到统一评分。
      rating: null, ratingScaleMax: null, priceCents: rawCost !== null && rawCost > 0 && rawCost <= 100000 ? Math.round(rawCost * 100) : null,
      currency: "CNY", tags: [], coverUrl: null, nutritionVerified: false, estimatedCaloriesKcal: null,
      status: "available", sourceUpdatedAt: new Date().toISOString(),
    };
  }
}
function distance(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (x: number) => x * Math.PI / 180;
  const a = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))));
}
