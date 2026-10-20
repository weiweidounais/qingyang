# 轻养健康

面向手机浏览器的健康 H5，同时支持电脑预览。本仓库归档当前 M03“饮食识别与附近餐饮”实现，包含前端及独立饮食后端模块。

前端基于 [qingyang-health-frontend](https://github.com/guojunyu12/qingyang-health-frontend) 的 `7edf70467eb36d537702430881a5d5a153001ecc`。其他成员页面保留基线演示，正式登录、看板联动和积分仍待团队装配。详细契约与边界见 [M03 交接单](src/features/nutrition/HANDOFF.md)。

## 启动完整饮食模块

需要 Node.js 22+、Python 3、OpenSSL。当前本地启动脚本适配 Apple Silicon Mac，自动下载 MySQL 8.4；其他系统需由 M01 提供 MySQL 与运行装配。

在仓库根目录执行：

```sh
python3 src/features/nutrition/dev/local.py start
```

启动脚本安装锁定依赖、创建独立开发数据库并构建 H5/API。访问 `http://127.0.0.1:3001/nutrition`。电脑需保持运行。停止 H5/API：

```sh
python3 src/features/nutrition/dev/local.py stop
```

同一台电脑只启动一份本地装配，使用端口 3001、3012、3443 及固定 MySQL socket。当前原工作目录“饮食项目”仍在运行；本次打包不会迁移数据库或启动第二份服务。

## 启用识别与高德

真实图片上传与 MySQL 记餐已实现。视觉模型需单独安装（下载数 GB，模型不在仓库内）：

```sh
python3 src/features/nutrition/dev/vision_runtime.py install
```

使用 Ollama `qwen3-vl:4b-instruct`；用户核对后才保存餐记录。不透明杯中的咖啡等不可见内容可能无法识别，不能将候选识别视为营养准确率验证。

高德 MCP 密钥由使用者在本机配置：创建 `.local/m03-amap.json`，结构参考 [配置示例](config-examples/m03-amap.example.json)，将文件权限设为仅本人读写，再重启服务。没有密钥时门店能力保持不可用。不要将真实密钥提交 Git。高德门店实时查询、不落库，当前不支持收藏。

## 手机测试与定位

手机与电脑连接同一 Wi-Fi，使用启动脚本打印的地址。实时定位与网页摄像头需要可信 HTTPS：先打开 `http://电脑IP:3001/dev/mobile-setup`，按说明手动信任本项目测试证书，再进入 `https://电脑IP:3443/nutrition`。证书在各台机器首次启动时生成，本仓库不分发证书或私钥。

2026-10-20用户已确认电脑显示定位精度和附近餐厅。华为手机浏览器反馈“浏览器未提供状态”，手机访问协议及实际定位结果尚待确认；不能据此宣称手机定位验收完成。系统定位权限和网站定位权限需要分别允许。

## 目录与验证

- `src/features/nutrition/`：饮食 UI、相机、上传、定位、启动工具和浏览器测试。
- `server/src/modules/nutrition/`、`server/src/modules/restaurants/`：M03 后端、视觉和高德适配。
- `server/contracts/`、`server/db/`：接口片段、公共契约参考副本及种子；生产复用 M01 唯一公共契约。
- `SOURCE_MANIFEST.json`：本次交付文件及 SHA-256；`M03_DELIVERY.json`：模块来源与验证记录。

既有验证：后端18项检查通过；完整浏览器回归17通过/1项真实视觉未启用；定位专项5项通过；真实模型餐照链路另有实测记录。自动化定位使用夹具，手机硬件待验证。具体记录、运行命令及生产差异见 [模块说明](src/features/nutrition/README.md)。

此源码包不含数据库、历史餐照、日志、账号口令、密钥、模型、依赖目录、证书和原 Git 历史。新机器启动会创建自己的开发数据；源工作目录和原数据库保持原样。
