import test from "node:test";
import assert from "node:assert/strict";
import { AmapMcpPoi } from "../../restaurants/amap-mcp.js";

function fixture(mode: "json" | "sse" | "error" = "json") {
  const calls: { method: string; params: any }[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.ok(String(url).startsWith("https://mcp.amap.com/mcp?key="));
    assert.equal(init?.redirect, "error");
    const body = JSON.parse(String(init?.body)); calls.push(body);
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown = {};
    if (body.method === "tools/list") result = { tools: [{ name: "maps_around_search" }, { name: "maps_search_detail" }] };
    if (body.method === "tools/call") {
      const { name, arguments: args } = body.params;
      const payload = name === "maps_around_search"
        ? { pois: [{ id: "B000000001", typecode: "050100" }, { id: "B000000001", typecode: "050100" }, { id: "B000000002", typecode: "170200" }] }
        : { id: args.id, name: "TEST餐厅", address: "TEST地址", location: "121.479574,31.227921", cost: "33.00", rating: "4.6" };
      result = mode === "error" ? { isError: true, content: [{ type: "text", text: "secret-fixture-token INVALID_USER_KEY" }] }
        : { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false };
    }
    const message = { jsonrpc: "2.0", id: body.id, result };
    return mode === "sse"
      ? new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\nevent: message\ndata: ${JSON.stringify(message)}\n\n`, { headers: { "content-type": "text/event-stream" } })
      : Response.json(message);
  };
  return { calls, poi: new AmapMcpPoi("secret-fixture-token", request) };
}
for (const mode of ["json", "sse"] as const) test(`高德MCP ${mode}：初始化、坐标转换、餐饮过滤和未知信息`, async () => {
  const { poi, calls } = fixture(mode);
  await poi.initialize();
  const result = await poi.nearby({ latitude: 31.2304, longitude: 121.4737, radiusMeters: 2000, limit: 20 });
  assert.equal(result.items.length, 1);
  const around = calls.find((c) => c.params?.name === "maps_around_search")!;
  assert.equal(around.params.arguments.keywords, "餐厅");
  const [lng] = around.params.arguments.location.split(",").map(Number);
  assert.ok(lng > 121.477 && lng < 121.479, "GPS中心必须先转换为高德坐标");
  const place = result.items[0];
  assert.ok(place.longitude > 121.474 && place.longitude < 121.477, "高德门店必须转换回统一WGS84");
  assert.equal(place.priceCents, 3300);
  assert.equal(place.rating, null); assert.equal(place.ratingScaleMax, null);
  assert.equal(place.nutritionVerified, false); assert.equal(place.estimatedCaloriesKcal, null);
  assert.ok(place.distanceMeters! < 2000);
  assert.equal(result.nextCursor, null); assert.equal(poi.cacheTtlSeconds, 0);
  assert.equal(calls.filter((c) => c.params?.name === "maps_search_detail").length, 1);
});
test("高德上游错误不暴露Key或伪装为空列表", async () => {
  const { poi } = fixture("error"); await poi.initialize();
  await assert.rejects(poi.nearby({ latitude: 31, longitude: 121, radiusMeters: 2000, limit: 10 }), (e: any) =>
    e.code === "AMAP_QUERY_FAILED" && !e.message.includes("secret-fixture-token"));
});
test("高德查询拒绝未知标签和不存在的翻页参数", async () => {
  const { poi } = fixture(); await poi.initialize();
  const input = { latitude: 31.2304, longitude: 121.4737, radiusMeters: 2000, limit: 10 };
  await assert.rejects(poi.nearby({ ...input, tag: "unknown" }), (e: any) => e.code === "INVALID_TAG");
  await assert.rejects(poi.nearby({ ...input, tag: "__proto__" }), (e: any) => e.code === "INVALID_TAG");
  await assert.rejects(poi.nearby({ ...input, cursor: "2" }), (e: any) => e.code === "INVALID_CURSOR");
});
