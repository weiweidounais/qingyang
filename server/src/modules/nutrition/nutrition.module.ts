import {
  Controller,
  Module,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  Req,
  Inject,
  HttpCode,
  UseFilters,
  Catch,
  type ArgumentsHost,
  type DynamicModule,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type {
  UnitOfWork,
  SqlTx,
  CommandContext,
  Envelope,
  MediaPort,
  PointsPort,
  OutboxPort,
} from "../../../contracts/shared-types.js";
import { NutritionService } from "./nutrition.service.js";
import {
  RestaurantsService,
  type PoiPort,
} from "../restaurants/restaurants.service.js";
import { RecognitionWorker, type VisionPort } from "./recognition.worker.js";
import { CursorCodec, DomainError, fail, keys } from "./domain.js";

/** 由M01实现：真实鉴权/CSRF、同事务幂等及envelope。模块不另建HTTP或用户真相。 */
export interface M03HttpPort {
  actor(req: Request): string;
  query<T>(
    req: Request,
    run: (tx: SqlTx, userId: string) => Promise<T>,
  ): Promise<Envelope<T>>;
  command<T>(
    req: Request,
    status: 200 | 201 | 202 | 204,
    run: (tx: SqlTx, ctx: CommandContext) => Promise<T>,
  ): Promise<Envelope<T> | void>;
  envelope<T>(req: Request, data: T): Envelope<T>;
}
export interface M03ModuleOptions {
  uow: UnitOfWork;
  http: M03HttpPort;
  media: MediaPort;
  points: PointsPort;
  outbox: OutboxPort;
  cursorSecret: string;
  vision?: VisionPort;
  poi?: PoiPort;
}
const OPTIONS = Symbol("M03_OPTIONS");
class DomainFilter {
  catch(error: DomainError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    response
      .status(error.status)
      .json({
        error: { code: error.code, message: error.message },
        meta: { requestId: randomUUID(), serverTime: new Date().toISOString() },
      });
  }
}
Catch(DomainError)(DomainFilter);
class M03Controller {
  constructor(
    private options: M03ModuleOptions,
    private nutrition: NutritionService,
    private restaurants: RestaurantsService,
  ) {}
  private query(req: Request) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (typeof v !== "string") fail("INVALID_QUERY", "查询参数格式不正确");
      out[k] = v;
    }
    return out;
  }
  private noBody(req: Request) {
    if (req.body && Object.keys(req.body).length)
      fail("UNKNOWN_FIELD", "这个请求无需正文");
    keys(this.query(req), []);
  }
  foods(req: Request) {
    return this.options.http.query(req, (tx) =>
      this.nutrition.foods(tx, this.query(req)),
    );
  }
  meals(req: Request) {
    return this.options.http.query(req, (tx, user) =>
      this.nutrition.list(tx, user, this.query(req)),
    );
  }
  async meal(req: Request) {
    keys(this.query(req), []);
    const reply = await this.options.http.query(req, (tx, user) =>
      this.nutrition.get(tx, user, String(req.params.id)),
    );
    reply.data = await this.nutrition.withPhoto(
      reply.data,
      this.options.http.actor(req),
    );
    return reply;
  }
  createMeal(req: Request) {
    keys(this.query(req), []);
    return this.options.http.command(req, 201, (tx, ctx) =>
      this.nutrition.create(tx, ctx, req.body),
    );
  }
  updateMeal(req: Request) {
    keys(this.query(req), []);
    return this.options.http.command(req, 200, (tx, ctx) =>
      this.nutrition.update(tx, ctx, String(req.params.id), req.body),
    );
  }
  deleteMeal(req: Request) {
    this.noBody(req);
    return this.options.http.command(req, 204, (tx, ctx) =>
      this.nutrition.remove(tx, ctx, String(req.params.id)),
    );
  }
  createJob(req: Request) {
    if (!this.options.vision)
      fail("RECOGNITION_NOT_CONFIGURED", "AI识别服务尚未接入", 503);
    keys(this.query(req), []);
    return this.options.http.command(req, 202, (tx, ctx) =>
      this.nutrition.createJob(tx, ctx, req.body),
    );
  }
  job(req: Request) {
    keys(this.query(req), []);
    return this.options.http.query(req, (tx, user) =>
      this.nutrition.job(tx, user, String(req.params.id)),
    );
  }
  cancelJob(req: Request) {
    this.noBody(req);
    return this.options.http.command(req, 200, (tx, ctx) =>
      this.nutrition.cancelJob(tx, ctx, String(req.params.id)),
    );
  }
  favorites(req: Request) {
    return this.options.http.query(req, (tx, user) =>
      this.restaurants.favorites(tx, user, this.query(req)),
    );
  }
  addFavorite(req: Request) {
    this.noBody(req);
    return this.options.http.command(req, 200, (tx, ctx) =>
      this.restaurants.favorite(tx, ctx, String(req.params.restaurantId), true),
    );
  }
  removeFavorite(req: Request) {
    this.noBody(req);
    return this.options.http.command(req, 204, (tx, ctx) =>
      this.restaurants.favorite(
        tx,
        ctx,
        String(req.params.restaurantId),
        false,
      ),
    );
  }
  restaurant(req: Request) {
    return this.options.http.query(req, (tx, user) =>
      this.restaurants.get(tx, user, String(req.params.id), this.query(req)),
    );
  }
  async nearby(req: Request) {
    const userId = this.options.http.actor(req);
    const data = await this.restaurants.search(
      userId,
      this.query(req),
      (run) => this.options.uow.readSnapshot(run),
      (run) => this.options.uow.runForUser(userId, (tx) => run(tx)),
    );
    return this.options.http.envelope(req, data);
  }
}
Controller()(M03Controller);
UseFilters(new DomainFilter())(M03Controller);
Inject(OPTIONS)(M03Controller, undefined, 0);
Inject(NutritionService)(M03Controller, undefined, 1);
Inject(RestaurantsService)(M03Controller, undefined, 2);
const routes = [
  [Get, "foods", "foods", 200],
  [Get, "me/meals", "meals", 200],
  [Get, "me/meals/:id", "meal", 200],
  [Post, "me/meals", "createMeal", 201],
  [Patch, "me/meals/:id", "updateMeal", 200],
  [Delete, "me/meals/:id", "deleteMeal", 204],
  [Post, "me/recognition-jobs", "createJob", 202],
  [Get, "me/recognition-jobs/:id", "job", 200],
  [Post, "me/recognition-jobs/:id/cancel", "cancelJob", 200],
  [Get, "me/restaurant-favorites", "favorites", 200],
  [Put, "me/restaurant-favorites/:restaurantId", "addFavorite", 200],
  [Delete, "me/restaurant-favorites/:restaurantId", "removeFavorite", 204],
  [Get, "restaurants/nearby", "nearby", 200],
  [Get, "restaurants/:id", "restaurant", 200],
] as const;
for (const [decorator, path, method, status] of routes) {
  const desc = Object.getOwnPropertyDescriptor(
    M03Controller.prototype,
    method,
  )!;
  decorator(path)(M03Controller.prototype, method, desc);
  Req()(M03Controller.prototype, method, 0);
  HttpCode(status)(M03Controller.prototype, method, desc);
}
export class NutritionModule {
  /** M01设置全局/api/v1前缀与身份守卫；本注册方法不修改任何根装配文件。 */
  static register(options: M03ModuleOptions): DynamicModule {
    const nutrition = new NutritionService({
      media: options.media,
      points: options.points,
      outbox: options.outbox,
      cursors: new CursorCodec(options.cursorSecret),
    });
    const restaurants = new RestaurantsService(
      new CursorCodec(options.cursorSecret),
      options.poi ?? null,
    );
    return {
      module: NutritionModule,
      controllers: [M03Controller],
      providers: [
        { provide: OPTIONS, useValue: options },
        { provide: NutritionService, useValue: nutrition },
        { provide: RestaurantsService, useValue: restaurants },
        ...(options.vision
          ? [
              {
                provide: RecognitionWorker,
                useValue: new RecognitionWorker(
                  options.uow,
                  options.media,
                  nutrition,
                  options.vision,
                ),
              },
            ]
          : []),
      ],
      exports: [
        NutritionService,
        RestaurantsService,
        ...(options.vision ? [RecognitionWorker] : []),
      ],
    };
  }
}
Module({})(NutritionModule);
