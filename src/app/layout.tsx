import type { Metadata, Viewport } from "next";
import { HealthProvider } from "@/components/health-provider";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
export const metadata: Metadata = {
  icons: { icon: "/icon.svg" },
  title: { default: "轻养 · 让健康自然发生", template: "%s · 轻养" },
  description: "你的饮食、运动与情绪健康空间。健康 H5 交互演示。",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f7fc",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main">
          跳转到主要内容
        </a>
        <HealthProvider>
          <AppShell>{children}</AppShell>
        </HealthProvider>
      </body>
    </html>
  );
}
