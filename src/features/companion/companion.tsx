"use client";
import { shanghaiDate } from "@/lib/health/reducer";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Sparkles, Heart } from "lucide-react";
import { useHealth } from "@/components/health-provider";
import { demoReply } from "@/lib/health/services";
export function Companion() {
  const { state, dispatch, today, ready } = useHealth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const mood = state.moods.find((x) => x.date === today)?.value;
  useEffect(() => {
    history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [state.messages, busy]);
  async function send(value: string) {
    if (!value.trim() || value.length > 2000 || lock.current || !ready) return;
    lock.current = true;
    setBusy(true);
    setText("");
    dispatch({
      type: "message",
      id: crypto.randomUUID(),
      role: "user",
      text: value.trim(),
    });
    try {
      const reply = await demoReply(value);
      dispatch({
        type: "message",
        id: crypto.randomUUID(),
        role: "assistant",
        text: reply,
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="greeting">
            <Heart size={15} />
            身体要照顾，心情也是
          </p>
          <h1>不必一个人，消化所有情绪。</h1>
          <p className="muted">开心的、疲惫的、说不清的，小养都愿意听。</p>
        </div>
      </section>
      <div className="companion-layout">
        <aside className="companion-intro">
          <span className="tag">
            <span className="online-dot" />
            小养一直在
          </span>
          <img src="/buddy.svg" alt="你的健康搭子小养" />
          <h2>嗨，我是小养。</h2>
          <p>
            今天也很高兴见到你。
            <br />
            一起把平凡的日子过得暖一点。
          </p>
          <div className="mood-box">
            <h3>此刻的你，是什么心情？</h3>
            <div className="mood-options">
              {[
                { e: "😊", v: "开心" },
                { e: "😌", v: "平静" },
                { e: "😮‍💨", v: "疲惫" },
                { e: "😔", v: "低落" },
              ].map((x) => (
                <button
                  key={x.v}
                  disabled={!ready}
                  className={mood === x.v ? "selected" : ""}
                  aria-pressed={mood === x.v}
                  onClick={() =>
                    dispatch({ type: "mood", date: shanghaiDate(), value: x.v })
                  }
                >
                  {x.e}
                  <span>{x.v}</span>
                </button>
              ))}
            </div>
            <p>
              {mood ? "已记录今天的心情：" + mood : "记录心情，也是照顾自己"}
            </p>
          </div>
        </aside>
        <section className="chat-panel">
          <header className="chat-header">
            <div className="chat-avatar">
              <img src="/buddy.svg" alt="" />
            </div>
            <div>
              <h2>
                小养{" "}
                <span
                  className="online-dot"
                  style={{ display: "inline-block", marginLeft: 5 }}
                />
              </h2>
              <small>你的 AI 健康搭子 · 模拟聊天</small>
            </div>
            <Sparkles
              size={18}
              style={{ marginLeft: "auto", color: "#b6a1d7" }}
            />
          </header>
          <div className="chat-history" ref={history} aria-live="polite">
            <div className="chat-date">今天 · 给自己一点温柔的时间</div>
            <div className="chat-message">
              <div className="bubble">
                嗨，小予 🌱
                <br />
                今天过得怎么样？不管是想聊聊心情，还是分享一件小事，我都在这里。
              </div>
            </div>
            <div className="quick-prompts">
              {[
                "今天有点累，想聊聊",
                "帮我记录一下午餐",
                "给今天的自己一点鼓励",
              ].map((x) => (
                <button
                  key={x}
                  disabled={busy || !ready}
                  onClick={() => send(x)}
                >
                  {x}
                </button>
              ))}
            </div>
            <div className="mobile-moods">
              <p className="muted tiny">此刻的心情</p>
              <div className="mood-options">
                {["😊 开心", "😌 平静", "😮‍💨 疲惫", "😔 低落"].map((x) => (
                  <button
                    key={x}
                    className={
                      mood === x.slice(x.indexOf(" ") + 1) ? "selected" : ""
                    }
                    disabled={!ready}
                    onClick={() =>
                      dispatch({
                        type: "mood",
                        date: shanghaiDate(),
                        value: x.slice(x.indexOf(" ") + 1),
                      })
                    }
                  >
                    <span>{x}</span>
                  </button>
                ))}
              </div>
              {mood && <p className="success">已记录：{mood}</p>}
            </div>
            {state.messages.map((m) => (
              <div key={m.id} className={"chat-message " + m.role}>
                <div className="bubble">{m.text}</div>
              </div>
            ))}
            {busy && (
              <div className="chat-message">
                <div className="bubble">小养正在整理演示回复…</div>
              </div>
            )}
          </div>
          <div className="chat-compose">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              <input
                aria-label="聊天内容"
                placeholder="想聊什么，都可以告诉我…"
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                className="primary-button"
                aria-label="发送消息"
                disabled={!text.trim() || busy || !ready}
              >
                <ArrowUp size={20} />
              </button>
            </form>
            <p>当前为预设回复演示，不提供心理诊断或医疗建议。</p>
          </div>
        </section>
      </div>
      <footer className="page-footer">
        有人陪伴的日常，温柔一点点。<span>情绪记录仅保存在当前浏览器</span>
      </footer>
    </>
  );
}
