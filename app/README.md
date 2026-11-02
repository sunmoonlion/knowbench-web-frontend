# knowbench-web-frontend

SunmoonAI Knowbench 的 Next Web 实例。它完整继承模板通用能力，并与统一 FastAPI
`knowbench-backend`
组成发布和验收单元；B5/B6 后默认配对同契约 FastAPI BFF，Nest 作为可选 profile。
本实例提供 App Router、明确的 public/authenticated 渲染边界、
next-intl、Tailwind/shadcn UI、同源 `/api` 接入和自托管 standalone 构建。
本仓库在共同底座之上承载 Knowbench 的 Research Agent 工作区与交互 DTO。

## 本地开发

```bash
# .nvmrc/.node-version and Docker/CI share the same release baseline.
nvm use 24.18.0
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

发布基线为 Node `24.18.0` LTS 与 pnpm `10.24.x`；`package.json` 只接受
`>=24.18.0 <25`。版本冻结服务于单次发布可复现，不代表永久停留在该版本；模板按
季度检查 LTS 生命周期，并在 EOL 前至少六个月启动下一次受控升级。

首次使用时，从 `.env.example` 生成未提交的 `.env.local`。浏览器 API 固定为
同源 `/api`；`DEPLOYMENT_ENV`、`AUTH_APP`、`APP_ORIGIN`、`BACKEND_INTERNAL_URL`、`DEPLOYMENT_ID`
属于 server-only 运行时契约。不要把 Casdoor、Redis、服务 token 或其他凭据
放进 `NEXT_PUBLIC_*` 或前端仓库。

## 质量门禁

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm check:i18n
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

生产镜像使用 `mybuild/Dockerfile` 的 `output: standalone` 产物，并由 Nginx/
Ingress 或受控 Node server 对外提供服务。发布前必须同时记录模板 commit、依赖
锁、镜像 digest、环境契约和回滚版本；本仓库不会覆盖三个 Web App 的正式流量。

## 架构边界

- `proxy.ts` 只负责 locale negotiation 等请求前路由工作，不是授权边界。
- `env/client.ts` 只允许同源 API path；`instrumentation.ts` 在生产 Node server
  启动时验证 server-only 环境。
- 公共首页可预渲染；工作区明确 dynamic/no-store/noindex。受权页面只通过
  `lib/server/auth-session.ts` 的 server-only DAL 把请求 cookie 和 correlation ID 转给
  配对 backend，并严格解析 Browser Session DTO v1；401 服务端跳转登录，其他上游或
  契约错误 fail closed。浏览器 logout 只使用同源 POST+CSRF，不保存第二份 auth 状态。
- B2 通过只证明身份内核、DAL/DTO 和受控配对 fixture；真实 Casdoor、双 Pod、滚动与
  回滚资格仍由 B4 验收。
- B3 增加实现无关的 Run snapshot、typed query、SSE cursor/去重/断档对账、HITL action、
  browser-safe Citation 和稳定 error adapter。参考 UI 仅在
  `REFERENCE_UI_ENABLED=true` 时启用；生产默认关闭，fixture 不代表真实 Run 成功。
- BFF、session/cookie、SSE cursor/reconcile、Citation DTO 和缓存归属以
  ADR-001/002/004/005/014 为准，不在模板中伪造业务成功。
- 后续模板同步必须保留 Knowbench 领域页面，并按迁移前 tag、候选镜像 digest、
  隔离部署和回滚证据串行执行。

## 参考

- Next.js App Router 与自托管文档：<https://nextjs.org/docs>
- 当前架构与契约入口：`k8s/docs/project-guide/`
- 旧设计与迁移证据：按 `k8s/sunmoonai/docs/legacy-backlog/verification-index.md` 的固定 Git 版本查询，不作为当前实施基线。

## 工作台登录恢复与资料来源契约

本轮公共登录恢复同步自 `tpl-web-frontend@bd00575`（模板先通过完整 `pnpm check`）。
`SessionBoundary` 包住工作台；工作台、公共跨应用链接及 Run HTTP 客户端使用会话请求入口。
重新登录通过 `/api/auth/web/me` 核对同一 actor/app，更新 WorkbenchProvider 的 CSRF；
只恢复读取，不自动重放确认采单、派单、发消息等写操作。输入只在原标签页内存保留。
远程 link 的 Git 凭据 401 另行核对浏览器会话；已有 Git 凭据提示继续可用。

`chosen_data.source` 按 20261028_0030 后的数据库契约只接受 `knowbase`，不放宽为
任意字符串。`tests/fixtures/knowbase-run.json` 来自后端真实测试 HTTP 响应，使用
合成数据，非线上响应。后端 `tests/test_run_data_contract_db.py` 在隔离数据库中
验证并对照此副本；合法契约变化时先在后端用 `UPDATE_RUN_CONTRACT_FIXTURE=1`
更新提供方原件，再同步消费者并运行两端测试，不能为前端测试通过手改响应。

回归包括 HTTP 200/401 区分、非空资料下步骤与采单渲染、登录恢复保留输入与 CSRF、
账号切换清缓存、迟到响应拒绝、SSE 停止与只读恢复，以及本地/远程 Git 凭据流程。
线上 Casdoor 与原任务恢复仍须随正式发版验收。
