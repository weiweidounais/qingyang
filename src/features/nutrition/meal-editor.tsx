"use client";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  Trash2,
  LoaderCircle,
  ArrowLeft,
  Check,
} from "lucide-react";
import { Dialog } from "./dialog";
import {
  ApiError,
  messageOf,
  type CatalogFood,
  type MealDto,
  type MealType,
  type FoodItemInput,
  type NutritionClient,
  type RecognitionConfirmation,
} from "./api";

export const mealLabels: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};
export { operationKey as newKey } from "./keys";
import { operationKey as newKey } from "./keys";

type Draft = {
  key: string;
  nutritionSource: "catalog" | "model" | "user";
  foodId: string | null;
  name: string;
  grams: string;
  caloriesKcal: string;
  carbsG: string;
  proteinG: string;
  fatG: string;
  candidateIndex?: number;
  catalog?: CatalogFood;
};
const blank = (): Draft => ({
  key: newKey(),
  nutritionSource: "user",
  foodId: null,
  name: "",
  grams: "",
  caloriesKcal: "",
  carbsG: "",
  proteinG: "",
  fatG: "",
});
const value = (n: number | null) => (n === null ? "" : String(n));
function fromMeal(meal: MealDto): Draft[] {
  return meal.items.map((x) => ({
    key: x.id,
    nutritionSource: "user",
    foodId: x.foodId,
    name: x.name,
    grams: String(x.grams),
    caloriesKcal: String(x.caloriesKcal),
    carbsG: value(x.carbsG),
    proteinG: value(x.proteinG),
    fatG: value(x.fatG),
  }));
}
function localTime(at: string) {
  return new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 16);
}
export function MealEditor({
  client,
  date,
  meal,
  recognition,
  onClose,
  onSaved,
}: {
  client: NutritionClient;
  date: string;
  meal?: MealDto;
  recognition?: RecognitionConfirmation;
  onClose(): void;
  onSaved(date: string): void;
}) {
  const [items, setItems] = useState<Draft[]>(() =>
    meal
      ? fromMeal(meal)
      : recognition
        ? recognition.items.map((x) => ({
            key: newKey(),
            nutritionSource: "model",
            foodId: null,
            candidateIndex: x.candidateIndex,
            name: x.name,
            grams: String(x.grams),
            caloriesKcal: String(x.caloriesKcal),
            carbsG: value(x.carbsG),
            proteinG: value(x.proteinG),
            fatG: value(x.fatG),
          }))
        : [blank()],
  );
  const [type, setType] = useState<MealType>(meal?.mealType ?? "lunch");
  const [time, setTime] = useState(
    meal
      ? localTime(meal.recordedAt)
      : date === localTime(new Date().toISOString()).slice(0, 10)
        ? localTime(new Date().toISOString())
        : `${date}T12:00`,
  );
  const [picker, setPicker] = useState(false),
    [keyword, setKeyword] = useState(""),
    [foods, setFoods] = useState<CatalogFood[]>([]),
    [loading, setLoading] = useState(false),
    [searchError, setSearchError] = useState("");
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const initialItems = useRef(JSON.stringify(items));
  const inFlight = useRef(false),
    operation = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    if (!picker) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setSearchError("");
      client
        .foods(keyword, controller.signal)
        .then((p) => setFoods(p.items))
        .catch((e) => {
          if (!controller.signal.aborted) setSearchError(messageOf(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, keyword, picker]);
  function change(index: number, field: keyof Draft, content: string) {
    setError("");
    setItems((old) =>
      old.map((x, i) => {
        if (i !== index) return x;
        if (field === "grams" && x.nutritionSource === "catalog" && x.catalog) {
          const scale = (n: number | null) =>
            n === null
              ? ""
              : String(Math.round((n * Number(content)) / 10) / 10);
          return {
            ...x,
            grams: content,
            caloriesKcal: scale(x.catalog.caloriesKcal),
            carbsG: scale(x.catalog.carbsG),
            proteinG: scale(x.catalog.proteinG),
            fatG: scale(x.catalog.fatG),
          };
        }
        return {
          ...x,
          [field]: content,
          nutritionSource: "user",
          candidateIndex: undefined,
          catalog: undefined,
        };
      }),
    );
  }
  function add(food?: CatalogFood) {
    if (items.length >= 30) {
      setError("一餐最多添加30项食物");
      return;
    }
    const x: Draft = food
      ? {
          key: newKey(),
          nutritionSource: "catalog",
          foodId: food.id,
          name: food.name,
          grams: "100",
          caloriesKcal: value(food.caloriesKcal),
          carbsG: value(food.carbsG),
          proteinG: value(food.proteinG),
          fatG: value(food.fatG),
          catalog: food,
        }
      : blank();
    setItems((old) =>
      old.length === 1 && !old[0].name && !old[0].grams && !old[0].caloriesKcal
        ? [x]
        : [...old, x],
    );
    setPicker(false);
    setKeyword("");
    setError("");
  }
  async function save() {
    if (inFlight.current) return;
    setError("");
    try {
      if (!time || !Number.isFinite(Date.parse(`${time}:00+08:00`)))
        throw Error("请选择有效的记录时间");
      if (items.length < 1) throw Error("请至少添加一项食物");
      const input: FoodItemInput[] = items.map((x) => {
        if (!x.name.trim() || x.name.trim().length > 100)
          throw Error("每项食物请填写1—100字的名称");
        const number = (s: string, min: number, max: number, label: string) => {
          const n = Number(s);
          if (
            !s.trim() ||
            !Number.isFinite(n) ||
            n < min ||
            n > max ||
            Math.abs(n * 10 - Math.round(n * 10)) > 1e-7
          )
            throw Error(`${label}需在${min}—${max}之间，最多1位小数`);
          return n;
        };
        const grams = number(x.grams, 0.1, 5000, "份量");
        if (x.nutritionSource === "catalog")
          return { nutritionSource: "catalog", foodId: x.foodId!, grams };
        if (x.nutritionSource === "model" && !meal)
          return {
            nutritionSource: "model",
            candidateIndex: x.candidateIndex!,
          };
        const nutrient = (s: string) =>
          s.trim() === "" ? null : number(s, 0, 1000, "营养素");
        return {
          nutritionSource: "user",
          foodId: x.foodId,
          name: x.name.trim(),
          grams,
          caloriesKcal: number(x.caloriesKcal, 0.1, 5000, "热量"),
          carbsG: nutrient(x.carbsG),
          proteinG: nutrient(x.proteinG),
          fatG: nutrient(x.fatG),
        };
      });
      const at = new Date(`${time}:00+08:00`).toISOString();
      const body = meal
        ? {
            version: meal.version,
            mealType: type,
            recordedAt: at,
            ...(JSON.stringify(items) === initialItems.current ? {} : {
              items: input as Exclude<FoodItemInput, { nutritionSource: "model" }>[],
            }),
          }
        : {
            mealType: type,
            recordedAt: at,
            source: recognition ? ("photo" as const) : ("manual" as const),
            ...(recognition
              ? {
                  photoAssetId: recognition.assetId,
                  recognitionJobId: recognition.jobId,
                }
              : {}),
            items: input,
          };
      const fingerprint = JSON.stringify(body);
      if (operation.current?.body !== fingerprint)
        operation.current = { body: fingerprint, key: newKey() };
      inFlight.current = true;
      setSaving(true);
      const saved = meal
        ? await client.update(
            meal.id,
            body as Parameters<typeof client.update>[1],
            operation.current.key,
          )
        : (
            await client.save(
              body as Parameters<typeof client.save>[0],
              operation.current.key,
            )
          ).meal;
      window.dispatchEvent(
        new CustomEvent("qingyang:nutrition-changed", {
          detail: {
            date: saved.businessDate,
            previousDate: meal?.businessDate,
          },
        }),
      );
      onSaved(saved.businessDate);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "VERSION_CONFLICT"
          ? `${e.message}。你本次填写的内容仍保留，请先复制需要保留的内容再关闭刷新。`
          : messageOf(e),
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const kcal =
    Math.round(
      items.reduce((n, x) => n + (Number(x.caloriesKcal) || 0), 0) * 10,
    ) / 10;
  return (
    <Dialog
      open
      title={meal ? "编辑这一餐" : recognition ? "确认识别结果" : "记录这一餐"}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      {picker ? (
        <div className="nt-picker">
          <button className="text-link" onClick={() => setPicker(false)}>
            <ArrowLeft size={16} /> 返回这一餐
          </button>
          <div className="nt-search">
            <Search size={17} />
            <input
              autoFocus
              aria-label="搜索食物库"
              placeholder="搜索米饭、苹果、鸡胸肉…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <p className="nt-hint">
            目录营养均按每100克展示，添加后可修改实际克数。
          </p>
          {loading ? (
            <p className="nt-hint">正在查找食物…</p>
          ) : searchError ? (
            <p role="alert" className="nt-error">
              {searchError}
            </p>
          ) : foods.length ? (
            <div className="nt-catalog">
              {foods.map((f) => (
                <button key={f.id} onClick={() => add(f)}>
                  <span>
                    <strong>{f.name}</strong>
                    <small>
                      {f.proteinG === null
                        ? "蛋白质未知"
                        : `蛋白质 ${f.proteinG}g`}{" "}
                      · 每100g
                    </small>
                  </span>
                  <b>
                    {f.caloriesKcal}
                    <small> 千卡</small>
                  </b>
                  <Plus size={17} />
                </button>
              ))}
            </div>
          ) : (
            <div className="nt-empty small">没有找到匹配食物，可手动填写。</div>
          )}
          <button className="outline-button full-width" onClick={() => add()}>
            手动填写其他食物
          </button>
        </div>
      ) : (
        <>
          <p className="nt-hint">
            {recognition
              ? "识别为估算，请核对食物和份量。修改后的项目将按人工填写保存。"
              : meal
                ? "编辑食物会按本次确认内容保存营养快照，不会重复领取积分。"
                : "从食物库选择，或填写你实际吃下的食物。未知营养可以留空。"}
          </p>
          <div className="nt-form-pair">
            <label>
              餐次
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MealType)}
              >
                {Object.entries(mealLabels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              记录时间（上海）
              <input
                type="datetime-local"
                value={time}
                max={localTime(new Date().toISOString())}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          </div>
          <div className="nt-foods">
            {items.map((x, index) => (
              <article className="nt-food" key={x.key}>
                <div className="nt-food-head">
                  <span className={`nt-source ${x.nutritionSource}`}>
                    {x.nutritionSource === "catalog"
                      ? "食物库"
                      : x.nutritionSource === "model"
                        ? "模型估算 · 待确认"
                        : "人工填写"}
                  </span>
                  <button
                    className="icon-button"
                    aria-label={`移除食物${index + 1}`}
                    disabled={saving}
                    onClick={() =>
                      setItems((old) => old.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <label>
                  食物名称
                  <input
                    aria-label={`食物名称${index + 1}`}
                    maxLength={100}
                    readOnly={x.nutritionSource === "catalog"}
                    placeholder="例如：清蒸鱼"
                    value={x.name}
                    onChange={(e) => change(index, "name", e.target.value)}
                  />
                </label>
                <div className="nt-form-pair">
                  <label>
                    份量 / g
                    <input
                      aria-label={`份量${index + 1}`}
                      type="number"
                      min="0.1"
                      max="5000"
                      step="0.1"
                      inputMode="decimal"
                      placeholder="实际克数"
                      value={x.grams}
                      onChange={(e) => change(index, "grams", e.target.value)}
                    />
                  </label>
                  <label>
                    热量 / 千卡
                    <input
                      aria-label={`热量${index + 1}`}
                      type="number"
                      min="0.1"
                      max="5000"
                      step="0.1"
                      inputMode="decimal"
                      placeholder="本次份量的热量"
                      readOnly={x.nutritionSource === "catalog"}
                      value={x.caloriesKcal}
                      onChange={(e) =>
                        change(index, "caloriesKcal", e.target.value)
                      }
                    />
                  </label>
                </div>
                <details className="nt-nutrient-fields">
                  <summary>
                    营养信息 <span>按本次份量 · 未知可留空</span>
                  </summary>
                  <div className="nt-form-three">
                    {(["carbsG", "proteinG", "fatG"] as const).map(
                      (field, i) => (
                        <label key={field}>
                          {["碳水 / g", "蛋白质 / g", "脂肪 / g"][i]}
                          <input
                            aria-label={`${["碳水", "蛋白质", "脂肪"][i]}${index + 1}`}
                            type="number"
                            min="0"
                            max="1000"
                            step="0.1"
                            inputMode="decimal"
                            placeholder="未知"
                            readOnly={x.nutritionSource === "catalog"}
                            value={x[field]}
                            onChange={(e) =>
                              change(index, field, e.target.value)
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                </details>
                {x.nutritionSource === "catalog" && (
                  <button
                    className="text-link nt-convert"
                    onClick={() =>
                      setItems((old) =>
                        old.map((f, i) =>
                          i === index
                            ? {
                                ...f,
                                nutritionSource: "user",
                                catalog: undefined,
                              }
                            : f,
                        ),
                      )
                    }
                  >
                    需要修正？改为手动填写
                  </button>
                )}
              </article>
            ))}
          </div>
          <div className="nt-add-row">
            <button
              className="outline-button"
              disabled={items.length >= 30 || saving}
              onClick={() => {
                setPicker(true);
                setKeyword("");
              }}
            >
              <Search size={16} /> 从食物库添加
            </button>
            <button
              className="outline-button"
              disabled={items.length >= 30 || saving}
              onClick={() => add()}
            >
              <Plus size={16} /> 手动添加
            </button>
          </div>
          {error && (
            <p className="nt-error" role="alert">
              {error}
            </p>
          )}
          <div className="nt-save-bar">
            <span>
              <small>{items.length}项食物 · 本餐预览</small>
              <strong>
                {kcal.toLocaleString("zh-CN")}
                <small> 千卡</small>
              </strong>
            </span>
            <button
              className="primary-button"
              onClick={save}
              disabled={saving || !items.length}
            >
              {saving ? (
                <LoaderCircle size={17} className="nt-spin" />
              ) : (
                <Check size={17} />
              )}{" "}
              {saving ? "正在保存" : meal ? "保存修改" : "确认记录"}
            </button>
          </div>
          <p className="nt-hint nt-centered">
            确认后才计入饮食日记 · 关闭不保存
          </p>
        </>
      )}
    </Dialog>
  );
}
