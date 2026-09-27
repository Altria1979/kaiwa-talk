# 部署 Kaiwa Talk 到 Vercel

本项目可以作为一个 Vercel 项目部署，无需自备后端服务器。页面由原生 Next.js 服务运行，HTTP API 和实时语音由 Node.js 24 容器运行，Turso 保存设置、历史和记忆，私有 Vercel Blob 保存上传的 VRM。

网站免登录访问，每位访客自行填写百炼 API Key。设置、历史、记忆、会话锁和上传头像按浏览器隔离，不提供账号或跨设备同步。清除网站数据、改用其他浏览器或签名密钥失效后，无法再访问原身份的记录。

## 部署结构

`vercel.json` 使用当前的 `services` 配置。两个服务以仓库根目录为构建上下文，避免复制或移动 `server/`、`shared/` 和前端代码：

| 请求 | 服务 | 构建方式 |
| --- | --- | --- |
| `/api`、`/api/**`、`/ws` | `backend` | `Dockerfile` |
| 页面、`/_next/**`、`/models/**`、`/vad/**` | `frontend` | `pnpm build:web`，Next.js 原生部署 |

服务路由保留请求原路径，所以后端收到的仍是 `/api/status`、`/ws`。前端在线上使用当前域名的 HTTPS/WSS，不再请求访问者电脑的 `127.0.0.1`。[Services 路由规则](https://vercel.com/docs/services/routing)

Docker 只打包后端编译结果和生产依赖，以非 root 用户启动。`.dockerignore` 只允许必要的源代码和包清单进入构建上下文；`.env.local`、`data/`、Git 目录、截图和测试产物不会进入镜像。

`Dockerfile` 必须保留在仓库根目录：Vercel 的容器构建器使用 Dockerfile 所在目录作为构建上下文，仅设置 service 的 `root` 不能让子目录中的 Dockerfile 读取根目录文件。前端通过 `framework: nextjs` 自动识别运行时，Node.js 版本使用项目的 `24.x` 配置。

## 1. 准备云端存储

在 [Vercel Marketplace 的 Turso 页面](https://vercel.com/marketplace/tursocloud) 创建或连接数据库，取得 `TURSO_DATABASE_URL` 和 `TURSO_AUTH_TOKEN`。使用远程数据库 URL，不要配置 `file:` 本地文件 URL。

在 Vercel 项目的 Storage 页面创建 **Private** Blob store，并连接到项目，取得 `BLOB_READ_WRITE_TOKEN`。不要创建 Public store；上传模型通过鉴权后的令牌直接上传到 Blob，避免让大文件经过函数请求体。

上传完成接口可以重复提交同一个上传 ID；已校验的模型不会再次覆盖，临时存储故障可以重试。每次申请新上传令牌时，服务会检查当前浏览器的最多 1,000 个临时对象，清理其中超过 24 小时的遗留上传。该清理不会在后台定时运行；如果之后没有新的上传，关闭页面后遗留的临时对象会继续保留，可以在 Blob 控制台删除 `avatar-uploads/` 中的旧文件。

首次启动会建立数据库表。原有电脑上的 `data/companion.sqlite` 和 `data/avatars/` 不会自动上传，云端初始数据与本地数据相互独立。若要保留旧历史，先备份本地数据库并单独迁移；旧的自定义模型需要重新上传。

Preview 和 Production 建议连接不同的数据库和 Blob store，以免预览测试修改正式数据。

## 2. 创建 Vercel 项目并配置环境变量

把代码提交到 Git 仓库，在 Vercel 导入项目。Root Directory 保持仓库根目录，Node.js 选择 `24.x`。构建配置由 `vercel.json` 的各个 service 管理，不要在项目层覆盖成 `pnpm start`，也不要把整个项目改成一个 Docker 服务。

启用 Fluid Compute，确认当前项目可以使用 Services、Container Images 和 WebSockets Beta。框架配置和入口均已写入仓库。首次实际云端部署仍需要在账号中验证这些 Beta 功能的可用性。[Services 文档](https://vercel.com/docs/services)、[容器文档](https://vercel.com/docs/functions/container-images)

在项目 Settings → Environment Variables 中配置以下变量，选择对应的 Production 或 Preview 环境：

| 变量 | 配置 |
| --- | --- |
| `KAIWA_TALK_DEPLOYMENT` | `vercel`；启用云端存储与安全 Cookie |
| `KAIWA_TALK_PUBLIC_ORIGIN` | 实际访问地址，如 `https://your-project.vercel.app`；不包含路径 |
| `KAIWA_TALK_BROWSER_SECRET` | 至少 24 个字符的随机签名密钥，只供服务端签发浏览器身份 |
| `PORT` | **`8080`**，让 Vercel 的容器路由端口与非 root 后端一致 |
| `TURSO_DATABASE_URL` | Turso 数据库连接 URL |
| `TURSO_AUTH_TOKEN` | Turso 数据库令牌 |
| `BLOB_READ_WRITE_TOKEN` | 上一步私有 Blob store 的读写令牌 |

已有部署可以继续使用对应的 `KAIWA_LAB_*`、`VIRTUALMAID_*` 变量；按 Kaiwa Talk → Kaiwa Lab → VirtualMaid 的顺序取第一个已设置值，包括显式空值。升级包名无需重建 Vercel 项目、Turso 数据库或 Blob store。

模型名称可按需使用仓库 `.env.example` 中的配置。百炼 API Key 和接入域名由访客在「练习设置」中填写，保存在当前网站的浏览器中；未配置时页面会提示配置，不使用服务器环境变量兜底。旧的百炼密钥、地域、工作空间和端点环境变量可以删除，数据库、Blob 和浏览器签名密钥仍需保留。不要给任何密钥添加 `NEXT_PUBLIC_` 前缀。

可以在自己的终端用以下命令生成签名密钥，保存到密码管理器后填入 Vercel：

```sh
openssl rand -hex 32
```

`PORT=8080` 必须在 Vercel 项目中设置；Dockerfile 中的 `EXPOSE` 和 `ENV` 不能代替平台的路由端口配置。Vercel 默认将容器请求发往 80，官方允许用项目环境变量 `PORT` 修改。[容器端口说明](https://vercel.com/docs/functions/container-images#port-resolution)

`KAIWA_TALK_PUBLIC_ORIGIN` 必须和浏览器访问的域名一致。使用自定义域名时填自定义域名；Preview 使用固定的分支预览域名并单独设置对应值。不要把生产域名用于预览站点，也不要配置通配符来源。

当前生产项目为 `kaiwa-talk`，域名为 `kaiwa-talk.vercel.app`，沿用原项目 ID、数据库和 Blob store。生产环境变量已统一为 `KAIWA_TALK_*`，其中 `KAIWA_TALK_PUBLIC_ORIGIN=https://kaiwa-talk.vercel.app`。修改域名时须同步更新实际生效的 origin 变量并重新部署，确保 WebSocket 来源校验通过。更换域名会建立新的浏览器身份，需要重新填写 API Key / API Host 和个人偏好；旧身份的数据仍保留，但不会自动出现在新域名。

## 3. 发布并访问

完成配置后提交代码触发 Git 部署，Vercel 会同时发布前后端。网站直接打开，不显示 HTTP Basic 登录框。

网页通过同源的 `POST /api/browser` 自动获得随机、签名的浏览器身份。Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Strict`，有效期一年，每次打开网页续期；API 和 WebSocket 验证 Cookie 后，只操作该身份的数据。首次初始化会串行执行，支持 Web Locks 的浏览器还会协调多个标签页。禁止网站存储时会提示允许保存后刷新。

`KAIWA_TALK_BROWSER_SECRET` 必须稳定保留；修改会使原身份失效。升级期间可以沿用原 `KAIWA_TALK_ACCESS_PASSWORD`（及更早名称）作为签名密钥回退，但它不再用于登录。旧登录 Cookie 无法读取任何访客数据。

升级只新增 `browser_*` 表，旧的共享设置、聊天、记忆和租约表保持原样，**不自动认领或公开**。旧 `avatars/<id>.vrm` 对象也不会被公开路由读取。新模型位于 `avatars/<browserId>/<id>.vrm`，上传暂存对象同样隔离。旧数据如需恢复，应通过另外的受控迁移操作完成。

这是无需账号的浏览器身份，并非跨设备账户系统。请使用自己的浏览器；共用同一个浏览器配置文件的人会共用该身份。公开访客仍会消耗部署方的数据库、存储和流量配额，模型调用使用各自的 API Key。当前模型上传限制为每个文件 30 MB，尚未设置全站累计上传配额；如向大量访客推广，需要在部署侧补充限流、费用监控与存储回收策略。浏览器身份本身不代表付费账户。

## 4. 云端验收

首次部署需要在真实账号、数据库和 Blob store 上确认：

1. 两个独立浏览器窗口直接打开页面，无登录弹窗；没有有效身份的 API、WebSocket 和私有模型访问被拒绝。
2. 修改一个浏览器的设置和记忆，另一个浏览器保持默认且无法通过 ID 读取或修改它们；刷新原浏览器保留数据。
3. 未配置百炼 Key 时显示设置入口且无法聊天；保存 Key 后完成文字和语音对话，确认历史、记忆写入 Turso。结束聊天并删除 Key 后再次要求配置。
4. 上传 VRM，重新打开页面仍能加载；Blob store 中的对象保持私有。
5. 连续对话超过 5 分钟，并在浏览器断网后恢复，检查会话恢复、已保存消息和继续说话行为。
6. 同一浏览器的另一个标签页不能抢占正在进行的会话；不同浏览器可以分别对练。
7. 重新部署后确认历史、设置和上传模型仍存在。

Services、容器和 WebSocket 仍处于 Beta。容器不是永久运行的服务器，空闲时会缩容；WebSocket 也受函数执行时长限制。本项目为后端设置 300 秒上限，不能通过 Docker 去掉平台的限制。[WebSocket 文档](https://vercel.com/docs/functions/websockets)、[函数时长配置](https://vercel.com/docs/functions/configuring-functions/duration)

会话恢复以已持久化的消息为准。中断时尚未完成的录音、识别或合成流不能保证继续原来的字节流；恢复连接后需要重新说完这一句。不要把部署成功等同于完整的实时语音验收。

## 本地运行与容器检查

本地开发仍支持原来的双进程方式。不设置云端变量时，数据继续写入电脑上的 `data/`，不需要 Turso 或 Blob：

```sh
nvm use
pnpm install --frozen-lockfile
KAIWA_TALK_WEB_PORT=13000 pnpm dev
```

检查源码和生产构建：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

如果本机已经安装并运行 Docker，可以单独构建后端镜像；构建上下文必须是仓库根目录：

```sh
docker build --file Dockerfile --tag kaiwa-talk-backend .
```

镜像不需要云端凭据即可构建。启动容器时才注入 Turso、Blob、签名密钥和公开域名等变量。不要在 Dockerfile 中写入密钥，也不要将本地 `data/` 挂载方案当成 Vercel 上的持久存储方案。

独立脚本 `pnpm build:server` / `pnpm start:server` 用于后端，`pnpm build:web` 用于前端。`NEXT_PUBLIC_KAIWA_TALK_SAME_ORIGIN=1` 仅在本地模拟同域代理的验收环境中需要；Vercel 正常线上域名无需此变量。
