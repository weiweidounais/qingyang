"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MapPin,
  Navigation,
  Heart,
  Store,
  Star,
  LoaderCircle,
  Search,
} from "lucide-react";
import { Dialog } from "./dialog";
import { useDeviceLocation, type DeviceFix } from "./use-device-location";
import {
  messageOf,
  type Capabilities,
  type NutritionClient,
  type RestaurantDto,
} from "./api";
type Center = { latitude: number; longitude: number; name: string };
// 主动选择的近似城市中心，不是用户位置事实。
const centers: Center[] = [
  { name: "上海市中心", latitude: 31.2304, longitude: 121.4737 },
  { name: "北京市中心", latitude: 39.9042, longitude: 116.4074 },
  { name: "广州市中心", latitude: 23.1291, longitude: 113.2644 },
  { name: "杭州市中心", latitude: 30.2741, longitude: 120.1551 },
];
export function Nearby({
  client,
  capabilities,
  userId,
}: {
  client: NutritionClient;
  capabilities: Capabilities;
  userId: string;
}) {
  const [tab, setTab] = useState<"nearby" | "favorites">("nearby"),
    [center, setCenter] = useState<Center | null>(null),
    [radius, setRadius] = useState(2000),
    [tag, setTag] = useState("");
  const [items, setItems] = useState<RestaurantDto[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<RestaurantDto | null>(null),
    [favoriteBusy, setFavoriteBusy] = useState("");
  const controller = useRef<AbortController | null>(null),
    generation = useRef(0);
  const liveAmap = capabilities.poiProvider === "amap-mcp";
  const deviceCenter = useCallback((fix: DeviceFix | null) => {
    setCenter((old) => fix ? { latitude: fix.latitude, longitude: fix.longitude, name: "当前位置" } : old?.name === "当前位置" ? null : old);
  }, []);
  const location = useDeviceLocation(deviceCenter, userId, capabilities.poi);
  useEffect(() => { if (tab !== "nearby") location.stop(); }, [tab, location.stop]);
  const load = useCallback(
    async (after?: string) => {
      controller.current?.abort();
      const c = new AbortController();
      controller.current = c;
      const gen = ++generation.current;
      setBusy(true);
      setError("");
      if (!after) {
        setItems([]);
        setCursor(null);
      }
      try {
        if (tab === "nearby" && (!capabilities.poi || !center)) return;
        const page =
          tab === "favorites"
            ? await client.favorites(after, c.signal)
            : await client.nearby(
                {
                  ...center!,
                  radiusMeters: radius,
                  tag: tag || undefined,
                  cursor: after,
                },
                c.signal,
              );
        if (gen !== generation.current) return;
        setItems((old) =>
          after
            ? [
                ...old,
                ...page.items.filter((x) => !old.some((y) => y.id === x.id)),
              ]
            : page.items,
        );
        setCursor(page.nextCursor);
      } catch (e) {
        if (!c.signal.aborted && gen === generation.current)
          setError(messageOf(e));
      } finally {
        if (gen === generation.current) setBusy(false);
      }
    },
    [client, tab, center, radius, tag, capabilities.poi],
  );
  useEffect(() => {
    setDetail(null);
    void load();
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [load, userId]);
  async function favorite(r: RestaurantDto) {
    if (favoriteBusy) return;
    setFavoriteBusy(r.id);
    setError("");
    try {
      await client.favorite(r.id, !r.isFavorited);
      const updated = { ...r, isFavorited: !r.isFavorited };
      setItems((old) =>
        tab === "favorites" && r.isFavorited
          ? old.filter((x) => x.id !== r.id)
          : old.map((x) => (x.id === r.id ? updated : x)),
      );
      setDetail((d) => (d?.id === r.id ? updated : d));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setFavoriteBusy("");
    }
  }
  async function openDetail(r: RestaurantDto) {
    setError("");
    try {
      // 高德实时查询已补齐详情；临时展示编号不用于缓存或收藏。
      setDetail(r.provider === "amap-mcp" ? r : await client.restaurant(r.id));
    } catch (e) {
      setError(messageOf(e));
    }
  }
  return (
    <section className="nt-nearby" id="nearby">
      <div className="nt-section-title">
        <div>
          <span className="nt-eyebrow">好好吃饭，也可以很方便</span>
          <h2>附近，也有好食光</h2>
        </div>
        <div className="nt-segment">
          <button
            aria-pressed={tab === "nearby"}
            className={tab === "nearby" ? "active" : ""}
            onClick={() => setTab("nearby")}
          >
            <MapPin size={15} /> 附近餐饮
          </button>
          <button
            aria-pressed={tab === "favorites"}
            className={tab === "favorites" ? "active" : ""}
            onClick={() => setTab("favorites")}
          >
            <Heart size={15} /> 我的收藏
          </button>
        </div>
      </div>
      {tab === "nearby" && (
        <>
          {liveAmap && (
            <p className="nt-hint">
              门店信息由高德地图实时提供。查询时会将搜索中心坐标发送给高德；筛选按关键词匹配，不代表营养认证。当前仅供查看，收藏暂不可用。
            </p>
          )}
          <div className="nt-location-bar">
            <button
              className="outline-button"
              disabled={location.locating || !capabilities.poi}
              onClick={location.start}
            >
              <Navigation size={16} />{" "}
              {location.locating ? "正在获取设备位置" : location.watching ? "重新定位" : "使用实时定位"}
            </button>
            <label>
              <span className="nt-sr-only">手动选择搜索中心</span>
              <select
                aria-label="手动选择搜索中心"
                value={center && center.name !== "当前位置" ? center.name : ""}
                onChange={(e) => {
                  location.stop();
                  setCenter(
                    centers.find((c) => c.name === e.target.value) ?? null,
                  );
                }}
              >
                <option value="">或选择城市中心</option>
                {centers.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="nt-sr-only">搜索范围</span>
              <select
                aria-label="搜索范围"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              >
                <option value={1000}>附近1公里</option>
                <option value={2000}>附近2公里</option>
                <option value={5000}>附近5公里</option>
              </select>
            </label>
          </div>
          <p className="nt-hint" role="status" aria-live="polite">
            {location.fix && center?.name === "当前位置"
              ? `设备实时定位 · 浏览器报告精度约${Math.ceil(location.fix.accuracy)}米 · 更新于${new Date(location.fix.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}。移动超过100米且间隔至少15秒时更新附近门店。`
              : center ? `正在搜索：${center.name}（手动选择，非你的实时位置）` : "尚未取得设备位置。请点击实时定位并允许授权，或手动选择城市。"}
          </p>
          {location.watching && <button className="text-link" onClick={location.stop}>{location.locating ? "取消定位" : "停止实时定位"}</button>}
          {(location.watching || location.error) && (
            <p className="nt-hint">网站定位授权：{location.permission === "granted" ? "已允许" : location.permission === "denied" ? "已拒绝" : location.permission === "prompt" ? "等待确认" : "浏览器未提供状态"}。系统对浏览器的定位权限仍需单独开启。</p>
          )}
          {location.error && (
            <p className="nt-hint" role="status">
              {location.error}{" "}<a className="text-link" href="/dev/mobile-setup" target="_blank" rel="noopener noreferrer">手机HTTPS设置</a>
            </p>
          )}
          <div className="nt-filters" aria-label="餐厅筛选">
            {["", "高蛋白", "均衡膳食", "轻食"].map((t) => (
              <button
                key={t}
                className={tag === t ? "active" : ""}
                aria-pressed={tag === t}
                onClick={() => setTag(t)}
              >
                {t || "全部"}
              </button>
            ))}
          </div>
        </>
      )}
      {tab === "favorites" && capabilities.poiFavorites === false && (
        <p className="nt-hint">高德门店目前仅实时展示，暂不支持收藏。</p>
      )}
      {error && (
        <div className="nt-error" role="alert">
          {error}
          <button className="text-link" onClick={() => load()}>
            重新加载
          </button>
        </div>
      )}
      {busy && !items.length ? (
        <div className="nt-empty">
          <LoaderCircle size={26} className="nt-spin" />
          <p>正在寻找好食光…</p>
        </div>
      ) : tab === "nearby" && !capabilities.poi ? (
        <div className="nt-empty nt-map-empty">
          <div className="nt-empty-icon mint">
            <MapPin size={28} />
          </div>
          <h3>真实的好食光，稍后见</h3>
          <p>
            附近餐饮服务尚未接入，暂时无法显示真实门店。
            <br />
            接入后可按位置查找、查看详情并收藏。
          </p>
          <span className="nt-status-pill">地图服务待接入</span>
        </div>
      ) : !items.length && !error ? (
        <div className="nt-empty">
          <div className="nt-empty-icon">
            {tab === "favorites" ? <Heart size={25} /> : <Search size={25} />}
          </div>
          <h3>
            {tab === "favorites"
              ? "把喜欢的店，留在这里"
              : center
                ? "附近还没有匹配结果"
                : "从你的位置出发"}
          </h3>
          <p>
            {tab === "favorites"
              ? "收藏的餐厅会在这里显示。"
              : center
                ? "试试扩大范围或调整筛选条件。"
                : "允许定位，或选择一个城市中心开始搜索。"}
          </p>
        </div>
      ) : (
        <div className="nt-restaurant-grid">
          {items.map((r) => (
            <article className="nt-restaurant" key={r.id}>
              <button
                className="nt-restaurant-open"
                onClick={() => openDetail(r)}
              >
                {r.coverUrl ? (
                  <img src={r.coverUrl} alt={r.name} />
                ) : (
                  <div className="nt-restaurant-placeholder">
                    <Store size={32} />
                  </div>
                )}
                <div>
                  <h3>{r.name}</h3>
                  <p>{r.address}</p>
                  <div className="nt-restaurant-meta">
                    {r.rating !== null ? (
                      <span>
                        <Star size={13} /> {r.rating}/{r.ratingScaleMax}
                      </span>
                    ) : (
                      <span>暂无评分</span>
                    )}
                    <span>
                      {r.distanceMeters === null
                        ? ""
                        : r.distanceMeters < 1000
                          ? `直线${r.distanceMeters}米`
                          : `直线${(r.distanceMeters / 1000).toFixed(1)}公里`}
                    </span>
                    <span>
                      {r.priceCents === null
                        ? "价格未知"
                        : `参考 ¥${(r.priceCents / 100).toFixed(0)}`}
                    </span>
                  </div>
                  <span className="nt-hint">
                    {r.status === "unavailable"
                      ? "门店暂不可用"
                      : r.estimatedCaloriesKcal === null
                        ? "暂无可靠营养信息"
                        : `来源估算 ${r.estimatedCaloriesKcal}千卡`}
                  </span>
                </div>
              </button>
              <button
                className={`nt-favorite ${r.isFavorited ? "active" : ""}`}
                aria-label={`${r.isFavorited ? "取消收藏" : "收藏"}${r.name}`}
                disabled={
                  (r.provider === "amap-mcp" && !r.isFavorited) || !!favoriteBusy ||
                  (!r.isFavorited && r.status === "unavailable")
                }
                onClick={() => favorite(r)}
              >
                <Heart
                  size={18}
                  fill={r.isFavorited ? "currentColor" : "none"}
                />
              </button>
            </article>
          ))}
        </div>
      )}
      {cursor && (
        <button
          className="outline-button nt-load-more"
          disabled={busy}
          onClick={() => load(cursor)}
        >
          {busy ? "正在加载" : "查看更多"}
        </button>
      )}
      <Dialog
        open={!!detail}
        title={detail?.name ?? "餐厅详情"}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <div className="nt-service-note">
              <MapPin size={20} />
              <div>
                <strong>{detail.address}</strong>
                <p>
                  {detail.status === "unavailable"
                    ? "这家门店暂不可用，仍可取消收藏。"
                    : "门店资料来自地图服务，实际情况以门店为准。"}
                </p>
              </div>
            </div>
            <div className="nt-detail-grid">
              <p>
                评分
                <strong>
                  {detail.rating === null
                    ? "未知"
                    : `${detail.rating}/${detail.ratingScaleMax}`}
                </strong>
              </p>
              <p>
                参考价格
                <strong>
                  {detail.priceCents === null
                    ? "未知"
                    : `¥${detail.priceCents / 100}`}
                </strong>
              </p>
              <p>
                营养信息
                <strong>
                  {detail.estimatedCaloriesKcal === null
                    ? "未知"
                    : `${detail.estimatedCaloriesKcal}千卡（估算）`}
                </strong>
              </p>
            </div>
            {error && (
              <p className="nt-error" role="alert">
                {error}
              </p>
            )}
            {detail.provider === "amap-mcp" && (
              <a className="outline-button full-width" target="_blank" rel="noopener noreferrer"
                href={`https://uri.amap.com/marker?${new URLSearchParams({ poiid: detail.providerPlaceId, src: "qingyang-health", callnative: "1" })}`}>
                <Navigation size={16} /> 在高德地图查看
              </a>
            )}
            <button
              className="primary-button full-width"
              disabled={
                (detail.provider === "amap-mcp" && !detail.isFavorited) || !!favoriteBusy ||
                (!detail.isFavorited && detail.status === "unavailable")
              }
              onClick={() => favorite(detail)}
            >
              <Heart size={16} />{" "}
              {detail.provider === "amap-mcp" ? "高德门店暂不支持收藏" : detail.isFavorited ? "取消收藏" : "收藏这家店"}
            </button>
          </>
        )}
      </Dialog>
    </section>
  );
}
