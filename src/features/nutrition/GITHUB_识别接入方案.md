# 拍照识别的 GitHub 接入方案

核查日期：2026-10-20。用户已授权按此方案实施，本地上传、视觉适配与启动脚本已加入工程。运行时安装及模型状态以本机capabilities为准；真实链路验证记录见交接单及 `.local/m03-real-vision-result.json`，不能仅凭本文方案宣称已通过推理验证。

## 推荐组合

保留轻养健康的 Next.js H5、NestJS 模块与 MySQL 契约，增加本地图片上传适配和 Ollama 视觉适配。首选试验模型为 `qwen3-vl:4b-instruct`，餐照处理参考 CalorieMate 的实现思路；不迁移它的整个应用或数据库。

拟接入路径：手机/电脑拍照 → 当前本机 API 接收图片并校验 → 私有本机文件 → 识别任务 → 本机 Ollama → 结构化候选 → 用户核对/修改 → 确认写入 MySQL。

此组合不需要云 API Key，也不产生云端按次识别或对象存储费用；会占用本机算力、磁盘和电力。手机使用时需要电脑及本机 API、推理服务保持运行。它不等于直接在手机浏览器中离线运行模型。

## 候选项目与核查结果

| 项目 | 核查到的能力 | 对本项目的用途与限制 |
| --- | --- | --- |
| [Ollama](https://github.com/ollama/ollama) + [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL) | 本地视觉模型服务；图像输入与结构化 JSON 输出有官方文档 | 推荐作为独立推理服务，由现有 NestJS Worker 调用；不改变公共 DTO |
| [CalorieMate](https://github.com/ignoxx/caloriemate) | 餐照估算应用，支持 Ollama；实际客户端传入图片并请求 JSON，再解析校验 | 最直接的业务参考。其后端是 Go/PocketBase，数据库为 SQLite，与现有 NestJS/MySQL 不同；只参考调用与核对思路 |
| [NutriLens](https://github.com/thejusdutt/nutrilens) | README 描述浏览器 ONNX/WASM 本地食物识别、营养库和 PWA | 适合作为将来浏览器端离线识别的备选。模型、数据和代码许可各异；中餐覆盖、手机内存/速度需要另外验证，仓库宣称的准确率未由本项目复现 |
| [MLX-VLM](https://github.com/Blaizzy/mlx-vlm) | 面向 Apple Silicon 的视觉推理，提供兼容 OpenAI 的本地服务与结构化输出 | Mac 上的替代推理引擎；若 Ollama 实测速度或内存不理想再比较，首版不同时引入两套运行时 |

CalorieMate 已检查代码版本：`73bc91554235c882a39fb415fd73f9add21ad31e`。主要参考文件：

- [ai/ollama/client.go](https://github.com/ignoxx/caloriemate/blob/73bc91554235c882a39fb415fd73f9add21ad31e/ai/ollama/client.go)：读取图片、调用本地视觉模型、请求 JSON 并校验。
- [ai/ai.go](https://github.com/ignoxx/caloriemate/blob/73bc91554235c882a39fb415fd73f9add21ad31e/ai/ai.go)：推理接口的边界。

其客户端未体现本项目已有的任务租约、取消和超时收敛，不能直接替换当前 Worker。README 声称 MIT，但本次树检索未见独立 LICENSE 文件；本方案不复制它的源文件。若后续直接复用代码，需先核实授权。

## 本机可行性与待验证项

当前机器为 arm64、16GiB 内存，Ollama已安装在项目私有目录而非全局PATH；`qwen3-vl:4b-instruct` 已下载并校验全部文件层。[官方模型页](https://ollama.com/library/qwen3-vl:4b-instruct) 当前显示 4B 量化模型下载约 3.3GB；运行内存还包括视觉编码器、上下文缓存及应用开销，不能把下载大小当作运行内存。

因此建议先用 4B、单任务并发、受限图片尺寸和输出长度进行试验；16GiB 是可试验的依据，不是已通过性能验收的结论。首次模型下载需要联网；下载齐全后，本地推理路线不依赖云模型接口。只使用本地模型标签，不使用带 `-cloud` 的模型。

## 按现有契约接入

1. 本机上传适配放在显式 dev 装配中，实现现有上传准备、二进制上传、完成校验和 ready 状态查询。校验真实格式、大小、解码、摘要与用户归属；照片保存于 Git 忽略的私有目录，通过授权短期地址读取。
2. M03 的 `VisionPort` 适配 Ollama `/api/chat`。服务端仅从受控 `MediaPort` 读取本人 ready 照片，校验读取来源且限制重定向/大小，再编码传给本机模型；不接受前端提供的任意远程图片 URL。
3. 使用 JSON Schema约束输出，再执行现有 `validateCandidates`。候选映射到公共 `FoodItemDraft`：名称、份量、热量、可空宏量营养和置信度，`nutritionSource` 固定 `model`。无法给出必填份量/热量或不是食物时，返回可解释失败并引导手动记录，不填零冒充成功。
4. 复用识别任务的领取、租约、取消、轮询和终态校验。识别成功仅产生候选，不自动保存饮食事实。核对页把份量和营养标明为估算；用户修改后按人工来源提交。
5. `capabilities.upload` 只在上传适配就绪后开启；`recognition` 还需推理服务可达且目标视觉模型可用。模型缺失、退出或超时须有真实错误状态。
6. 生产仍由 M01 提供正式身份、媒体上传、私有读取、Outbox 和任务调度。本地适配不作为 M01 正式实现，不改公共 schema、不越界接管其他模块。

## 接入后的验收

- 使用真实餐照验证拍照 → 上传 → ready → 真实模型 → 核对 → 确认 → MySQL → 刷新保留；不能用固定候选冒充模型结果。
- 收集中餐、混合餐盘、空盘/非食物和模糊照片，记录菜名命中情况、实际延迟与峰值内存。单张照片的份量、油脂和热量属于估算，不宣称测量准确。
- 取消任务或关闭核对不新增餐记录；越权图片访问、损坏文件、模型不可达、无效 JSON、超时和迟到结果按现有规则处理。
- 手机通过同站 H5 API 访问电脑；Ollama 仅监听回环地址，不把无鉴权推理端口直接开放到局域网。

官方接口依据：[视觉输入](https://docs.ollama.com/capabilities/vision)、[视觉模型结构化输出](https://docs.ollama.com/capabilities/structured-outputs)。这些资料确认接口能力，不代表当前项目已经完成接入或实测。
