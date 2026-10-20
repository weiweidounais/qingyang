"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Plus,
  ChevronLeft,
  ChevronRight,
  Leaf,
  Utensils,
  ArrowUpRight,
  Pencil,
  Trash2,
  LoaderCircle,
  CalendarDays,
  Check,
  RefreshCw,
} from "lucide-react";
import { Dialog } from "./dialog";
import {
  NutritionClient,
  messageOf,
  type Capabilities,
  type MealDto,
  type MealType,
  type RecognitionConfirmation,
} from "./api";
import { MealEditor, mealLabels, newKey } from "./meal-editor";
import { PhotoFlow } from "./photo-flow";
import { Nearby } from "./nearby";
import "./nutrition.css";
const client = new NutritionClient();
const shanghaiDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const shiftDate = (s: string, n: number) =>
  new Date(Date.parse(`${s}T12:00:00+08:00`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
const display = (n: number) =>
  n.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export function Nutrition() {
  const [today, setToday] = useState(""),
    [date, setDate] = useState(""),
    [capabilities, setCapabilities] = useState<Capabilities | null>(null),
    [me, setMe] = useState<{ userId: string; nickname: string } | null>(null);
  const [meals, setMeals] = useState<MealDto[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [filter, setFilter] = useState<MealType | "all">("all");
  const [editor, setEditor] = useState<{
      meal?: MealDto;
      recognition?: RecognitionConfirmation;
    } | null>(null),
    [photo, setPhoto] = useState(false),
    [detail, setDetail] = useState<MealDto | null>(null),
    [remove, setRemove] = useState<MealDto | null>(null),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState(""),
    [notice, setNotice] = useState("");
  const [photoUnavailable, setPhotoUnavailable] = useState(false);
  const [reload, setReload] = useState(0),
    [initialization, setInitialization] = useState(0);
  const deleteKey = useRef(""),
    deletion = useRef(false),
    accountGeneration = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    const d = shanghaiDate();
    setToday(d);
    setDate(d);
    const c = new AbortController();
    setLoading(true);
    setError("");
    client
      .initialize(c.signal)
      .then(({ capabilities, me }) => {
        if (!c.signal.aborted) {
          setCapabilities(capabilities);
          setMe(me);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(messageOf(e));
          setLoading(false);
        }
      });
    const refreshDay = () => setToday(shanghaiDate());
    window.addEventListener("focus", refreshDay);
    const timer = setInterval(refreshDay, 30000);
    if (new URLSearchParams(location.search).get("photo")) setPhoto(true);
    return () => {
      c.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refreshDay);
    };
  }, [initialization]);
  useEffect(() => {
    if (!me || !date) return;
    const c = new AbortController();
    setLoading(true);
    setError("");
    setMeals([]);
    client
      .meals(date, c.signal)
      .then((items) => {
        if (!c.signal.aborted) setMeals(items);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(messageOf(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [date, me, reload]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  const sum = useMemo(() => {
    const all = meals.flatMap((m) => m.items);
    const nutrient = (key: "carbsG" | "proteinG" | "fatG") => ({
      known: Math.round(all.reduce((n, x) => n + (x[key] ?? 0), 0) * 10) / 10,
      complete: all.length > 0 && all.every((x) => x[key] !== null),
    });
    return {
      calories:
        Math.round(meals.reduce((n, m) => n + m.totals.caloriesKcal, 0) * 10) /
        10,
      carbs: nutrient("carbsG"),
      protein: nutrient("proteinG"),
      fat: nutrient("fatG"),
    };
  }, [meals]);
  function saved(d: string) {
    detailRequest.current?.abort();
    setEditor(null);
    setPhoto(false);
    setDetail(null);
    setDate(d);
    setReload((x) => x + 1);
    setNotice("这一餐已保存");
  }
  function openDetail(meal: MealDto) {
    detailRequest.current?.abort();
    setDetail(meal);
    setPhotoUnavailable(false);
    if (!meal.photoAssetId) return;
    const controller = new AbortController();
    detailRequest.current = controller;
    const generation = accountGeneration.current;
    void client.meal(meal.id, controller.signal).then((fresh) => {
      if (!controller.signal.aborted && generation === accountGeneration.current)
        setDetail((current) => current?.id === fresh.id ? fresh : current);
    }).catch(() => {
      if (!controller.signal.aborted && generation === accountGeneration.current) setPhotoUnavailable(true);
    });
  }
  async function switchFixture() {
    detailRequest.current?.abort();
    const gen = ++accountGeneration.current;
    setLoading(true);
    setError("");
    setMeals([]);
    setEditor(null);
    setPhoto(false);
    setDetail(null);
    setRemove(null);
    try {
      const next = await client.selectFixture(
        me?.userId.endsWith("1") ? "b" : "a",
      );
      if (gen === accountGeneration.current) {
        setMe(next);
        setReload((x) => x + 1);
        setNotice(`已切换至${next.nickname}`);
      }
    } catch (e) {
      if (gen === accountGeneration.current) {
        setError(messageOf(e));
        setReload((x) => x + 1);
      }
    }
  }
  async function confirmDelete() {
    if (!remove || deletion.current) return;
    deletion.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      await client.remove(remove.id, deleteKey.current);
      window.dispatchEvent(
        new CustomEvent("qingyang:nutrition-changed", {
          detail: { date: remove.businessDate },
        }),
      );
      setRemove(null);
      setDetail(null);
      setReload((x) => x + 1);
      setNotice("记录已删除，统计已更新");
    } catch (e) {
      setDeleteError(messageOf(e));
    } finally {
      deletion.current = false;
      setDeleting(false);
    }
  }
  const list = meals.filter((m) => filter === "all" || m.mealType === filter);
  return (
    <div className="nt-root">
      <section className="page-heading">
        <div>
          <p className="greeting">
            <Leaf size={15} /> 轻养健康 · 饮食日记
          </p>
          <h1>好好吃饭，慢慢变好。</h1>
          <p className="muted">记下每一餐，让均衡成为自然的日常。</p>
        </div>
        <button
          className="outline-button"
          disabled={!me || loading}
          onClick={() => setEditor({})}
        >
          <Plus size={17} /> 手动记餐
        </button>
      </section>
      {capabilities?.mode === "local_fixture" && (
        <details className="nt-dev-note">
          <summary>
            本地联调 · 饮食记录使用真实MySQL{" "}
            <span>{me?.nickname ?? "连接中"}</span>
          </summary>
          <p>
            当前使用测试账号，积分和跨页看板待其他模块接入。
            {capabilities.upload ? "照片保存在本机。" : "图片上传待接入。"}
            {capabilities.recognition ? "识别使用本机模型，结果需核对。" : "本机识别模型尚未就绪。"}
            地图待接入；其他页面仍为团队原演示。
          </p>
          <button
            className="text-link"
            disabled={loading || !!editor || deleting}
            onClick={switchFixture}
          >
            切换测试账号，检查数据隔离
          </button>
        </details>
      )}
      {error && (
        <div className="nt-error nt-page-error" role="alert">
          <span>{error}</span>
          <button
            className="text-link"
            onClick={() => {
              if (me) setReload((x) => x + 1);
              else setInitialization((x) => x + 1);
            }}
          >
            <RefreshCw size={15} /> 重试
          </button>
        </div>
      )}
      <section className="feature-banner nt-hero">
        <div>
          <span className="tag white">每一餐，都值得被好好记录</span>
          <h2>
            拍一下，
            <br />
            记住你的好好吃饭。
          </h2>
          <p>拍下美味，核对食物与份量，再确认记录。</p>
          <button
            className="primary-button"
            disabled={!me}
            onClick={() => setPhoto(true)}
          >
            <Camera size={18} /> 拍照记录
          </button>
          <a className="nt-hero-link" href="#nearby">
            去附近，找点好吃的 <ArrowUpRight size={14} />
          </a>
        </div>
        <img src="/buddy.svg" alt="小养陪你记录每一餐" />
      </section>
      <section className="nt-diary">
        <div className="nt-section-title">
          <div>
            <span className="nt-eyebrow">你的每一餐，都在这里</span>
            <h2>
              {date === today ? "今天，吃了些什么？" : "回看这一天的饮食"}
            </h2>
          </div>
          <div className="nt-date">
            <button
              className="icon-button"
              aria-label="前一天"
              disabled={
                !date || !today || date <= shiftDate(today, -30) || loading
              }
              onClick={() => setDate((d) => shiftDate(d, -1))}
            >
              <ChevronLeft size={17} />
            </button>
            <label>
              <CalendarDays size={16} />
              <input
                type="date"
                aria-label="饮食日期"
                value={date}
                max={today}
                min={today ? shiftDate(today, -30) : undefined}
                onChange={(e) => {
                  if (e.target.value) setDate(e.target.value);
                }}
              />
            </label>
            <button
              className="icon-button"
              aria-label="后一天"
              disabled={!date || date >= today || loading}
              onClick={() => setDate((d) => shiftDate(d, 1))}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
        <div className="nt-summary" aria-busy={loading}>
          <div className="nt-energy">
            <span>已记录摄入</span>
            <div>
              <strong data-testid="nutrition-calories">
                {loading ? "—" : display(sum.calories)}
              </strong>
              <span> 千卡</span>
            </div>
            <small>
              {loading
                ? "正在读取记录"
                : error
                  ? "暂时无法读取"
                  : `${meals.length}餐已记录 · 未设置摄入目标`}
            </small>
          </div>
          <div className="nt-nutrients">
            {(
              [
                { name: "碳水", key: "carbs", color: "peach" },
                { name: "蛋白质", key: "protein", color: "purple" },
                { name: "脂肪", key: "fat", color: "mint" },
              ] as const
            ).map((n) => (
              <div key={n.key}>
                <span className={`nt-dot ${n.color}`} />
                <span>{n.name}</span>
                <strong>
                  {loading
                    ? "—"
                    : !meals.length
                      ? "暂无记录"
                      : sum[n.key].complete
                        ? `${display(sum[n.key].known)}g`
                        : sum[n.key].known
                          ? `${display(sum[n.key].known)}g 已知`
                          : "未知"}
                </strong>
                <small>
                  {meals.length && !sum[n.key].complete ? "部分数据未知" : ""}
                </small>
              </div>
            ))}
          </div>
        </div>
        <div className="nt-meal-filter" aria-label="餐次筛选">
          {(["all", ...Object.keys(mealLabels)] as (MealType | "all")[]).map(
            (t) => (
              <button
                key={t}
                className={filter === t ? "active" : ""}
                aria-pressed={filter === t}
                onClick={() => setFilter(t)}
              >
                {t === "all" ? "全部餐次" : mealLabels[t]}
                <small>
                  {meals.filter((m) => t === "all" || m.mealType === t).length}
                </small>
              </button>
            ),
          )}
        </div>
        {loading ? (
          <div className="nt-empty" role="status">
            <LoaderCircle size={26} className="nt-spin" />
            <p>正在读取你的饮食日记…</p>
          </div>
        ) : error ? (
          <div className="nt-empty">
            <p>暂时无法读取记录，请重试。</p>
          </div>
        ) : !list.length ? (
          <div className="nt-empty nt-diary-empty">
            <div className="nt-empty-icon">
              <Utensils size={28} />
            </div>
            <h3>
              {meals.length
                ? "这一个餐次，还没有记录"
                : "从这一餐，开始好好照顾自己"}
            </h3>
            <p>不用追求完美，记下实际吃了些什么就好。</p>
            <button
              className="outline-button"
              disabled={!me}
              onClick={() => setEditor({})}
            >
              <Plus size={16} /> 记录一餐
            </button>
          </div>
        ) : (
          <div className="nt-meal-list">
            {list.map((m) => (
              <button
                className="nt-meal-card"
                key={m.id}
                onClick={() => openDetail(m)}
              >
                <div className={`nt-meal-icon ${m.mealType}`}>
                  {m.mealType === "breakfast"
                    ? "🥑"
                    : m.mealType === "snack"
                      ? "🍎"
                      : "🥗"}
                </div>
                <div className="nt-meal-copy">
                  <div>
                    <span>{mealLabels[m.mealType]}</span>
                    <small>
                      {new Intl.DateTimeFormat("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }).format(new Date(m.recordedAt))}
                    </small>
                  </div>
                  <h3>{m.items.map((x) => x.name).join("、")}</h3>
                  <p>
                    {m.items.length}项食物 ·{" "}
                    {display(m.items.reduce((n, x) => n + x.grams, 0))}g{" "}
                    <span>
                      {m.source === "photo" ? "照片记录" : "手动记录"}
                    </span>
                  </p>
                </div>
                <div className="nt-meal-kcal">
                  <strong>{display(m.totals.caloriesKcal)}</strong>
                  <small>千卡</small>
                </div>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        )}
        <p className="nt-hint nt-diary-foot">
          营养值来自你确认的食物与份量；估算不等于实际测量。
        </p>
      </section>
      <aside className="nt-inspiration">
        <img src="/salad.svg" alt="搭配蔬菜、主食与蛋白质的餐盘插画" />
        <div>
          <span className="nt-eyebrow">给餐盘，多一点颜色</span>
          <h3>不必对美食说不，找到自己的均衡。</h3>
          <p>蔬菜、主食和蛋白质，都留一个位置。慢慢吃，也听听身体的声音。</p>
        </div>
        <Leaf size={29} />
      </aside>
      {capabilities && me && (
        <Nearby
          client={client}
          capabilities={capabilities}
          userId={me.userId}
        />
      )}
      {editor && (
        <MealEditor
          key={editor.meal?.id ?? editor.recognition?.jobId ?? "new"}
          client={client}
          date={date || today}
          meal={editor.meal}
          recognition={editor.recognition}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {capabilities && (
        <PhotoFlow
          open={photo && !editor}
          client={client}
          capabilities={capabilities}
          onCapabilitiesChange={setCapabilities}
          onClose={() => setPhoto(false)}
          onManual={() => {
            setPhoto(false);
            setEditor({});
          }}
          onRecognized={(r) => {
            setPhoto(false);
            setEditor({ recognition: r });
          }}
        />
      )}
      <Dialog
        open={!!detail && !editor && !remove}
        title="这一餐的记录"
        onClose={() => { detailRequest.current?.abort(); setDetail(null); }}
      >
        {detail && (
          <>
            <div className="nt-meal-detail-head">
              <span className="nt-status-pill">
                {mealLabels[detail.mealType]} · {detail.businessDate}
              </span>
              <h3>
                {display(detail.totals.caloriesKcal)} <small>千卡</small>
              </h3>
            </div>
            {detail.photoUrl && !photoUnavailable && (
              <div className="nt-photo-preview">
                <img src={detail.photoUrl} alt="这一餐的餐食照片" onError={() => setPhotoUnavailable(true)} />
              </div>
            )}
            {photoUnavailable && <p className="nt-hint">照片暂时无法读取，请关闭详情后重试。饮食记录已保留。</p>}
            <div className="nt-detail-items">
              {detail.items.map((x) => (
                <div key={x.id}>
                  <div>
                    <strong>{x.name}</strong>
                    <small>
                      {x.grams}g ·{" "}
                      {x.nutritionSource === "catalog"
                        ? "食物库"
                        : x.nutritionSource === "model"
                          ? "模型估算"
                          : "人工填写"}
                    </small>
                    <p>
                      碳水{x.carbsG === null ? "未知" : `${x.carbsG}g`} · 蛋白质
                      {x.proteinG === null ? "未知" : `${x.proteinG}g`} · 脂肪
                      {x.fatG === null ? "未知" : `${x.fatG}g`}
                    </p>
                  </div>
                  <b>
                    {x.caloriesKcal}
                    <small> 千卡</small>
                  </b>
                </div>
              ))}
            </div>
            <div className="nt-add-row">
              <button
                className="outline-button"
                onClick={() => setEditor({ meal: detail })}
              >
                <Pencil size={16} /> 编辑记录
              </button>
              <button
                className="outline-button nt-danger"
                onClick={() => {
                  deleteKey.current = newKey();
                  setDeleteError("");
                  setRemove(detail);
                }}
              >
                <Trash2 size={16} /> 删除记录
              </button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={!!remove}
        title="删除这一餐？"
        onClose={() => {
          if (!deleting) setRemove(null);
        }}
      >
        <p className="nt-hint">
          删除后不再计入摄入统计。已经获得的日任务奖励资格不会重置。
        </p>
        {deleteError && (
          <p className="nt-error" role="alert">
            {deleteError}
          </p>
        )}
        <div className="nt-add-row">
          <button
            className="outline-button"
            disabled={deleting}
            onClick={() => setRemove(null)}
          >
            保留记录
          </button>
          <button
            className="primary-button nt-delete-button"
            disabled={deleting}
            onClick={confirmDelete}
          >
            {deleting ? (
              <LoaderCircle className="nt-spin" size={16} />
            ) : (
              <Trash2 size={16} />
            )}{" "}
            {deleting ? "正在删除" : "确认删除"}
          </button>
        </div>
      </Dialog>
      {notice && (
        <div className="toast" role="status">
          <Check size={15} /> {notice}
        </div>
      )}
    </div>
  );
}
