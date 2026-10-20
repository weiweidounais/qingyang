"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronRight,
  Plus,
  Droplets,
  Flame,
  Footprints,
  Scale,
  Camera,
  MapPin,
  CalendarDays,
  Sparkles,
  Check,
  ArrowDown,
  Sun,
} from "lucide-react";
import { useHealth } from "@/components/health-provider";
import { Dialog } from "@/components/dialog";
import { ProgressRing, TrendChart } from "@/components/health-charts";
import { balance, shanghaiDate } from "@/lib/health/reducer";
export function Dashboard() {
  const { state, dispatch, today, ready } = useHealth();
  const [selected, setSelected] = useState<string | null>(null);
  const date = selected ?? today;
  const [weightOpen, setWeightOpen] = useState(false);
  const [weight, setWeight] = useState("58.6");
  const record = state.dailyRecords[date] ?? { water: 0 };
  const intake = state.meals
    .filter((m) => m.date === date)
    .reduce((n, m) => n + m.calories, 0);
  const burned = state.completedWorkouts
    .filter((x) => x.date === date)
    .reduce((n, x) => n + x.calories, 0);
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today + "T12:00:00+08:00");
    d.setUTCDate(d.getUTCDate() - 6 + i);
    return d.toISOString().slice(0, 10);
  });
  const history = Object.entries(state.dailyRecords)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, r]) => r.weight !== undefined);
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="greeting">
            <Sun size={16} />
            嗨，小予，今天也要好好照顾自己
          </p>
          <h1>每一点改变，都算数。</h1>
          <p className="muted">
            吃得均衡，动得开心，把生活慢慢调成喜欢的样子。
          </p>
        </div>
        <Link href="/overview" className="outline-button desktop-only">
          健康数据大屏
          <ArrowUpRight size={16} />
        </Link>
      </section>
      <div className="dashboard-layout">
        <div className="dashboard-left">
          <section className="daily-hero">
            <div className="section-head">
              <h2>
                今日健康日记{" "}
                <span className="subtle-badge">
                  {date.slice(5).replace("-", "月")}日
                </span>
              </h2>
              <CalendarDays size={19} />
            </div>
            <div className="week-strip">
              {dates.map((d) => (
                <button
                  key={d}
                  className={d === date ? "selected" : ""}
                  onClick={() => setSelected(d)}
                >
                  <span>
                    {
                      ["日", "一", "二", "三", "四", "五", "六"][
                        new Date(d + "T12:00:00+08:00").getUTCDay()
                      ]
                    }
                  </span>
                  <strong>{Number(d.slice(-2))}</strong>
                  <i
                    className={
                      state.meals.some((m) => m.date === d) ? "has-record" : ""
                    }
                  />
                </button>
              ))}
            </div>
            <div className="hero-data">
              <ProgressRing value={intake} total={1800 + burned} />
              <div className="hero-stats">
                <div>
                  <span className="stat-icon peach">
                    <UtensilIcon />
                  </span>
                  <p>
                    食物摄入
                    <strong>
                      {intake.toLocaleString()}
                      <small>千卡</small>
                    </strong>
                  </p>
                </div>
                <div>
                  <span className="stat-icon lilac">
                    <Flame size={21} />
                  </span>
                  <p>
                    运动消耗
                    <strong>
                      {burned}
                      <small>千卡</small>
                    </strong>
                  </p>
                </div>
                <p className="hero-hint">
                  今天也在向更好的自己靠近
                  <small>按自己的节奏，慢慢来就好。</small>
                </p>
              </div>
            </div>
            <div className="nutrition-bars">
              {[
                {
                  name: "碳水",
                  v: Math.round(intake * 0.12),
                  total: 225,
                  color: "orange",
                },
                {
                  name: "蛋白质",
                  v: Math.round(intake * 0.065),
                  total: 90,
                  color: "purple",
                },
                {
                  name: "脂肪",
                  v: Math.round(intake * 0.025),
                  total: 60,
                  color: "green",
                },
              ].map((x) => (
                <div key={x.name}>
                  <div>
                    <span>
                      <i className={x.color} />
                      {x.name}
                    </span>
                    <small>
                      {x.v} / {x.total} g
                    </small>
                  </div>
                  <div className="progress-track">
                    <span
                      className={x.color}
                      style={{
                        width: Math.min((x.v / x.total) * 100, 100) + "%",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <span className="estimate-note">营养素为演示估算</span>
          </section>
          <div className="metric-grid">
            <section className="card water-card">
              <div className="section-head">
                <h2>
                  <Droplets size={19} />
                  喝水，给身体充充电
                </h2>
                <span className="muted tiny">目标 2,000 ml</span>
              </div>
              <div className="metric-number">
                <strong data-testid="water-value">
                  {record.water.toLocaleString()}
                </strong>
                <span>ml</span>
                <small>{Math.round((record.water / 2000) * 100)}%</small>
              </div>
              <div className="water-cups">
                {Array.from({ length: 8 }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < Math.floor(record.water / 250) ? "filled" : ""
                    }
                  >
                    <Droplets size={24} />
                  </span>
                ))}
              </div>
              <button
                className="soft-button"
                disabled={!ready || date !== today || record.water >= 6000}
                onClick={() =>
                  dispatch({ type: "water", date: shanghaiDate() })
                }
              >
                <Plus size={16} />
                喝一杯水<span>250 ml</span>
              </button>
            </section>
            <section className="card weight-card">
              <div className="section-head">
                <h2>
                  <Scale size={19} />
                  体重小变化
                </h2>
                <button
                  className="icon-button"
                  aria-label="记录体重"
                  onClick={() => setWeightOpen(true)}
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="metric-number">
                <strong>{record.weight ?? "—"}</strong>
                <span>kg</span>
                <small>
                  <ArrowDown size={12} />
                  0.8 kg
                </small>
              </div>
              <TrendChart
                values={history.map(([, r]) => r.weight!)}
                labels={["本周一", "目标 " + state.goal + " kg", "今天"]}
              />
            </section>
          </div>
          <section className="card meal-summary">
            <div className="section-head">
              <div>
                <h2>认真吃饭，也是爱自己</h2>
                <p className="muted tiny">今天的每一餐，都值得被好好记录</p>
              </div>
              <Link className="text-link" href="/nutrition">
                查看日记
                <ChevronRight size={15} />
              </Link>
            </div>
            <div className="meal-summary-body">
              <div className="meal-thumb">
                <img src="/salad.svg" alt="蔬菜鸡胸肉沙拉插画" />
              </div>
              <div>
                <span className="tag mint">今日午餐</span>
                <h3>香煎鸡胸藜麦沙拉</h3>
                <p className="muted tiny">高蛋白 · 膳食纤维 · 清爽饱腹</p>
                <strong>
                  425 <small>千卡</small>
                </strong>
              </div>
              <Link className="camera-quick" href="/nutrition?photo=1">
                <Camera size={22} />
                <span>拍照记录下一餐</span>
              </Link>
            </div>
          </section>
        </div>
        <div className="dashboard-right">
          <section className="buddy-card">
            <div className="section-head">
              <span className="tag white">
                <span className="online-dot" />
                你的 AI 健康搭子
              </span>
              <Sparkles size={18} />
            </div>
            <h2>
              健康这件事，
              <br />
              我们一起慢慢来。
            </h2>
            <p>我是小养，一直在你身边。</p>
            <img
              className="buddy-art"
              src="/buddy.svg"
              alt="小养，头顶嫩叶的紫色健康陪伴精灵"
            />
            <div className="buddy-chat">
              <span>“今天的你，感觉怎么样？”</span>
              <Link href="/companion">
                和小养聊聊
                <ArrowUpRight size={16} />
              </Link>
            </div>
          </section>
          <section className="card training-summary">
            <div className="section-head">
              <h2>今天，动一小会儿</h2>
              <Link href="/training" className="text-link">
                计划
                <ChevronRight size={14} />
              </Link>
            </div>
            <div className="training-mini">
              <span>🧘🏻‍♀️</span>
              <div>
                <h3>全身舒展 · 唤醒活力</h3>
                <p className="muted tiny">15 分钟 · 新手友好</p>
              </div>
            </div>
            <Link className="primary-button" href="/training">
              <Footprints size={17} />
              开启今日训练
              <ChevronRight size={16} />
            </Link>
          </section>
          <section className="points-teaser">
            <span className="points-symbol">✦</span>
            <div>
              <h3>每份坚持，都有回响</h3>
              <p>
                你已积累 <strong>{balance(state)}</strong> 积分
              </p>
            </div>
            <Link href="/profile" aria-label="查看积分">
              <ChevronRight size={20} />
            </Link>
          </section>
        </div>
      </div>
      <section className="quick-links">
        <Link href="/nutrition">
          <span className="quick-icon peach">
            <Camera />
          </span>
          <div>
            <h3>一拍，记录美味</h3>
            <p>饮食拍照识别</p>
          </div>
          <ArrowUpRight />
        </Link>
        <Link href="/nutrition#nearby">
          <span className="quick-icon mint">
            <MapPin />
          </span>
          <div>
            <h3>发现附近好食光</h3>
            <p>健康餐饮推荐</p>
          </div>
          <ArrowUpRight />
        </Link>
        <Link href="/profile#activities">
          <span className="quick-icon lilac">
            <CalendarDays />
          </span>
          <div>
            <h3>找个搭子，一起出发</h3>
            <p>健康活动与预约</p>
          </div>
          <ArrowUpRight />
        </Link>
      </section>
      <footer className="page-footer">
        轻养陪你，把健康过成日常。<span>本页为产品框架演示 · 数据仅供体验</span>
      </footer>
      <Dialog
        open={weightOpen}
        onClose={() => setWeightOpen(false)}
        title="记录体重"
      >
        <p className="muted">记录当下的自己，不必被数字定义。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            dispatch({
              type: "weight",
              date: selected ?? shanghaiDate(),
              value: Number(weight),
            });
            setWeightOpen(false);
          }}
        >
          <label>
            体重（kg）
            <input
              required
              type="number"
              min="20"
              max="350"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <button className="primary-button" disabled={!ready}>
            保存记录
          </button>
        </form>
      </Dialog>
    </>
  );
}
function UtensilIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M4 3v6q0 4 4 4V3m-4 5h4m-2 5v8M18 3q-5 5-2 10h3V3m0 10v8" />
    </svg>
  );
}
