# 健康 H5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建可在手机与桌面演示七项主要功能的健康 H5 应用框架。

**Architecture:** Next.js App Router 提供页面与共享壳。独立的业务 reducer 管理健康记录、积分和预约；版本化 localStorage 保存本地状态，演示服务与 UI 分离。

**Tech Stack:** Next.js、React、TypeScript、CSS、lucide-react、Vitest、Playwright；安装时记录实际解析版本并提交锁文件。

**Spec:** `docs/superpowers/specs/2026-10-18-health-app-design.md`

## Global Constraints

- 移动优先，手机五栏底部导航，桌面侧栏，独立全宽大屏。
- 浅紫与淡蓝渐变、柔和圆角卡片、深色主文字、紫色操作按钮。
- 演示数据及模拟能力明确标识；关键记录刷新后保留。
- 首版不引入后端、数据库、登录及支付。
- 时间和日期按 Asia/Shanghai 处理。
- 图片仅本地预览，不上传；不得暗示真实识别、定位、推送、预约或联网聊天。
- 用户已撤销先前 AGENTS.md；若开发工具生成新指引，检查其适用性。实现框架 API 前阅读安装版本随包文档。

## Review Focus

- 损坏或旧版本本地数据：恢复有效种子数据，并说明记录未能恢复（任务 2）。
- 快速重复点击：训练和每日任务不重复发积分，预约不重复创建（任务 2）。
- 日期跨午夜：任务按上海日期重置，历史记录仍保留（任务 2）。
- 图片取消或无效文件：不写入餐次，给出可恢复反馈（任务 3）。
- 360px 窄屏、弹层与键盘：导航无遮挡、无横向溢出、焦点可恢复（任务 1、6）。

---

### Task 1: 应用壳与视觉基础

**Files:** 创建 `package.json`、`package-lock.json`、`tsconfig.json`、`next-env.d.ts`、`next.config.ts`、`.gitignore`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/app/globals.css`、`src/components/app-shell.tsx`、`src/components/dialog.tsx`、`playwright.config.ts`、`tests/e2e/shell.spec.ts`。

**Interfaces:** 消费 React children；产出 `AppShell({children}: {children: React.ReactNode})` 与 `Dialog({open,onClose,title,children})`，open 为 boolean，onClose 为无参回调，title 为 string。

- [ ] 安装依赖并配置 dev/build/start/typecheck/test/test:e2e 命令；阅读本地 Next.js 路由、布局和客户端组件文档。
- [ ] 编写 shell 测试：360px 与 1440px 下 document.scrollWidth <= innerWidth，导航可访问，弹层 Escape 关闭且焦点返回触发按钮。运行测试确认缺少页面导致失败。
- [ ] 实现共享壳、五个导航入口、安全区域、设计变量、焦点样式和减少动画支持；根路径重定向 /dashboard。弹层使用原生 dialog 管理焦点与模态。
- [ ] 运行对应浏览器测试及 typecheck，预期通过；可写 .git 时提交本任务。

### Task 2: 本地业务状态与演示服务

**Files:** 创建 `src/lib/health/types.ts`、`seed.ts`、`reducer.ts`、`storage.ts`、`services.ts`、`src/components/health-provider.tsx`、`vitest.config.ts`、`tests/health-state.test.ts`、`tests/storage.test.ts`；修改 `src/app/layout.tsx`。

**Interfaces:** `HealthState` 包含 dailyRecords、meals、completedWorkouts、moods、messages、favorites、bookings、ledger、reminder；`HealthAction` 为带 type 的判别联合；`healthReducer(state: HealthState, action: HealthAction): HealthState`；`shanghaiDate(now?: Date): string`；`readState(storage: Pick<Storage,'getItem'>): {state: HealthState; warning?: string}`；`writeState(storage: Pick<Storage,'setItem'>, state: HealthState): boolean`；`useHealth()` 返回 state、dispatch、storageWarning、ready。

- [ ] 先写测试：同日期同任务奖励两次只产生一条流水；同训练完成两次只记一次；预约两次仍一条且可取消；上海午夜前后日期不同；历史记录不被重置；积分余额不足时兑换不扣分。运行确认导入失败。
- [ ] 定义数据类型、固定种子、动作和 reducer。任务奖励配置固定在一处；记录动作内部原子更新积分，余额从流水求和，避免独立余额漂移。
- [ ] 写存储测试：非法 JSON、错误字段类型、未知版本回退种子并返回 warning；setItem 抛错返回 false。实现版本化结构和必要字段校验。
- [ ] 实现 Provider：首次渲染种子，挂载读取完成后才允许持久化；显示存储错误提示。定义 `demoRecognize(): Promise<FoodDraft[]>` 和 `demoReply(text: string): Promise<string>`，明确演示实现。
- [ ] 运行 npm test 和 typecheck，预期全部通过；提交本任务。

### Task 3: 今日看板与饮食记录

**Files:** 创建 `src/app/dashboard/page.tsx`、`src/app/nutrition/page.tsx`、`src/features/dashboard/dashboard.tsx`、`src/features/nutrition/nutrition.tsx`、`src/components/health-charts.tsx`、`tests/e2e/nutrition.spec.ts`。

**Interfaces:** 消费 useHealth、demoRecognize；产出 `Dashboard()`、`Nutrition()` 和 `TrendChart({values}: {values: number[]})`。食物草稿包含名称、克数、热量，确认后写入带上海日期和餐次的 Meal。

- [ ] 写流程测试：饮水按钮增加 250ml，体重表单拒绝非正数；上传图片、修改模拟结果、保存后饮食列表更新，刷新仍保留；取消不写记录，无效文件给出提示。运行确认页面缺失失败。
- [ ] 实现日期切换、热量环、营养条、体重趋势、喝水与体重弹层、今日任务入口；历史日期显示对应数据且不误改今日。
- [ ] 实现餐次切换、图片读取及预览、演示结果编辑与确认，释放 object URL；实现演示餐厅筛选、详情与收藏。
- [ ] 运行本任务浏览器测试及 typecheck，预期通过；提交本任务。

### Task 4: 训练监督与情绪陪伴

**Files:** 创建 `src/app/training/page.tsx`、`src/app/companion/page.tsx`、`src/features/training/training.tsx`、`src/features/companion/companion.tsx`、`tests/e2e/training-companion.spec.ts`。

**Interfaces:** 消费 useHealth、demoReply；产出 `Training()`、`Companion()`。训练完成动作含课程 ID、日期及消耗值；提醒包含 enabled 和 HH:mm 时间。

- [ ] 写流程测试：课程可筛选和打开，计时可开始暂停，完成后更新打卡及积分，重复完成不再奖励；提醒刷新后保留；发送非空文字显示演示回复，空消息不可发送，情绪可保存。运行确认失败。
- [ ] 实现周计划、课程详情、训练计时及打卡、提醒设置，清理定时器并以时间戳计算计时，标注后台推送尚未接入。
- [ ] 实现 AI 头像、快捷话题、聊天列表、发送状态、情绪选择，明确模拟回复，长消息自动换行。
- [ ] 运行本任务浏览器测试及全部单元测试，预期通过；提交本任务。

### Task 5: 积分、预约社交与可视化大屏

**Files:** 创建 `src/app/profile/page.tsx`、`src/app/overview/page.tsx`、`src/features/profile/profile.tsx`、`src/features/overview/overview.tsx`、`tests/e2e/profile-overview.spec.ts`。

**Interfaces:** 消费 useHealth 和 TrendChart；产出 `Profile()`、`Overview()`；大屏复用业务状态，时间范围为近 7 日和近 30 日。

- [ ] 写流程测试：签到一天只奖励一次，积分流水与余额一致；兑换余额不足提示；活动详情可预约取消并刷新保留；大屏切换时间范围更新图表并可返回。运行确认失败。
- [ ] 实现档案、目标、积分任务及流水、模拟兑换、收藏列表、活动列表与预约状态；所有活动和成员标明演示。
- [ ] 实现大屏多列指标和趋势，范围切换按日期聚合，窄屏堆叠；无数据时显示空状态而非编造新增记录。
- [ ] 运行本任务浏览器测试及 typecheck，预期通过；提交本任务。

### Task 6: 整体验证与运行交付

**Files:** 创建 `README.md`、`docs/service-integration.md`；按验证结果修改相关源码和测试。

**Interfaces:** README 提供安装、启动、检查命令和演示入口；接入文档映射识别、地图、聊天、预约、通知的替换位置。

- [ ] 扩展全站浏览器测试：360px 与 1440px 遍历全部页面无横向溢出；底部导航不遮挡内容；弹层焦点、图片错误、存储不可用提示可用。
- [ ] 执行 npm test、npm run typecheck、npm run build、npm run test:e2e，均应退出 0；修复实测问题后仅重跑受影响检查及最终构建。
- [ ] 浏览器实际查看今日、饮食、运动、陪伴、我的与大屏，检查层级、触控尺寸、中文溢出、控制台错误；必要时截图复查。
- [ ] 完成 README 与服务接入说明；复核设计要求全部覆盖，记录真实验证结果和任何限制；提交最终变更（若 Git 权限允许）。
