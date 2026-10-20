// 本地同站代理与启动入口。生产请由M01统一反向代理和装配，不修改根依赖/配置。
import next from "next";
import { createServer, request } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
// 使用已构建版本，避免改变团队next.config.ts，也不依赖开发服务器的HMR跨域配置。
const app = next({ dev: false, dir: root, hostname: "127.0.0.1", port: 3001 });
await app.prepare();
const handler = app.getRequestHandler();
const tlsDir = `${root}/.local/tls`;
const tls = existsSync(`${tlsDir}/config.json`) ? JSON.parse(readFileSync(`${tlsDir}/config.json`, "utf8")) : null;
const serve = (req, res) => {
  const path = req.url?.split("?")[0];
  if (path === "/dev/mobile-setup" || path === "/dev/qingyang-local-ca.cer") {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
    if (!tls) { res.writeHead(503); res.end("Local HTTPS is not configured."); return; }
    if (path.endsWith(".cer")) {
      res.setHeader("Content-Type", "application/x-x509-ca-cert");
      res.setHeader("Content-Disposition", 'attachment; filename="qingyang-local-ca.cer"');
      res.end(req.method === "HEAD" ? undefined : readFileSync(`${tlsDir}/qingyang-local-ca.cer`)); return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.end(req.method === "HEAD" ? undefined : `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>轻养 · 手机定位设置</title>
      <style>body{font:16px/1.7 system-ui;color:#51445f;background:#f8f5fc;padding:24px;max-width:680px;margin:auto}a{color:#7856ab}h1{font-size:26px}li{margin:16px 0}code{overflow-wrap:anywhere}section{background:white;padding:20px;border-radius:18px;margin:20px 0}.button{display:block;text-align:center;background:#8b71c2;color:white;padding:12px;border-radius:12px;text-decoration:none}</style>
      <h1>让手机使用实际位置</h1><p>手机与电脑连接同一Wi-Fi，电脑保持运行。首次需手动信任本项目的局域网测试证书，再允许定位。</p>
      <section><strong>证书用途与范围</strong><p>名称：Qingyang Local Test CA。仅用于本机测试，证书限制为localhost和私有网络地址。安装并信任后，设备会信任它签发的这些本地地址证书。私钥始终留在电脑，下载内容只有公开证书。</p>
      <p>SHA-256指纹（请与电脑设置页核对）：<br><code>${tls.caSha256}</code></p><a class="button" href="/dev/qingyang-local-ca.cer">下载本项目公开证书</a></section>
      <ol><li><strong>iPhone：</strong>用Safari下载证书，在“设置→通用→VPN与设备管理”安装描述文件；再到“设置→通用→关于本机→证书信任设置”，为Qingyang Local Test CA开启信任。系统确认和密码由你本人操作。<a href="https://support.apple.com/zh-cn/102390">Apple操作说明</a></li>
      <li><strong>安卓：</strong>下载后，在系统设置中搜索“安装证书”，选择CA证书并安装。菜单因机型不同；仅安装名称及指纹均匹配的本项目证书。</li>
      <li>安装并信任完成后，打开下面的HTTPS页面，点击“使用实时定位”，允许浏览器和系统定位权限。如果浏览器仍提示证书不受信任，请返回检查安装步骤，不要忽略安全提示。</li></ol>
      <a class="button" href="https://${tls.ip}:3443/nutrition#nearby">打开手机HTTPS测试页</a>
      <section><p>电脑可继续用<a href="http://127.0.0.1:3001/nutrition#nearby">本机预览入口</a>定位，无需安装证书。内置浏览器不能授权时，用Safari或Chrome打开。</p><p>测试结束后，可在设备的证书/描述文件设置中移除Qingyang Local Test CA。当前未公开到互联网，也不会自动开启定位。</p></section></html>`);
    return;
  }
  if (req.url?.startsWith("/api/v1/")) {
    const proxy = request(
      {
        hostname: "127.0.0.1",
        port: 3012,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1:3012" },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("error", () => {
      if (!res.headersSent)
        res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            code: "API_UNAVAILABLE",
            message: "本地接口尚未启动，请稍后重试",
          },
        }),
      );
    });
    req.on("aborted", () => proxy.destroy());
    req.pipe(proxy);
    return;
  }
  handler(req, res);
};
const server = createServer(serve);
const secureServer = tls ? createSecureServer({ key: readFileSync(`${tlsDir}/server.key`), cert: readFileSync(`${tlsDir}/server.pem`), minVersion: "TLSv1.2" }, serve) : null;
secureServer?.listen(3443, "0.0.0.0", () => console.log(`轻养局域网HTTPS https://${tls.ip}:3443/nutrition（需设备手动信任本项目测试证书）`));
server.listen(3001, "0.0.0.0", () =>
  console.log(
    "轻养健康 · M03 http://127.0.0.1:3001/nutrition（局域网可用；实时摄像头需HTTPS）",
  ),
);
process.once("SIGTERM", () =>
  server.close(async () => {
    if (secureServer) await new Promise((resolve) => secureServer.close(resolve));
    await app.close();
    process.exit(0);
  }),
);
