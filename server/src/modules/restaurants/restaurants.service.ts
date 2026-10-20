import { randomUUID } from "node:crypto";
import type {
  RestaurantDto,
  SqlTx,
  CommandContext,
} from "../../../contracts/shared-types.js";
import { CursorCodec, fail, keys, text, uuid } from "../nutrition/domain.js";

/** 供应商适配器必须输出wgs84、米、分；共享缓存里不保存用户收藏态。 */
export interface PoiPort {
  provider: string;
  nearby(input: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    tag?: string;
    limit: number;
    cursor?: unknown;
  }): Promise<{
    items: Omit<RestaurantDto, "id" | "isFavorited">[];
    nextCursor: unknown | null;
  }>;
  detail(
    providerPlaceId: string,
  ): Promise<Omit<RestaurantDto, "id" | "isFavorited"> | null>;
  /** 0仅实时展示，禁止落库与收藏；正数要求供应商已授权缓存。 */
  cacheTtlSeconds: number;
}
type Row = Record<string, any>;
export class RestaurantsService {
  constructor(
    private cursors: CursorCodec,
    private poi: PoiPort | null = null,
  ) {}
  private center(q: Record<string, string>) {
    const latitude = Number(q.latitude),
      longitude = Number(q.longitude);
    if (
      q.latitude === undefined ||
      q.longitude === undefined ||
      !q.latitude.trim() ||
      !q.longitude.trim() ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    )
      fail("INVALID_LOCATION", "请选择有效的搜索位置");
    return { latitude, longitude };
  }
  async nearby(tx: SqlTx, userId: string, q: Record<string, string>) {
    keys(q, [
      "latitude",
      "longitude",
      "coordinateSystem",
      "radiusMeters",
      "tag",
      "limit",
      "cursor",
    ]);
    if (q.coordinateSystem !== "wgs84")
      fail("INVALID_COORDINATES", "坐标必须为wgs84");
    const center = this.center(q),
      radiusMeters = Number(q.radiusMeters ?? 2000),
      limit = Number(q.limit ?? 20);
    if (
      !Number.isInteger(radiusMeters) ||
      radiusMeters < 100 ||
      radiusMeters > 5000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      fail("INVALID_SEARCH", "搜索半径为100—5000米，每页1—50条");
    const tag = q.tag === undefined ? undefined : text(q.tag, 50, "筛选标签");
    const filter = {
      userId,
      ...center,
      radiusMeters,
      tag: tag ?? null,
      provider: this.poi?.provider ?? null,
    };
    const c = this.cursors.decode(q.cursor, filter);
    if (!this.poi)
      fail(
        "POI_NOT_CONFIGURED",
        "附近餐饮服务尚未接入，暂时无法获取真实门店",
        503,
      );
    // 地图网络调用必须由HTTP适配层在事务外执行，返回结果再通过cacheResult落库。
    return {
      input: { ...center, radiusMeters, tag, limit, cursor: c?.providerCursor },
      filter,
    };
  }
  async search(
    userId: string,
    q: Record<string, string>,
    read: <T>(fn: (tx: SqlTx) => Promise<T>) => Promise<T>,
    write: <T>(fn: (tx: SqlTx) => Promise<T>) => Promise<T>,
  ) {
    const { input, filter } = await read((tx) => this.nearby(tx, userId, q));
    const result = await this.poi!.nearby(input);
    const items = this.poi!.cacheTtlSeconds === 0
      ? result.items.map((place) => {
          if (place.provider !== this.poi!.provider || place.coordinateSystem !== "wgs84")
            fail("INVALID_POI_OUTPUT", "门店来源或坐标系无效", 502);
          return { ...place, id: randomUUID(), isFavorited: false };
        })
      : await write(async (tx) => {
      const list: RestaurantDto[] = [];
      for (const place of result.items) {
        const id = await this.cacheResult(tx, place);
        list.push(
          await this.get(tx, userId, id, {
            latitude: String(input.latitude),
            longitude: String(input.longitude),
          }),
        );
      }
      return list;
    });
    return {
      items,
      nextCursor:
        result.nextCursor === null
          ? null
          : this.cursors.encode({ providerCursor: result.nextCursor }, filter),
      searchCenter: {
        latitude: input.latitude,
        longitude: input.longitude,
        coordinateSystem: "wgs84",
      },
      provider: this.poi!.provider,
      generatedAt: new Date().toISOString(),
    };
  }
  private async cacheResult(
    tx: SqlTx,
    r: Omit<RestaurantDto, "id" | "isFavorited">,
  ) {
    if (
      r.provider !== this.poi!.provider ||
      r.coordinateSystem !== "wgs84" ||
      this.poi!.cacheTtlSeconds <= 0
    )
      fail(
        "POI_CACHE_NOT_ALLOWED",
        "当前供应商未授权门店缓存，需先确认收藏所需的数据许可",
        503,
      );
    if (
      !Number.isFinite(r.latitude) ||
      !Number.isFinite(r.longitude) ||
      Math.abs(r.latitude) > 90 ||
      Math.abs(r.longitude) > 180
    )
      fail("INVALID_POI_OUTPUT", "门店坐标无效", 502);
    if (
      (r.rating === null) !== (r.ratingScaleMax === null) ||
      (r.rating !== null &&
        (r.rating < 0 ||
          r.ratingScaleMax! <= 0 ||
          r.rating > r.ratingScaleMax!))
    )
      fail("INVALID_POI_OUTPUT", "门店评分缺少有效量表", 502);
    const [old] = await tx.query<Row>(
      "SELECT id FROM restaurants WHERE provider=? AND provider_place_id=?",
      [r.provider, r.providerPlaceId],
    );
    const id = old?.id ?? randomUUID();
    await tx.execute(
      "INSERT INTO restaurants (id,provider,provider_place_id,name,address,latitude,longitude,rating,rating_scale_max,price_cents,tags,cover_url,nutrition_verified,estimated_calories_kcal,status,source_updated_at,cache_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),address=VALUES(address),latitude=VALUES(latitude),longitude=VALUES(longitude),rating=VALUES(rating),rating_scale_max=VALUES(rating_scale_max),price_cents=VALUES(price_cents),tags=VALUES(tags),cover_url=VALUES(cover_url),nutrition_verified=VALUES(nutrition_verified),estimated_calories_kcal=VALUES(estimated_calories_kcal),status=VALUES(status),source_updated_at=VALUES(source_updated_at),cache_expires_at=VALUES(cache_expires_at)",
      [
        id,
        r.provider,
        r.providerPlaceId,
        r.name,
        r.address,
        r.latitude,
        r.longitude,
        r.rating,
        r.ratingScaleMax,
        r.priceCents,
        JSON.stringify(r.tags),
        r.coverUrl,
        r.nutritionVerified ? 1 : 0,
        r.estimatedCaloriesKcal,
        r.status,
        new Date(r.sourceUpdatedAt),
        new Date(Date.now() + this.poi!.cacheTtlSeconds * 1000),
      ],
    );
    return id;
  }
  private map(
    r: Row,
    center?: { latitude: number; longitude: number },
  ): RestaurantDto {
    const lat = Number(r.latitude),
      lng = Number(r.longitude);
    const radians = (n: number) => (n * Math.PI) / 180;
    const a = center
      ? Math.sin(radians(lat - center.latitude) / 2) ** 2 +
        Math.cos(radians(center.latitude)) *
          Math.cos(radians(lat)) *
          Math.sin(radians(lng - center.longitude) / 2) ** 2
      : null;
    return {
      id: r.id,
      provider: r.provider,
      providerPlaceId: r.provider_place_id,
      name: r.name,
      address: r.address,
      latitude: lat,
      longitude: lng,
      coordinateSystem: "wgs84",
      distanceMeters:
        a === null
          ? null
          : Math.round(
              6371000 *
                2 *
                Math.atan2(Math.sqrt(a), Math.sqrt(1 - Math.min(1, a))),
            ),
      rating: r.rating == null ? null : Number(r.rating),
      ratingScaleMax:
        r.rating_scale_max == null ? null : Number(r.rating_scale_max),
      priceCents: r.price_cents,
      currency: "CNY",
      tags: typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags,
      coverUrl: r.cover_url,
      nutritionVerified: r.nutrition_verified === 1,
      estimatedCaloriesKcal:
        r.estimated_calories_kcal == null
          ? null
          : Number(r.estimated_calories_kcal),
      isFavorited: !!r.favorited,
      status: r.status,
      sourceUpdatedAt: new Date(r.source_updated_at).toISOString(),
    };
  }
  async get(
    tx: SqlTx,
    userId: string,
    id: string,
    q: Record<string, string> = {},
  ) {
    keys(q, ["latitude", "longitude"]);
    const center =
      q.latitude !== undefined || q.longitude !== undefined
        ? this.center(q)
        : undefined;
    const [r] = await tx.query<Row>(
      "SELECT r.*,EXISTS(SELECT 1 FROM restaurant_favorites f WHERE f.restaurant_id=r.id AND f.user_id=?) favorited FROM restaurants r WHERE r.id=?",
      [userId, uuid(id)],
    );
    if (!r) fail("NOT_FOUND", "门店不存在", 404);
    return this.map(r, center);
  }
  async favorites(tx: SqlTx, userId: string, q: Record<string, string>) {
    keys(q, ["limit", "cursor"]);
    const limit = Number(q.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      fail("INVALID_LIMIT", "每页数量为1—100");
    const filter = { type: "favorites", userId };
    const c = this.cursors.decode(q.cursor, filter);
    const rows = await tx.query<Row>(
      `SELECT r.*,f.id favorite_id,f.created_at favorite_at,1 favorited FROM restaurant_favorites f JOIN restaurants r ON r.id=f.restaurant_id WHERE f.user_id=?${c ? " AND (f.created_at < ? OR (f.created_at=? AND f.id < ?))" : ""} ORDER BY f.created_at DESC,f.id DESC LIMIT ?`,
      [
        userId,
        ...(c
          ? [new Date(String(c.at)), new Date(String(c.at)), uuid(c.id)]
          : []),
        limit + 1,
      ],
    );
    const last = rows.slice(0, limit).at(-1);
    return {
      items: rows.slice(0, limit).map((r) => this.map(r)),
      nextCursor:
        rows.length > limit && last
          ? this.cursors.encode(
              {
                id: last.favorite_id,
                at: new Date(last.favorite_at).toISOString(),
              },
              filter,
            )
          : null,
    };
  }
  async favorite(tx: SqlTx, ctx: CommandContext, id: string, add: boolean) {
    uuid(id);
    if (add) {
      const r = await this.get(tx, ctx.userId, id);
      if (r.status !== "available")
        fail("RESTAURANT_UNAVAILABLE", "这家门店暂不可用，不能新增收藏", 409);
      await tx.execute(
        "INSERT INTO restaurant_favorites (id,user_id,restaurant_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE restaurant_id=VALUES(restaurant_id)",
        [randomUUID(), ctx.userId, id],
      );
    } else
      await tx.execute(
        "DELETE FROM restaurant_favorites WHERE user_id=? AND restaurant_id=?",
        [ctx.userId, id],
      );
    return add ? { restaurantId: id, isFavorited: true } : null;
  }
}
