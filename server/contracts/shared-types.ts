/** QY-MYSQL-1.0.0 公共接口契约。这里只定义数据格式，不包含运行时或数据库实现。中文注释修订ZH-R1。 */
export const CONTRACT_VERSION = 'QY-MYSQL-1.0.0' as const;
export const BUSINESS_TIMEZONE = 'Asia/Shanghai' as const;
export type UUID = string; // 运行时校验为标准小写UUID v4。
export type ISODate = string; // YYYY-MM-DD格式，并校验日期真实有效。
export type Instant = string; // 带Z时区标志的ISO8601时刻，精确到毫秒。
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DbParam = string | number | boolean | null | Date | Uint8Array;
export type Platform = 'h5' | 'ios' | 'android';
export interface Meta { requestId: UUID; serverTime: Instant; timezone: typeof BUSINESS_TIMEZONE; }
export interface Envelope<T> { data: T; meta: Meta; }
export interface CursorPage<T> { items: T[]; nextCursor: string | null; }
export interface ApiError { error: { code: string; message: string; fields?: Record<string,string>; retryAfterSeconds?: number | null }; meta: Omit<Meta,'timezone'>; }
export interface CommandContext { userId: UUID; operationNow: Instant; businessDate: ISODate; requestId: UUID; platform: Platform; }
/** 同一事务固定使用同一条mysql2连接；业务模块不能自行提交或回滚。 */
export interface SqlTx {
  query<T extends object>(sql: string, values: readonly DbParam[]): Promise<T[]>;
  execute(sql: string, values: readonly DbParam[]): Promise<{ affectedRows: number }>;
}
export interface UnitOfWork {
  runForUser<T>(userId: UUID, run: (tx: SqlTx, ctx: CommandContext) => Promise<T>): Promise<T>;
  runForUsers<T>(actorUserId: UUID, referencedUserIds: readonly UUID[], run: (tx: SqlTx, ctx: CommandContext) => Promise<T>): Promise<T>;
  runSystem<T>(scope:'auth_bootstrap'|'idempotency_claim'|'outbox_claim'|'delivery_claim'|'provider_job', run:(tx:SqlTx,ctx:{operationNow:Instant;requestId:UUID})=>Promise<T>):Promise<T>;
  readSnapshot<T>(run: (tx: SqlTx) => Promise<T>): Promise<T>;
}
export interface UserAdministrationPort { disableInTransaction(tx:SqlTx,ctx:CommandContext,targetUserId:UUID):Promise<void>; }

export type AdminMediaPurpose = 'course_cover'|'course_video'|'activity_cover'|'reward_image';
export type MediaPurpose = 'meal_photo'|'avatar'|AdminMediaPurpose;
/** 仅接受经过服务端确认的内部参数，不能把HTTP请求中的身份或访问模式直接传入此服务。 */
export type MediaAccessInput =
  | {assetId:UUID;purpose:'meal_photo'|'avatar';actorUserId:UUID;access:'owner'}
  | {assetId:UUID;purpose:AdminMediaPurpose;actorUserId:UUID;access:'admin_material'}
  | {assetId:UUID;purpose:'avatar'|AdminMediaPurpose;actorUserId:UUID|null;access:'public_display'};
export interface ReadyMedia { assetId:UUID;purpose:MediaPurpose;userId:UUID|null;contentType:string;sizeBytes:number; }
export interface MediaPort {
  assertReady(tx:SqlTx,input:MediaAccessInput):Promise<ReadyMedia>;
  createReadUrl(input:MediaAccessInput & {expiresInSeconds?:number}):Promise<{assetId:UUID;readUrl:string;readUrlExpiresAt:Instant}>;
}

export type GoalType = 'balanced' | 'maintain' | 'lose' | 'gain';
export interface HealthProfileInput {
  heightCm?: number | null; birthYear?: number | null; targetWeightKg: number;
  waterTargetMl: number; calorieTargetKcal: number; carbsTargetG?: number | null;
  proteinTargetG?: number | null; fatTargetG?: number | null; goalType: GoalType; version: number;
}
export interface HealthProfileDto {
  id: UUID; userId: UUID; heightCm: number | null; birthYear: number | null; targetWeightKg: number;
  waterTargetMl: number; calorieTargetKcal: number; carbsTargetG: number | null;
  proteinTargetG: number | null; fatTargetG: number | null; goalType: GoalType; version: number; updatedAt: Instant;
}
export interface WaterRecordDto { id: UUID; amountMl: number; recordedAt: Instant; businessDate: ISODate; source: 'manual'; }
export interface WeightRecordDto { id: UUID; weightKg: number; recordedAt: Instant; businessDate: ISODate; source: 'manual'; }
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type NutritionSource = 'catalog' | 'model' | 'user';
/** 写入参数不接受客户端指定的记录ID、置信度、供应商、模型、状态或汇总结果。 */
export type FoodItemInput =
  | { nutritionSource:'catalog'; foodId:UUID; grams:number }
  | { nutritionSource:'user'; foodId?:UUID|null; name:string; grams:number; caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null }
  | { nutritionSource:'model'; candidateIndex:number }; // 仅创建餐记录时可用，必须关联成功的识别任务，候选内容由服务端加载。
export interface FoodItemDto { id:UUID; foodId:UUID|null; name:string; grams:number; caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null; nutritionSource:NutritionSource; confidence:number|null; }
export interface FoodItemDraft { candidateIndex:number; foodId:UUID|null; name:string; grams:number; caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null; nutritionSource:'model'; confidence:number|null; }
export interface MealTotals { caloriesKcal:number; carbsG:number|null; proteinG:number|null; fatG:number|null; }
export interface MealDto { id:UUID; mealType:MealType; recordedAt:Instant; businessDate:ISODate; source:'manual'|'photo'; photoAssetId:UUID|null; photoUrl:string|null; items:FoodItemDto[]; totals:MealTotals; version:number; createdAt:Instant; updatedAt:Instant; }
export interface CreateMealInput { mealType:MealType; recordedAt?:Instant; source:'manual'|'photo'; photoAssetId?:UUID; recognitionJobId?:UUID; items:FoodItemInput[]; }
export interface UpdateMealInput { version:number; mealType?:MealType; recordedAt?:Instant; items?:Exclude<FoodItemInput,{nutritionSource:'model'}>[]; }
export type RecognitionStatus = 'queued'|'running'|'succeeded'|'failed'|'canceled';
export interface RecognitionJobDto { id:UUID; status:RecognitionStatus; items:FoodItemDraft[]; error:{code:string;message:string}|null; createdAt:Instant; completedAt:Instant|null; }

export interface CourseDto { id:UUID; title:string; category:'stretch'|'strength'|'cardio'; level:'beginner'|'intermediate'; description:string; coverUrl:string|null; videoUrl:string|null; estimatedDurationSeconds:number; estimatedCaloriesKcal:number; status:'draft'|'published'|'archived'; version:number; }
export type WorkoutStatus = 'active'|'paused'|'completed'|'abandoned';
export interface WorkoutSessionDto {
  id:UUID; courseId:UUID; status:WorkoutStatus; startedAt:Instant; endedAt:Instant|null;
  activeDurationSeconds:number; estimatedCaloriesKcal:number; businessDate:ISODate|null;
  durationSnapshotSeconds:number; rewardThresholdSeconds:number; rewardEligible:boolean; version:number;
}
export interface CurrentWorkoutDto { session:WorkoutSessionDto|null; serverNow:Instant; }
export interface TrainingReminderInput { enabled:boolean; localTime:string; timezone:typeof BUSINESS_TIMEZONE; weekdays:number[]; channels:('in_app'|'web_push'|'app_push')[]; skipIfCompleted:boolean; version:number; }
export interface TrainingReminderDto extends TrainingReminderInput { id:UUID; nextTriggerAt:Instant|null; deliveryCapability:{webPush:boolean;appPush:boolean}; }

export type TaskCode = 'daily_checkin'|'daily_water'|'daily_meal'|'course_workout';
export interface PointAccountDto { balance:number; lifetimeEarned:number; lifetimeSpent:number; version:number; }
export interface PointAwardDto { id:UUID; taskCode:TaskCode; points:number; businessDate:ISODate; scopeKey:string; }
export interface TaskDto { code:TaskCode; title:string; description:string; rewardPoints:number; progress:number; target:number; status:'pending'|'completed'; completedAt:Instant|null; action:{type:'navigate'|'checkin';path?:string}; }
export type AwardInput = { type:'checkin' } | { type:'water_recorded'|'meal_confirmed'|'workout_completed'; sourceId:UUID };
export interface PointsPort {
  ensureAccountInTransaction(tx:SqlTx,input:{userId:UUID}):Promise<PointAccountDto>;
  awardInTransaction(tx:SqlTx,ctx:CommandContext,input:AwardInput):Promise<{awards:PointAwardDto[];account:PointAccountDto}>;
}

export type Mood = 'happy'|'calm'|'tired'|'low';
export interface MoodRecordDto { id:UUID; date:ISODate; mood:Mood; note:string|null; updatedAt:Instant; }
export type MessageStatus = 'queued'|'generating'|'completed'|'failed'|'canceled';
export interface CompanionSessionDto { id:UUID; title:string; status:'active'|'archived'; createdAt:Instant; updatedAt:Instant; lastMessageAt:Instant|null; }
export interface MessageDto { id:UUID; sessionId:UUID; role:'user'|'assistant'; content:string; status:MessageStatus; replyToId:UUID|null; errorCode:string|null; createdAt:Instant; completedAt:Instant|null; }
export interface CreateMessageInput { content:string; clientMessageId:UUID; }
export interface CreateMessageDto { userMessage:MessageDto; assistantMessage:MessageDto; streamUrl:string; }

export interface RestaurantDto { id:UUID; provider:string; providerPlaceId:string; name:string; address:string; latitude:number; longitude:number; coordinateSystem:'wgs84'; distanceMeters:number|null; rating:number|null; ratingScaleMax:number|null; priceCents:number|null; currency:'CNY'; tags:string[]; coverUrl:string|null; nutritionVerified:boolean; estimatedCaloriesKcal:number|null; isFavorited:boolean; status:'available'|'unavailable'; sourceUpdatedAt:Instant; }
export interface SlotDto { id:UUID; activityId:UUID; startAt:Instant; endAt:Instant; timezone:typeof BUSINESS_TIMEZONE; capacity:number; bookedCount:number; remainingSeats:number; bookingOpenAt:Instant; bookingCloseAt:Instant; cancelBeforeAt:Instant; status:'open'|'canceled'|'completed'; version:number; }
export interface ActivitySnapshot { id:UUID; title:string; locationName:string; address:string; coordinateSystem:'wgs84'; latitude:number|null; longitude:number|null; }
export interface SlotSnapshot { id:UUID; activityId:UUID; startAt:Instant; endAt:Instant; timezone:typeof BUSINESS_TIMEZONE; bookingOpenAt:Instant; bookingCloseAt:Instant; cancelBeforeAt:Instant; }
export interface BookingDto { id:UUID; slotId:UUID; activityId:UUID; status:'confirmed'|'canceled'|'attended'|'no_show'; participantVisibility:'hidden'|'public'; bookedAt:Instant; canceledAt:Instant|null; activityTitle:string; slot:SlotDto; activitySnapshot:ActivitySnapshot; slotSnapshot:SlotSnapshot; version:number; }
export interface CommunityProfileInput { bio:string|null; discoverable:boolean; version:number; }
export interface CommunityProfileDto extends CommunityProfileInput { id:UUID; userId:UUID; updatedAt:Instant; }

export type OutboxEventType =
  | 'media.validate.requested.v1' | 'nutrition.recognition.requested.v1' | 'companion.reply.requested.v1'
  | 'training.reminder.due.v1' | 'activity.booking.confirmed.v1' | 'activity.booking.canceled.v1'
  | 'activity.slot.canceled.v1' | 'points.redemption.requested.v1' | 'points.redemption.finished.v1';
export interface OutboxPayloadMap {
  'media.validate.requested.v1':{assetId:UUID};
  'nutrition.recognition.requested.v1':{jobId:UUID;userId:UUID;assetId:UUID};
  'companion.reply.requested.v1':{assistantMessageId:UUID;sessionId:UUID;userId:UUID};
  'training.reminder.due.v1':{reminderId:UUID;userId:UUID;reminderVersion:number;scheduledAt:Instant};
  'activity.booking.confirmed.v1':{bookingId:UUID;bookingEventId:UUID;slotId:UUID;userId:UUID};
  'activity.booking.canceled.v1':{bookingId:UUID;bookingEventId:UUID;slotId:UUID;userId:UUID};
  'activity.slot.canceled.v1':{slotId:UUID;slotVersion:number;actorUserId:UUID};
  'points.redemption.requested.v1':{redemptionId:UUID;userId:UUID};
  'points.redemption.finished.v1':{redemptionId:UUID;userId:UUID;redemptionVersion:number;status:'fulfilled'|'refunded'};
}
export type OutboxInput = { [K in OutboxEventType]:{eventType:K;aggregateType:string;aggregateId:UUID;eventKey:string;schemaVersion:1;payload:OutboxPayloadMap[K]} }[OutboxEventType];
export interface OutboxPort { enqueueInTransaction(tx:SqlTx,input:OutboxInput):Promise<{id:UUID}>; }

export interface NutrientSum { knownG:number; complete:boolean; }
export interface NutritionDay { date:ISODate; hasMealRecord:boolean; intakeKcal:number; carbs:NutrientSum; protein:NutrientSum; fat:NutrientSum; }
export interface TrainingDay { date:ISODate; completedWorkouts:number; exerciseKcal:number; durationSeconds:number; }
export interface NutritionQueryPort {
  days(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<NutritionDay[]>;
  latestMeal(tx:SqlTx,userId:UUID,date:ISODate):Promise<MealDto|null>;
}
export interface TrainingQueryPort {
  days(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<TrainingDay[]>;
  recommendedCourse(tx:SqlTx,userId:UUID,date:ISODate):Promise<CourseDto|null>;
}
export interface PointsQueryPort {
  account(tx:SqlTx,userId:UUID):Promise<PointAccountDto>;
  tasks(tx:SqlTx,userId:UUID,date:ISODate):Promise<TaskDto[]>;
  consecutiveCheckinDays(tx:SqlTx,userId:UUID,asOfDate:ISODate):Promise<number>;
}
export interface CompanionQueryPort { moods(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<MoodRecordDto[]>; }
export interface ActivitiesQueryPort { activeBookingCount(tx:SqlTx,userId:UUID,at:Instant):Promise<number>; }
export interface HealthDay { date:ISODate; waterMl:number; hasWaterRecord:boolean; weightKg:number|null; }
export interface HealthQueryPort { profile(tx:SqlTx,userId:UUID):Promise<HealthProfileDto|null>; days(tx:SqlTx,userId:UUID,startDate:ISODate,endDate:ISODate):Promise<HealthDay[]>; }

export interface DashboardDto {
  date:ISODate; isDemo:false;
  water:{totalMl:number;targetMl:number|null;progress:number|null};
  weight:{latestKg:number|null;targetKg:number|null;previousKg:number|null;changeKg:number|null;bmi:number|null};
  energy:{intakeKcal:number;exerciseKcal:number;baseTargetKcal:number|null;effectiveTargetKcal:number|null;remainingKcal:number|null;exceededKcal:number|null};
  nutrients:{carbs:{consumedG:number;targetG:number|null;complete:boolean};protein:{consumedG:number;targetG:number|null;complete:boolean};fat:{consumedG:number;targetG:number|null;complete:boolean}};
  week:{date:ISODate;hasMealRecord:boolean;hasTrainingRecord:boolean}[];
  latestMeal:MealDto|null; recommendedWorkout:CourseDto|null; pointsBalance:number; dailyTasks:TaskDto[]; generatedAt:Instant;
}
export interface OverviewDto {
  range:7|30;startDate:ISODate;endDate:ISODate;generatedAt:Instant;
  summary:{avgIntakeKcal:number|null;avgWaterMl:number|null;completedWorkouts:number;totalExerciseKcal:number;latestWeightKg:number|null;moodRecordedDays:number;pointsBalance:number;activeBookings:number};
  series:{date:ISODate;intakeKcal:number;exerciseKcal:number;waterMl:number;weightKg:number|null;mood:Mood|null;completedWorkouts:number;hasMealRecord:boolean;hasWaterRecord:boolean}[];
  coverage:{mealDays:number;waterDays:number;weightDays:number;moodDays:number;rangeDays:number};
}

/** 查询服务复用传入的一致性快照事务；按日查询只返回有记录的日期，由M02补齐日期网格。 */
export interface ContractMetadataDto { contractVersion:typeof CONTRACT_VERSION; schemaVersion:string; baselineSha256:string; timezone:typeof BUSINESS_TIMEZONE; }
export const NOTIFICATION_TYPES = ['training_reminder','booking_confirmed','booking_canceled','activity_canceled','redemption_result'] as const;
export const DEVELOPMENT_RULES = { daily_checkin:10, daily_water:5, daily_meal:10, course_workout:20, workoutThresholdRatio:0.8 } as const;
