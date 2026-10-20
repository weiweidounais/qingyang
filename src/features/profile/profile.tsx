"use client";
import { useState } from "react";
import {
  Check,
  Gift,
  CalendarDays,
  MapPin,
  Users,
  Heart,
  Target,
  ChevronRight,
  Leaf,
  Star,
} from "lucide-react";
import { useHealth } from "@/components/health-provider";
import { Dialog } from "@/components/dialog";
import { balance, shanghaiDate } from "@/lib/health/reducer";
import { activities, restaurants } from "@/lib/health/seed";
import Link from "next/link";
export function Profile() {
  const { state, dispatch, today, ready } = useHealth();
  const [activity, setActivity] = useState<(typeof activities)[number] | null>(
    null,
  );
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [goal, setGoal] = useState(String(state.goal));
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const points = balance(state);
  const signed = state.ledger.some((x) => x.key === "sign:" + today);
  const redeemed = state.ledger.some(
    (x) => x.key === `redeem:journal:${today}`,
  );
  const tasks = [
    {
      name: "每天见面，打个招呼",
      points: 10,
      done: signed,
      href: "#",
      key: "sign",
    },
    {
      name: "好好记录一餐",
      points: 10,
      done: state.ledger.some((x) => x.key === "meal:" + today),
      href: "/nutrition",
      key: "meal",
    },
    {
      name: "给身体补充水分",
      points: 5,
      done: state.ledger.some((x) => x.key === "water:" + today),
      href: "/dashboard",
      key: "water",
    },
    {
      name: "完成一次轻松训练",
      points: 20,
      done: state.completedWorkouts.some((x) => x.date === today),
      href: "/training",
      key: "workout",
    },
  ];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="greeting">
            <Leaf size={15} />
            每一份坚持，都在悄悄改变你
          </p>
          <h1>成为，更喜欢的自己。</h1>
          <p className="muted">收集努力，遇见同频的人，让健康不再孤单。</p>
        </div>
      </section>
      <section className="profile-banner">
        <div className="avatar">Y</div>
        <div>
          <h2>小予</h2>
          <p>好好生活的第 12 天 · 演示档案</p>
          <span className="tag white" style={{ marginTop: 10 }}>
            <Target size={12} />
            目标：规律生活，轻盈有力
          </span>
        </div>
        <button
          className="outline-button"
          onClick={() => {
            setGoal(String(state.goal));
            setGoalsOpen(true);
          }}
        >
          健康档案
          <ChevronRight size={14} />
        </button>
      </section>
      <div className="profile-columns">
        <section className="card points-card">
          <div className="section-head">
            <h2>
              <Star size={17} />
              我的健康积分
            </h2>
            <span className="tag white">坚持有回响</span>
          </div>
          <div className="points-value">
            <strong data-testid="points-balance">{points}</strong>
            <span>积分</span>
          </div>
          <p className="muted tiny">每一次认真生活，都值得一份小小的奖励。</p>
          <div className="row-actions" style={{ marginTop: 20 }}>
            <button
              className="primary-button"
              disabled={signed || !ready}
              onClick={() => dispatch({ type: "sign", date: shanghaiDate() })}
            >
              {signed ? <Check size={16} /> : <Gift size={16} />}{" "}
              {signed ? "今日已签到" : "签到领 10 积分"}
            </button>
            <button className="text-link" onClick={() => setExchangeOpen(true)}>
              积分好物
              <ChevronRight size={14} />
            </button>
          </div>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>今日的小目标</h2>
            <small className="muted">
              {tasks.filter((t) => t.done).length} / 4 完成
            </small>
          </div>
          {tasks.map((t) => (
            <div className="task-row" key={t.key}>
              <div>
                <strong>{t.name}</strong>
                <p>+{t.points} 积分</p>
              </div>
              {t.done ? (
                <span className="saved-mark">
                  <Check size={13} />
                  已完成
                </span>
              ) : t.key === "sign" ? (
                <button
                  className="tag lilac"
                  disabled={!ready}
                  onClick={() =>
                    dispatch({ type: "sign", date: shanghaiDate() })
                  }
                >
                  去签到
                </button>
              ) : (
                <Link className="tag lilac" href={t.href}>
                  去完成
                  <ChevronRight size={11} />
                </Link>
              )}
            </div>
          ))}
        </section>
      </div>
      <section id="activities" className="section-space">
        <div className="section-title">
          <div>
            <h2>和同频的人，一起出发</h2>
            <p>发现健康活动，预约属于你的好时光</p>
          </div>
          <span className="tag lilac">社交活动演示</span>
        </div>
        <div className="activity-grid">
          {activities.map((a) => (
            <article className="card activity-card" key={a.id}>
              <div className={"activity-art " + a.color}>{a.emoji}</div>
              <div>
                <span className={"tag " + a.color}>{a.category}</span>
                <h3>{a.name}</h3>
                <p>{a.time}</p>
                <p>
                  <MapPin size={10} style={{ verticalAlign: "middle" }} />{" "}
                  {a.place}
                </p>
                <button
                  className="outline-button"
                  aria-label="查看活动"
                  onClick={() => setActivity(a)}
                >
                  {state.bookings.includes(a.id)
                    ? "已预约 · 查看活动"
                    : "查看活动"}
                  <ChevronRight size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
        <p className="subsection-note">
          活动、场地与成员均为演示，预约仅在本机记录，不产生真实名额。
        </p>
      </section>
      <div className="profile-columns">
        <section className="card">
          <div className="section-head">
            <h2>
              <Gift size={17} />
              积分小记
            </h2>
            <small className="muted">本地演示流水</small>
          </div>
          <div className="ledger-list">
            {[...state.ledger].reverse().map((x) => (
              <div className="ledger-row" key={x.key}>
                <div>
                  {x.label}
                  <small>{x.date}</small>
                </div>
                <strong>
                  {x.points > 0 ? "+" : ""}
                  {x.points}
                </strong>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="section-head">
            <h2>
              <Heart size={17} />
              收藏的好食光
            </h2>
            <Link href="/nutrition#nearby" className="text-link">
              发现更多
              <ChevronRight size={13} />
            </Link>
          </div>
          {state.favorites.length ? (
            restaurants
              .filter((x) => state.favorites.includes(x.id))
              .map((x) => (
                <div className="task-row" key={x.id}>
                  <div>
                    <strong>
                      {x.emoji} {x.name}
                    </strong>
                    <p>{x.tag} · 演示商家</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={"取消收藏" + x.name}
                    onClick={() => dispatch({ type: "favorite", id: x.id })}
                  >
                    <Heart size={15} fill="currentColor" />
                  </button>
                </div>
              ))
          ) : (
            <div className="empty" style={{ marginTop: 18, padding: 25 }}>
              还没有收藏的餐厅
              <br />
              <Link className="text-link" href="/nutrition#nearby">
                去发现附近好食光
                <ChevronRight size={14} />
              </Link>
            </div>
          )}
        </section>
      </div>
      <footer className="page-footer">
        你走过的每一步，都算数。<span>个人记录与积分仅保存在当前浏览器</span>
      </footer>
      <Dialog
        open={!!activity}
        onClose={() => setActivity(null)}
        title={activity?.name ?? "活动详情"}
      >
        {activity && (
          <>
            <div className="detail-emoji">{activity.emoji}</div>
            <p>{activity.desc}</p>
            <div className="details-list">
              <div>
                <CalendarDays size={16} />
                {activity.time}
              </div>
              <div>
                <MapPin size={16} />
                {activity.place}
              </div>
              <div>
                <Users size={16} />
                {activity.people}（演示）
              </div>
            </div>
            <div className="note-block">
              这是演示活动。点击预约只会更新本地状态，不会通知主办方或占用真实名额。
            </div>
            <button
              className="primary-button full-width"
              disabled={!ready}
              onClick={() =>
                dispatch({
                  type: state.bookings.includes(activity.id)
                    ? "cancel"
                    : "book",
                  id: activity.id,
                })
              }
            >
              {state.bookings.includes(activity.id) ? "取消预约" : "预约活动"}
            </button>
          </>
        )}
      </Dialog>
      <Dialog
        open={goalsOpen}
        onClose={() => setGoalsOpen(false)}
        title="我的健康档案"
      >
        <p className="muted">按自己的节奏，记录健康生活的方向。</p>
        <div className="note-block">
          昵称：小予（演示）
          <br />
          当前体重：{state.dailyRecords[today]?.weight ?? "暂无"} kg
          <br />
          每日饮水目标：2,000 ml · 热量目标：1,800 千卡（演示）
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            dispatch({ type: "goal", value: Number(goal) });
            setGoalsOpen(false);
          }}
        >
          <label>
            目标体重（kg）
            <input
              required
              type="number"
              min="20"
              max="350"
              step="0.1"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>
          <button className="primary-button" disabled={!ready}>
            保存目标
          </button>
        </form>
      </Dialog>
      <Dialog
        open={exchangeOpen}
        onClose={() => {
          setExchangeOpen(false);
          setNotice("");
        }}
        title="积分好物"
      >
        <div className="detail-emoji">📔</div>
        <h3 style={{ textAlign: "center" }}>轻养健康手账 · 数字纪念版</h3>
        <p className="muted" style={{ textAlign: "center", marginTop: 8 }}>
          200 积分 · 当前余额 {points}
        </p>
        <div className="note-block">
          兑换为本地演示，不提供实物或数字商品履约。确认后扣除 200
          积分并生成流水，每日限一次。
        </div>
        {notice && (
          <p role="status" className={points < 200 ? "error" : "success"}>
            {notice}
          </p>
        )}
        <button
          className="primary-button full-width"
          disabled={redeemed || !ready}
          onClick={() => {
            if (points < 200) {
              setNotice("积分不足，先完成一些今日小目标吧。");
              return;
            }
            dispatch({
              type: "redeem",
              id: "journal",
              cost: 200,
              date: shanghaiDate(),
            });
            setNotice("已完成演示兑换，积分流水已更新。");
          }}
        >
          {redeemed ? "今日已兑换" : "确认兑换 · 200 积分"}
        </button>
      </Dialog>
    </>
  );
}
