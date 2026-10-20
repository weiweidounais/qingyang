"use client";
import { shanghaiDate } from "@/lib/health/reducer";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  Clock,
  Dumbbell,
  Flame,
  Play,
  Pause,
  CalendarDays,
} from "lucide-react";
import { useHealth } from "@/components/health-provider";
import { Dialog } from "@/components/dialog";
import { workouts } from "@/lib/health/seed";
export function Training() {
  const { state, dispatch, today, ready } = useHealth();
  const [filter, setFilter] = useState("全部");
  const [current, setCurrent] = useState<(typeof workouts)[number] | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const elapsed = useRef(0);
  const started = useRef(0);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [time, setTime] = useState(state.reminder.time);
  const completed = state.completedWorkouts.filter((x) => x.date === today);
  const [reminder, setReminder] = useState(state.reminder.enabled);
  useEffect(() => {
    if (!running) return;
    started.current = Date.now();
    const t = setInterval(
      () =>
        setSeconds(
          elapsed.current + Math.floor((Date.now() - started.current) / 1000),
        ),
      250,
    );
    return () => clearInterval(t);
  }, [running]);
  function pause() {
    elapsed.current += Math.floor((Date.now() - started.current) / 1000);
    setSeconds(elapsed.current);
    setRunning(false);
  }
  function close() {
    setRunning(false);
    setCurrent(null);
    setSeconds(0);
    elapsed.current = 0;
  }
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="greeting">
            <Dumbbell size={15} />
            让运动，成为生活里轻松的习惯
          </p>
          <h1>今天，给身体一点活力。</h1>
          <p className="muted">不用一下子跑很远，从喜欢的运动开始。</p>
        </div>
        <button
          className="outline-button"
          onClick={() => {
            setTime(state.reminder.time);
            setReminder(state.reminder.enabled);
            setReminderOpen(true);
          }}
          aria-label="训练提醒设置"
        >
          <Bell size={16} />
          <span className="desktop-only">训练提醒</span>
        </button>
      </section>
      <section className="feature-banner">
        <div>
          <span className="tag white">我的运动计划</span>
          <h2>
            动一小会儿，
            <br />
            收获满满好状态。
          </h2>
          <p>今日推荐：15 分钟全身舒展，跟着自己的节奏来。</p>
          <button
            className="primary-button"
            disabled={!ready}
            onClick={() => setCurrent(workouts[0])}
          >
            <Play size={16} />
            开始训练
          </button>
        </div>
        <span className="banner-icon" aria-hidden="true">
          🧘🏻‍♀️
        </span>
      </section>
      <div className="two-column">
        <section className="card">
          <div className="section-head">
            <h2>
              <CalendarDays size={17} />
              这周的运动节奏
            </h2>
            <span className="tag lilac">轻松养成</span>
          </div>
          <div className="week-strip">
            {["一", "二", "三", "四", "五", "六", "日"].map((x, i) => (
              <div
                key={x}
                style={{
                  textAlign: "center",
                  padding: "12px 0",
                  color: "#a69bb7",
                }}
              >
                <small>周{x}</small>
                <div style={{ fontSize: 20, marginTop: 7, color: "#a18ace" }}>
                  {i === 6 && completed.length ? (
                    <Check size={20} />
                  ) : i % 2 === 0 ? (
                    "✦"
                  ) : (
                    "·"
                  )}
                </div>
                <small style={{ fontSize: 8 }}>
                  {i % 2 === 0 ? "运动日" : "休息日"}
                </small>
              </div>
            ))}
          </div>
          <p className="muted tiny">
            示例周计划 · 本周安排 4 天活动，也别忘记好好休息。
          </p>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>
              <Flame size={17} />
              今天的努力
            </h2>
            <span className="tag mint">每一步都算</span>
          </div>
          <div className="metric-number">
            <strong>{completed.reduce((n, x) => n + x.calories, 0)}</strong>
            <span>千卡</span>
            <small>{completed.length} 次训练</small>
          </div>
          <p className="muted tiny" style={{ marginTop: 17 }}>
            {completed.length
              ? "今日已完成"
              : "还没有完成的训练，选一节喜欢的开始吧。"}
          </p>
          <p className="subsection-note">
            完成训练可获积分 · 训练消耗为演示估算
          </p>
        </section>
      </div>
      <section className="section-space">
        <div className="section-title">
          <div>
            <h2>找到你喜欢的运动</h2>
            <p>适合自己，才能轻松坚持</p>
          </div>
        </div>
        <div className="tabs">
          {["全部", "拉伸", "力量", "有氧"].map((x) => (
            <button
              key={x}
              className={filter === x ? "active" : ""}
              aria-pressed={filter === x}
              onClick={() => setFilter(x)}
            >
              {x}
            </button>
          ))}
        </div>
        <div className="workout-grid">
          {workouts
            .filter((x) => filter === "全部" || filter === x.category)
            .map((x) => (
              <article className="card workout-card" key={x.id}>
                <div className={"workout-art " + x.color}>
                  <span>{x.emoji}</span>
                  <span className="tag">{x.level}</span>
                </div>
                <div className="workout-content">
                  <h3>{x.name}</h3>
                  <p>
                    {x.minutes} 分钟 · 预计 {x.calories} 千卡 · {x.category}
                  </p>
                  <div className="row-actions">
                    <small>{x.level}</small>
                    <button
                      className="primary-button"
                      disabled={!ready}
                      onClick={() => setCurrent(x)}
                    >
                      {completed.some((c) => c.id === x.id)
                        ? "查看训练"
                        : "开始训练"}
                      <Play size={12} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
        </div>
      </section>
      <footer className="page-footer">
        动得开心，比数字更重要。
        <span>运动课程为演示内容 · 按自身情况调整强度</span>
      </footer>
      <Dialog open={!!current} onClose={close} title={current?.name ?? "训练"}>
        {current && (
          <>
            <div className="detail-emoji">{current.emoji}</div>
            <p>{current.desc}</p>
            <div className="note-block">
              {current.minutes} 分钟 · 预计 {current.calories} 千卡
              <br />
              此为训练计时演示，不含视频或动作检测。若有不适，请停止训练。
            </div>
            <div className="timer">
              {String(Math.floor(seconds / 60)).padStart(2, "0")}:
              {String(seconds % 60).padStart(2, "0")}
            </div>
            <div className="timer-actions">
              <button
                className="outline-button"
                onClick={() => {
                  if (running) pause();
                  else setRunning(true);
                }}
              >
                {running ? <Pause size={15} /> : <Play size={15} />}{" "}
                {running ? "暂停" : seconds ? "继续计时" : "开始计时"}
              </button>
              <button
                className="primary-button"
                disabled={completed.some((x) => x.id === current.id) || !ready}
                onClick={() => {
                  dispatch({
                    type: "workout",
                    id: current.id,
                    date: shanghaiDate(),
                  });
                  close();
                }}
              >
                <Check size={16} />
                {completed.some((x) => x.id === current.id)
                  ? "今日已打卡"
                  : "完成训练"}
              </button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        title="训练提醒"
      >
        <p className="muted">给自己一个温柔的提醒，把时间留给身体。</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            dispatch({ type: "reminder", enabled: reminder, time });
            setReminderOpen(false);
          }}
        >
          <div className="reminder-row">
            <span>开启每日提醒</span>
            <button
              type="button"
              role="switch"
              aria-label="每日训练提醒"
              aria-checked={reminder}
              className={"switch " + (reminder ? "on" : "")}
              onClick={() => setReminder(!reminder)}
            />
          </div>
          <label>
            提醒时间
            <input
              required
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <p className="note-block">
            首版仅在本机保存提醒设置，尚未接入系统通知或后台推送。
          </p>
          <button className="primary-button" disabled={!ready}>
            保存设置
          </button>
        </form>
      </Dialog>
    </>
  );
}
