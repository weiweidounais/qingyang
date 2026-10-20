import { operationKey as newOperationKey } from "./keys";
import { photoChecksum } from "./sha256";
import type {
  CreateMealInput,
  UpdateMealInput,
  MealDto,
  FoodItemDraft,
  RecognitionJobDto,
  RestaurantDto,
  CursorPage,
} from "../../../server/contracts/shared-types";
export type {
  MealDto,
  MealType,
  FoodItemDraft,
  RestaurantDto,
  FoodItemInput,
} from "../../../server/contracts/shared-types";
export type CatalogFood = {
  id: string;
  name: string;
  unit: "100g";
  caloriesKcal: number;
  carbsG: number | null;
  proteinG: number | null;
  fatG: number | null;
};
export type Capabilities = {
  mode: "local_fixture" | "integrated";
  upload: boolean;
  recognition: boolean;
  poi: boolean;
  poiProvider?: string | null;
  poiFavorites?: boolean;
  points: boolean;
  dashboard: boolean;
};
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}
/** M01装配时可注入其统一请求器；此适配器只服务M03，不维护第二份全局登录态。 */
export interface NutritionTransport {
  request<T>(
    path: string,
    init?: RequestInit & { operationKey?: string },
  ): Promise<T>;
}
export class SameOriginTransport implements NutritionTransport {
  private csrf = "";
  async request<T>(
    path: string,
    init: RequestInit & { operationKey?: string } = {},
  ): Promise<T> {
    const { operationKey, ...options } = init;
    if (options.method && options.method !== "GET" && !this.csrf)
      this.csrf = (
        await this.request<{ csrfToken: string }>("/auth/csrf")
      ).csrfToken;
    const headers = new Headers(options.headers);
    headers.set("X-Client-Platform", "h5");
    if (options.body) headers.set("Content-Type", "application/json");
    if (options.method && options.method !== "GET") {
      headers.set("X-CSRF-Token", this.csrf);
      headers.set("Idempotency-Key", operationKey ?? newOperationKey());
    }
    const res = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
    if (res.status === 204) return undefined as T;
    let data;
    try {
      data = await res.json();
    } catch {
      throw new ApiError(
        "API_UNAVAILABLE",
        "服务暂未启动，请稍后重试",
        res.status,
      );
    }
    if (!res.ok) {
      if (res.status === 403) this.csrf = "";
      throw new ApiError(
        data.error?.code ?? "API_ERROR",
        data.error?.message ?? "暂时无法完成，请稍后重试",
        res.status,
      );
    }
    return data.data as T;
  }
}
export const abortDelay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted)
      return reject(new DOMException("Aborted", "AbortError"));
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
export const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "暂时无法完成，请稍后重试";
export class NutritionClient {
  constructor(
    public transport: NutritionTransport = new SameOriginTransport(),
  ) {}
  capabilities(signal?: AbortSignal) {
    return this.transport.request<Capabilities>("/__dev/capabilities", { signal });
  }
  async initialize(signal?: AbortSignal) {
    let capabilities: Capabilities;
    try {
      capabilities = await this.capabilities(signal);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) throw e;
      capabilities = {
        mode: "integrated",
        upload: false,
        recognition: false,
        poi: false,
        points: true,
        dashboard: true,
      };
    }
    // 生产能力由M01装配端显式注入，不能仅因接口存在就推测服务可用。
    let me: { userId: string; nickname: string };
    try {
      me = await this.transport.request("/me", { signal });
    } catch (e) {
      if (
        capabilities.mode !== "local_fixture" ||
        !(e instanceof ApiError) ||
        e.status !== 401
      )
        throw e;
      me = await this.selectFixture("a");
    }
    return { capabilities, me };
  }
  selectFixture(fixture: "a" | "b") {
    return this.transport.request<{ userId: string; nickname: string }>(
      "/__dev/session",
      { method: "POST", body: JSON.stringify({ fixture }) },
    );
  }
  async meals(date: string, signal?: AbortSignal): Promise<MealDto[]> {
    const items: MealDto[] = [];
    let cursor: string | null = null;
    do {
      const page: CursorPage<MealDto> = await this.transport.request(
        `/me/meals?date=${date}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      );
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && !signal?.aborted);
    return items;
  }
  foods(keyword: string, signal?: AbortSignal) {
    return this.transport.request<CursorPage<CatalogFood>>(
      `/foods?limit=100${keyword.trim() ? `&keyword=${encodeURIComponent(keyword.trim())}` : ""}`,
      { signal },
    );
  }
  meal(id: string, signal?: AbortSignal) {
    return this.transport.request<MealDto>(`/me/meals/${id}`, { signal });
  }
  save(input: CreateMealInput, key: string) {
    return this.transport.request<{ meal: MealDto; awards: unknown[] }>(
      "/me/meals",
      { method: "POST", operationKey: key, body: JSON.stringify(input) },
    );
  }
  update(id: string, input: UpdateMealInput, key: string) {
    return this.transport.request<MealDto>(`/me/meals/${id}`, {
      method: "PATCH",
      operationKey: key,
      body: JSON.stringify(input),
    });
  }
  remove(id: string, key: string) {
    return this.transport.request<void>(`/me/meals/${id}`, {
      method: "DELETE",
      operationKey: key,
    });
  }
  job(id: string, signal?: AbortSignal) {
    return this.transport.request<RecognitionJobDto>(
      `/me/recognition-jobs/${id}`,
      { signal },
    );
  }
  createJob(assetId: string, key: string, signal?: AbortSignal) {
    return this.transport.request<{
      id: string;
      status: string;
      pollAfterMs: number;
    }>("/me/recognition-jobs", {
      method: "POST",
      operationKey: key,
      body: JSON.stringify({ assetId }),
      signal,
    });
  }
  cancelJob(id: string) {
    return this.transport.request<{ id: string; status: string }>(
      `/me/recognition-jobs/${id}/cancel`,
      { method: "POST" },
    );
  }
  async upload(
    file: File,
    key: string,
    signal: AbortSignal,
    progress: (message: string) => void,
  ): Promise<string> {
    const checksumSha256 = await photoChecksum(await file.arrayBuffer());
    progress("准备上传");
    const signed = await this.transport.request<{
      assetId: string;
      method: string;
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
      maxSizeBytes: number;
    }>("/uploads/presign", {
      method: "POST",
      operationKey: key,
      body: JSON.stringify({
        purpose: "meal_photo",
        filename: file.name.slice(0, 150),
        contentType: file.type,
        sizeBytes: file.size,
        checksumSha256,
      }),
      signal,
    });
    if (file.size > signed.maxSizeBytes)
      throw new ApiError("FILE_TOO_LARGE", "照片超过上传服务的大小限制");
    progress("上传照片");
    const response = await fetch(signed.uploadUrl, {
      method: signed.method,
      headers: signed.requiredHeaders,
      body: file,
      credentials: "omit",
      signal,
    });
    if (!response.ok)
      throw new ApiError("UPLOAD_FAILED", "照片未上传成功，请重试");
    await this.transport.request(`/uploads/${signed.assetId}/complete`, {
      method: "POST",
      operationKey: key,
      body: JSON.stringify({ checksumSha256 }),
      signal,
    });
    progress("校验照片");
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const asset = await this.transport.request<{ status: string }>(
        `/uploads/${signed.assetId}`,
        { signal },
      );
      if (asset.status === "ready") return signed.assetId;
      if (asset.status === "rejected")
        throw new ApiError("ASSET_REJECTED", "照片未通过校验，请换一张图片");
      await abortDelay(1500, signal);
    }
    throw new ApiError(
      "ASSET_VALIDATION_PENDING",
      "照片仍在校验，请稍后回查；没有保存饮食记录",
    );
  }
  favorites(cursor?: string, signal?: AbortSignal) {
    return this.transport.request<CursorPage<RestaurantDto>>(
      `/me/restaurant-favorites?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal },
    );
  }
  nearby(
    input: {
      latitude: number;
      longitude: number;
      radiusMeters: number;
      tag?: string;
      cursor?: string;
    },
    signal?: AbortSignal,
  ) {
    const q = new URLSearchParams({
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      coordinateSystem: "wgs84",
      radiusMeters: String(input.radiusMeters),
      limit: "20",
    });
    if (input.tag) q.set("tag", input.tag);
    if (input.cursor) q.set("cursor", input.cursor);
    return this.transport.request<CursorPage<RestaurantDto>>(
      `/restaurants/nearby?${q}`,
      { signal },
    );
  }
  restaurant(id: string) {
    return this.transport.request<RestaurantDto>(`/restaurants/${id}`);
  }
  favorite(id: string, add: boolean) {
    return this.transport.request(`/me/restaurant-favorites/${id}`, {
      method: add ? "PUT" : "DELETE",
    });
  }
}
export type RecognitionConfirmation = {
  assetId: string;
  jobId: string;
  items: FoodItemDraft[];
};
