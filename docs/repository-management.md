# 前后端 GitHub 管理

- 前端：https://github.com/guojunyu12/qingyang-health-frontend
- 后端：https://github.com/guojunyu12/qingyang-health-backend
- 两者均使用私有仓库；本地前端保持当前项目根目录，独立后端仓库位于 `server/`。
- `server/` 被前端忽略，后端独立提交和推送，不使用 submodule；新成员分别 clone 两个仓库。
- 前端只提交 H5 代码、测试及相关说明。后端管理服务代码、数据库迁移、公共接口和模块分工。
- `db/` 根目录副本为原本地环境引导保留，后续后端迁移以 `server/db/` 为维护位置，勿分别修改两份基线。
- 当前登录前端和认证API尚未实现，后端仓库不代表功能已完成。
- `.env*`、`.local/`、SMTP授权码、数据库文件、`.vercel/` 不入库。后端 `.env.example` 只有空秘密字段。
- 各模块从 `main` 建分支，经PR审核合并；前后端分别发布，通过契约版本与交付commit配对。
- GitHub仓库创建不改变现有Vercel发布；自动部署与分支保护后续单独配置。
