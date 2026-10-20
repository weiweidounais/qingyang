"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Utensils,
  Dumbbell,
  MessageCircle,
  User,
  Leaf,
  ArrowUpRight,
  Sparkles,
  Camera,
  PanelTop,
  Heart,
  ChevronRight,
} from "lucide-react";
import { useHealth } from "./health-provider";
const nav = [
  { href: "/dashboard", label: "今日", sub: "健康日记", icon: LayoutDashboard },
  { href: "/nutrition", label: "饮食", sub: "好好吃饭", icon: Utensils },
  { href: "/training", label: "运动", sub: "轻松动起来", icon: Dumbbell },
  {
    href: "/companion",
    label: "AI 搭子",
    sub: "随时陪伴",
    icon: MessageCircle,
  },
  { href: "/profile", label: "我的", sub: "成长与生活", icon: User },
];
export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { ready, storageWarning } = useHealth();
  const overview = path === "/overview";
  return (
    <div className={overview ? "app full-screen" : "app"}>
      {!overview && (
        <aside className="sidebar">
          <Link className="brand" href="/dashboard">
            <span className="brand-mark">
              <Leaf size={26} />
            </span>
            <span>
              轻养<small>让健康，自然发生</small>
            </span>
          </Link>
          <div className="nav-caption">我的健康空间</div>
          <nav aria-label="主导航">
            {nav.map((x) => (
              <Link
                key={x.href}
                className={`nav-item ${path === x.href ? "active" : ""}`}
                href={x.href}
              >
                <x.icon size={21} />
                <span>
                  {x.label}
                  <small>{x.sub}</small>
                </span>
                {path === x.href && <span className="nav-dot" />}
              </Link>
            ))}
          </nav>
          <Link className="side-overview" href="/overview">
            <PanelTop size={18} />
            健康数据大屏
            <ArrowUpRight size={15} />
          </Link>
          <div className="side-grow" />
          <div className="side-companion">
            <Sparkles size={19} />
            <h3>健康路上，有我陪你</h3>
            <p>不必完美，每天进步一点点。</p>
            <Link href="/companion">
              和小养聊聊 <ChevronRight size={16} />
            </Link>
          </div>
          <div className="side-user">
            <div className="avatar">Y</div>
            <span>
              小予<small>正在成为更好的自己</small>
            </span>
            <Link href="/profile" aria-label="个人资料">
              <ChevronRight size={18} />
            </Link>
          </div>
        </aside>
      )}
      <div className="app-body">
        {!overview && (
          <header className="topbar">
            <div className="breadcrumbs">
              我的健康空间 <span>/</span>
              <strong>
                {nav.find((x) => x.href === path)?.label ?? "今日"}
              </strong>
            </div>
            <Link className="mobile-brand" href="/dashboard">
              <Leaf size={21} />
              轻养
            </Link>
            <div className="topbar-right">
              <span className="demo-tag">
                <span />
                体验版 · 演示数据
              </span>
              <span className="today-label">
                <Heart size={14} />
                好好生活的第 12 天
              </span>
              <Link
                className="avatar small"
                href="/profile"
                aria-label="查看个人资料"
              >
                Y
              </Link>
            </div>
          </header>
        )}
        {storageWarning && (
          <div className="storage-warning" role="alert">
            {storageWarning}
          </div>
        )}
        <main
          id="main"
          className={overview ? "overview-main" : "main-content"}
          aria-busy={!ready}
        >
          {children}
        </main>
        {!overview && (
          <>
            <Link
              className="floating-camera"
              href="/nutrition?photo=1"
              aria-label="拍照记录饮食"
            >
              <Camera size={23} />
            </Link>
            <nav className="bottom-nav" aria-label="手机导航">
              {nav.map((x) => (
                <Link
                  href={x.href}
                  key={x.href}
                  className={path === x.href ? "active" : ""}
                >
                  <x.icon size={22} />
                  <span>{x.label}</span>
                </Link>
              ))}
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
