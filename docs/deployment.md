# 前端线上部署

部署日期：2026-10-19（Asia/Shanghai）

- 公开生产地址：https://qingyang-health.vercel.app
- 今日：https://qingyang-health.vercel.app/dashboard
- 可视化大屏：https://qingyang-health.vercel.app/overview
- 平台：Vercel；项目：qingyang-health；环境：production。
- 项目 ID：prj_8Li4cfzDofvqlr46i6zr1H85KWFx。
- 首次部署 ID：dpl_CxQwcsBtE1KZVRvcCbgL3VKd8y9s。
- 本地代码基准：8fe22b39cbdcc2cfdd74ae3ba9c29458c2303453；应用资源按本地工作区允许列表上传。

## 发布范围

仅上传 package.json、锁文件、TypeScript/Next.js 配置、src/ 与 public/，共 32 个文件。需求文档、PRD 原型、截图、PM 工作流、临时文件、Git 目录及本地环境文件未包含在发布源文件中。

当前上线的是前端交互演示，健康记录保存在访问者浏览器；识别、陪伴、餐饮、积分与预约仍按演示规则运行，没有接入真实业务后端。Supabase 连接可用，但目前仅发现原有 image-studio 项目，本次未创建数据库或修改该项目。

## 验证结果

- 本地：10 项单元测试、TypeScript 检查和生产构建通过。
- 云端：Next.js 构建完成，CLI 显示部署 Ready。
- 匿名访问正式主域名的 /dashboard 返回 200，未跳转平台登录。
- Chrome：390px 与 1440px 下全部六个主页面返回 200，无横向溢出，无页面脚本异常。
- 线上演示交互：饮水记录刷新保留、陪伴预设回复、活动预约与取消均通过。

## 后续更新

当前目录已关联 guo-4137/qingyang-health。使用 Vercel CLI 时先检查项目上下文，再发布；不要误选其他生图项目。

生产站点使用上方公开主域名。包含构建随机后缀、团队后缀的地址可能受 Vercel 登录保护；本次未关闭保护设置。

本地 CLI 自动生成的 .env.local 含开发身份凭据，应保持 Git 忽略，不作为部署源文件或公开文档上传。
