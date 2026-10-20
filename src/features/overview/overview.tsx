"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Leaf,
  Droplets,
  Flame,
  Footprints,
  Scale,
  Heart,
  Check,
} from "lucide-react";
import { useHealth } from "@/components/health-provider";
import { TrendChart } from "@/components/health-charts";
import { balance } from "@/lib/health/reducer";
export function Overview() {
  const { state, today } = useHealth();
  const [range, setRange] = useState(7);
  const dates = Array.from({ length: range }, (_, i) => {
    const d = new Date(today + "T12:00:00+08:00");
    d.setUTCDate(d.getUTCDate() - range + 1 + i);
    return d.toISOString().slice(0, 10);
  });
  const meals = state.meals.filter((m) => dates.includes(m.date));
  const water = dates.reduce(
    (n, d) => n + (state.dailyRecords[d]?.water ?? 0),
    0,
  );
  const active = dates.filter((d) => state.dailyRecords[d]).length;
  const workout = state.completedWorkouts.filter((w) => dates.includes(w.date));
  const weightDates = dates.filter(
    (d) => state.dailyRecords[d]?.weight !== undefined,
  );
  const weights = weightDates.map((d) => state.dailyRecords[d].weight!);
  const intake = meals.reduce((n, x) => n + x.calories, 0);
  const avg = Math.round(
    intake / Math.max(new Set(meals.map((m) => m.date)).size, 1),
  );
  const labelDates = weightDates.length
    ? [
        weightDates[0].slice(5),
        weightDates[Math.floor(weightDates.length / 2)].slice(5),
        weightDates[weightDates.length - 1].slice(5),
      ]
    : [];
  return (
    <>
      <header className="overview-header">
        <div>
          <p className="greeting">
            <Leaf size={15} />
            轻养 · 健康数据空间
          </p>
          <h1>看见坚持，留下的变化。</h1>
          <p>{today} · 演示数据与本地记录汇总</p>
        </div>
        <div className="filter-row">
          <div className="range-select">
            {[7, 30].map((n) => (
              <button
                key={n}
                aria-pressed={range === n}
                className={range === n ? "active" : ""}
                onClick={() => setRange(n)}
              >
                近 {n} 天
              </button>
            ))}
          </div>
          <Link className="outline-button" href="/dashboard">
            <ArrowLeft size={14} />
            返回应用
          </Link>
        </div>
      </header>
      <div className="overview-stat-grid">
        {[
          {
            name: "日均记录摄入",
            value: avg.toLocaleString(),
            unit: "千卡",
            icon: Flame,
            cls: "peach",
          },
          {
            name: "日均饮水",
            value: Math.round(water / Math.max(active, 1)).toLocaleString(),
            unit: "ml",
            icon: Droplets,
            cls: "blue",
          },
          {
            name: "完成训练",
            value: workout.length,
            unit: "次",
            icon: Footprints,
            cls: "lilac",
          },
          {
            name: "最新体重",
            value: weights.length ? weights[weights.length - 1] : "—",
            unit: "kg",
            icon: Scale,
            cls: "mint",
          },
        ].map((x) => (
          <section className="card" key={x.name}>
            <div className="section-head">
              <h3>{x.name}</h3>
              <span className={"stat-icon " + x.cls}>
                <x.icon size={19} />
              </span>
            </div>
            <strong>
              {x.value} <small>{x.unit}</small>
            </strong>
            <small>{range} 天范围 · 按已有记录计算</small>
          </section>
        ))}
      </div>
      <div className="overview-charts">
        <section className="card">
          <div className="section-head">
            <h2>体重变化趋势</h2>
            <span className="tag mint">目标 {state.goal} kg</span>
          </div>
          {weights.length ? (
            <TrendChart values={weights} labels={labelDates} />
          ) : (
            <div className="empty">该范围暂无体重记录</div>
          )}
          <p className="subsection-note">
            仅显示已记录的日期，变化不是评价自己的唯一标准。
          </p>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>饮水记录</h2>
            <small className="muted">最近 7 天 · ml</small>
          </div>
          <div className="vertical-bars">
            {dates.slice(-7).map((d) => (
              <div key={d}>
                <span
                  title={String(state.dailyRecords[d]?.water ?? 0) + " ml"}
                  style={{
                    height:
                      Math.min(
                        ((state.dailyRecords[d]?.water ?? 0) / 2500) * 100,
                        100,
                      ) + "%",
                  }}
                />
                {d.slice(5).replace("-", "/")}
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="overview-lower">
        <section className="card">
          <div className="section-head">
            <h2>每一份运动都算数</h2>
            <Footprints size={18} />
          </div>
          <div className="metric-number">
            <strong>{workout.reduce((n, x) => n + x.calories, 0)}</strong>
            <span>千卡消耗</span>
          </div>
          <p className="muted tiny" style={{ marginTop: 15 }}>
            {workout.length
              ? "你已完成 " + workout.length + " 次训练。"
              : "还没有训练记录，今天开始动一小会儿吧。"}
          </p>
          <Link
            href="/training"
            className="text-link"
            style={{ marginTop: 15 }}
          >
            查看运动计划
          </Link>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>心情也值得看见</h2>
            <Heart size={18} />
          </div>
          <div className="metric-number">
            <strong>
              {state.moods.filter((m) => dates.includes(m.date)).length}
            </strong>
            <span>天心情记录</span>
          </div>
          <p className="muted tiny" style={{ marginTop: 15 }}>
            {state.moods.find((m) => m.date === today)
              ? "今天的心情：" +
                state.moods.find((m) => m.date === today)!.value
              : "今天的心情，愿意和小养说说吗？"}
          </p>
          <Link
            href="/companion"
            className="text-link"
            style={{ marginTop: 15 }}
          >
            去记录此刻心情
          </Link>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>努力，都有回响</h2>
            <Check size={18} />
          </div>
          <div className="metric-number">
            <strong>{balance(state)}</strong>
            <span>累计可用积分</span>
          </div>
          <p className="muted tiny" style={{ marginTop: 15 }}>
            已预约 {state.bookings.length} 个演示活动
            <br />
            健康的日子，也可以热热闹闹。
          </p>
          <Link href="/profile" className="text-link" style={{ marginTop: 15 }}>
            查看成长足迹
          </Link>
        </section>
      </div>
      <footer className="page-footer">
        轻养，让健康自然发生。<span>数据用于产品体验，非医疗测量或诊断</span>
      </footer>
    </>
  );
}
