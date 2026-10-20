# 轻养健康 · M03 饮食识别与附近餐饮

此模块在指定前端仓库的 `7edf70467eb36d537702430881a5d5a153001ecc` 上实现。当前本机项目位于 `/Users/Apple_501/Desktop/饮食项目`，原“运动项目”保留为未修改的基线。

## 本机使用

打开本目录的 `启动本地预览.command`，或运行：

```sh
cd /Users/Apple_501/Desktop/饮食项目
python3 src/features/nutrition/dev/local.py start
```

启动脚本检查Node.js 22+、安装缺失的锁定依赖、启动本项目私有MySQL 8.4、只对全新空库执行校验后的V001，构建并启动NestJS API和H5。数据库、密码、进程信息与日志仅放在被Git忽略的 `.local/` 中，密码文件权限为0600；MySQL只开放本机Unix socket。

- 电脑：http://127.0.0.1:3001/nutrition
- 同一Wi-Fi手机：使用启动脚本打印的电脑IP地址，不要使用手机自己的127.0.0.1。macOS防火墙需允许该Node服务的入站访问。
- 停止H5/API：`python3 src/features/nutrition/dev/local.py stop`。数据库与记录保留。
- 代码修改后重新运行启动脚本：预览使用已构建版本，不依赖HMR。

## 当前真实可用

- 手动多食物记餐；食物目录搜索；目录按克数由服务端计算。
- 人工营养留空存NULL；页面显示未知或已知部分，不伪造营养比例。
- 上海日期、过去30天补录、详情、完整数组编辑、版本冲突、软删除。
- 手机原生系统相机/相册入口、电脑网页实时取景与拍摄、文件大小/格式/解码/像素校验、本机预览。
- 显式本地装配支持真实图片上传、私有文件保存与短期授权读取；服务端重算摘要、解码并重编码，移除原始元数据。
- Ollama本地视觉适配与数据库任务调度已接入；真实模型可用时启用识别，模型缺失时保留明确不可用状态。识别不会自动记餐。
- MySQL持久化、重复请求去重、独立本地测试账号A/B及数据隔离。
- 高德MCP实时周边餐厅搜索、详情、直线距离、参考价格和“在高德地图查看”入口已接入；高德门店不落库，暂不支持收藏。其他获授权供应商的收藏端口保留。

## 明确未接入

- M01正式登录、公共上传、私有照片授权读取、公共Outbox/Worker调度。
- M05正式积分端口及原子奖励结算。
- M02看板/大屏接线及健康目标读取。其他原有页面仍是团队基线演示，不会通过localStorage伪装更新真实饮食事实。
- 云视觉服务。当前识别选用本地Ollama；高德查询使用用户提供的Key，具体配额以高德控制台为准，本次未开通新套餐或自动充值。

本机Nest入口 `server/src/modules/nutrition/dev/` 是明确的联调装配，禁止生产使用。它提供测试登录/幂等装配与真实本机文件上传、Ollama调用及任务调度，不结算积分。媒体表和Outbox表的本地适配只用于隔离开发库，生产仍由M01提供正式端口。界面折叠提示中可切换测试账号。

## 拍照流程

第一版采用：系统相机 → 本机预览 → 上传/校验 → 识别任务 → 用户核对/修改 → 确认保存。本地使用私有目录和Ollama适配，生产需切换M01正式上传与任务运行壳。模型未就绪时按钮显示“上传与识别待接入”并禁用，不自动确认或写入餐记录。

手机系统相机使用 `input[type=file]` 的 `accept=image/*` 与 `capture=environment` 提示后摄，另有独立相册入口；实际相机菜单和权限由手机系统/浏览器控制。电脑点击“打开相机”后通过 `getUserMedia` 请求摄像头授权，显示实时取景，再点击“拍摄照片”生成JPEG本机预览。权限拒绝、无设备、设备占用、非安全上下文、不支持API均有提示，可改用相册；内置预览不能授权时，使用Chrome / Safari打开同一地址。关闭、取消拍摄、切换相册或页面隐藏时释放视频流；授权迟到的流也会立即释放。只申请视频权限，不申请麦克风。

## 电脑和手机实时定位

附近餐饮的“使用实时定位”由用户主动启动 `watchPosition`，请求新设备位置（高精度、maximumAge=0），显示设备上报的精度与更新时间。移动超过100米且距上次门店查询至少15秒时刷新门店，防止GPS抖动大量消耗配额。停止、切收藏、手选城市、页面隐藏、离开、切账号均结束监听并丢弃迟到结果。手动城市选择显式标为“非你的实时位置”，权限拒绝/超时/位置不可用时不自动用城市中心或IP结果冒充实际位置。实际精度由浏览器和系统定位服务决定；高德MCP负责查门店，不提供设备GPS。

电脑可以继续通过 `http://127.0.0.1:3001/nutrition#nearby` 主动定位；内置预览无法提供权限时请用Safari/Chrome，并在系统及网站权限中允许定位。设备定位不自动开启。

高精度首次15秒超时后，会尝试一次普通精度设备定位（最多30秒）；全部等待含授权最多60秒。仍由浏览器返回坐标及精度，不使用手动城市/IP结果填充成功。页面同时显示网站授权状态，但网站“已允许”不能证明macOS已允许当前浏览器。如果所有浏览器均超时，可用Mac自带“地图”的当前位置作对照，再检查系统应用权限及网络/代理；高德MCP连接成功也不代表设备定位服务可用。

本地启动脚本已生成项目专用局域网证书并开放3443 HTTPS。手机先用同Wi-Fi打开 `http://电脑IP:3001/dev/mobile-setup`，核对证书名称/指纹，按页面步骤手动安装并信任公开CA证书，再进入 `https://电脑IP:3443/nutrition#nearby` 点击定位并允许权限。iPhone还需在[证书信任设置](https://support.apple.com/zh-cn/102390)启用信任。不能靠忽略证书警告获得可靠安全上下文。

证书名称Qingyang Local Test CA，限制localhost和私有网络地址；CA有效365天、服务证书30天。脚本不会安装CA或改变macOS/手机信任设置，也不使用公网隧道。TLS文件仅在被忽略的 `.local/tls/`，目录0700、文件0600；服务器只提供公开 `.cer` 下载，绝不提供私钥。电脑IP变化后重新启动会重签服务证书，CA不变。测试结束后可从手机移除该项目CA。此证书方案仅用于本地测试，生产由M01提供受信任域名证书。

位置监听的浏览器回归使用明确的坐标夹具和模拟权限，不代表手机硬件定位已完成。2026-10-20用户已确认电脑在完成授权后显示定位精度及附近餐厅；华为手机浏览器目前仅反馈“浏览器未提供状态”，HTTP/HTTPS访问方式与手机定位结果仍待确认。此提示仅表示无法查询权限状态，不阻断实际定位请求，也不代表定位成功或拒绝。TLS链、主机名、HTTPS CSRF/会话、私钥路由404已通过实际请求验证；手机仍需用户本人完成证书信任和定位授权。

照片支持JPEG/PNG/WebP，10MiB以内，最多40MP；HEIC尚未验证服务端转码支持，因此提示先转JPG。

照片摘要优先使用WebCrypto，局域网HTTP使用模块内SHA-256回退，服务端独立重算；回退实现已与Node原生摘要比对。手机局域网HTTP可用系统相机文件入口并上传；网页实时摄像头仍需HTTPS或localhost。正式联调应提供手机信任的HTTPS地址。真实iPhone/Android硬件权限和拍照尚需真机验证；浏览器文件上传测试不能代替真机。AR未加入本期。

## 本地视觉服务

首次安装（数GB模型下载，Apple Silicon Mac）：

```sh
python3 src/features/nutrition/dev/vision_runtime.py install
```

安装文件和模型位于 `.local/ollama/`。Ollama发行版固定为0.40.6，从官方GitHub下载并核对SHA-256；使用本地 `qwen3-vl:4b-instruct`，不开启云回退。后续本地启动脚本会自动启动已安装引擎，不自动更新模型。推理服务仅监听127.0.0.1:11434。

必须指定Instruct版本。默认4b标签当前为思考型，不能靠 `think:false` 关闭，可能耗尽输出预算仍无最终答案；参见[官方讨论](https://github.com/ollama/ollama/issues/13353)。就绪检查还会核验视觉能力，并拒绝思考型模型，避免只有模型文件存在就错误启用按钮。

图片位于 `.local/meal-photos/`，不包含在Git或源码交付包。H5通过同站代理上传，原图校验后以去元数据、最长边1280像素的副本私有保存。授权读链接有效期最多300秒，重新打开详情会重新获取。电脑需要保持开机，手机不直接连接Ollama端口。

本地拍照窗口每次打开、返回页面时会重新检查服务，并提供“重新检查服务”，不会清空已选照片。更新构建后，已经打开的旧页面需刷新一次才能加载新代码。点击识别立即显示准备/上传/识别进度；视觉提示包含咖啡等饮品。饮品需要让液面或透明杯中内容入镜。若照片只有不透明杯、包装等，模型未返回食物或饮品时会明确提示重拍或手动补充名称、份量及营养信息，不猜测隐藏内容，也不保存一餐。

停止推理服务：`python3 src/features/nutrition/dev/vision_runtime.py stop`。普通 `local.py stop` 只停止H5/API，保留数据库、图片和推理进程；模型闲置5分钟后卸载。完整方案及来源见 `GITHUB_识别接入方案.md`。

## 高德附近餐饮

已通过[高德官方Streamable HTTP MCP](https://developer.amap.com/api/mcp-server/gettingstarted)接入 `maps_around_search` 和 `maps_search_detail`。密钥只在本机 `.local/m03-amap.json` 的 `apiKey` 字段，文件权限0600；不进入H5、Git和交付包。换Key时在本机编辑该配置，再重启本地服务。没有另行修改Codex全局MCP配置。

页面下方“附近餐饮”选择城市中心或主动定位，然后选择1/2/5公里范围；“高蛋白/均衡膳食/轻食”分别按健身餐/健康餐/轻食关键词查询，不代表营养核验。手机局域网HTTP访问时请选城市中心，精确浏览器定位需可信HTTPS。用户点击定位后才请求权限；搜索中心会发送给高德，不记录用户位置查询日志。

高德周边工具目前不提供分页和门店坐标，所以每次最多补查12家餐饮门店详情、最多4个详情并发；距搜索中心按直线距离计算，不能当作步行路线。坐标使用服务端gcoord1.0.7在统一WGS84和高德GCJ02之间转换。价格从元转分，评分量表未明确时不映射评分，营养保持未知。

依据[高德标准服务协议3.5](https://lbs.amap.com/pages/terms/)，不缓存高德门店数据/图片。采用 `cacheTtlSeconds=0` 实时展示，不写restaurants或收藏表；列表编号为单次请求生成的临时UUID，详情直接展示本次查询时取得的资料，不调用数据库详情路由。高德门店收藏禁用。获得额外数据许可后，需由M01确认缓存与收藏契约再启用，不能仅将TTL改为正数。

真实地图验证（会调用高德当前Key的配额）：

```sh
RUN_AMAP=1 ./node_modules/.bin/playwright test --config src/features/nutrition/dev/playwright.config.ts amap.spec.ts
```

## 与其他成员对接

详见 `HANDOFF.md`。生产Nest装配入口为 `server/src/modules/nutrition/nutrition.module.ts` 的 `NutritionModule.register()`。所有数据结构沿用 `server/contracts/shared-types.ts`；该文件和SQL是附件原样提取的参考副本，集成时由M01映射到唯一公共文件，禁止维护第二套契约。

前端通过模块内 `NutritionTransport` 接受M01统一请求器；当前本地请求适配只用于本模块。全局缓存由M01处理。保存/删除会发送 `qingyang:nutrition-changed` 事件，detail包含 `date`、可选 `previousDate`；M01应连接 `invalidateHealth()`，本模块不修改其他成员的Provider或页面。

## 验证

```sh
npm run typecheck
npm run build
cd server/src/modules/nutrition/dev
npm run typecheck
npm test
cd ../../../../..
./node_modules/.bin/playwright test --config src/features/nutrition/dev/playwright.config.ts
# 显式运行真实模型测试，需准备 .local/m03-test-meal.jpg 或配置M03_MEAL_PHOTO
RUN_LOCAL_VISION=1 ./node_modules/.bin/playwright test --config src/features/nutrition/dev/playwright.config.ts recognition.spec.ts
```

后端测试会创建有唯一名称的 `qingyang_test_m03_*` 隔离数据库，并只删除该次创建的测试库；不清空开发库。所有模型与门店测试数据明确为fixture。前端浏览器测试使用测试账号，测试创建的餐记录会在finally中软删除。

根目录原有浏览器测试仍断言“固定示例识别”等旧演示行为，不应作为M03新功能验收；本模块提供专门的真实API回归用例。完整团队包的 `tools/check_contract.py` 未提供，尚未运行。
