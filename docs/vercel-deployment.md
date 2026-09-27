# 部署 Kaiwa Talk 到 Vercel

本项目可以作为一个 Vercel 项目部署，无需自备后端服务器。页面由原生 Next.js 服务运行，HTTP API 和实时语音由 Node.js 24 容器运行，Turso 保存设置、历史和记忆，私有 Vercel Blob 保存上传的 VRM。

这是个人使用的部署方案：访问密码保护整个应用，设置、历史、记忆仍由同一位使用者共享。它没有多用户账号和数据隔离。

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

上传完成接口可以重复提交同一个上传 ID；已校验的模型不会再次覆盖，临时存储故障可以重试。每次申请新上传令牌时，服务会检查最多 1,000 个临时对象，清理其中超过 24 小时的遗留上传。该清理不会在后台定时运行；如果之后没有新的上传，关闭页面后遗留的临时对象会继续保留，可以在 Blob 控制台删除 `avatar-uploads/` 中的旧文件。

首次启动会建立数据库表。原有电脑上的 `data/companion.sqlite` 和 `data/avatars/` 不会自动上传，云端初始数据与本地数据相互独立。若要保留旧历史，先备份本地数据库并单独迁移；旧的自定义模型需要重新上传。

Preview 和 Production 建议连接不同的数据库和 Blob store，以免预览测试修改正式数据。

## 2. 创建 Vercel 项目并配置环境变量

把代码提交到 Git 仓库，在 Vercel 导入项目。Root Directory 保持仓库根目录，Node.js 选择 `24.x`。构建配置由 `vercel.json` 的各个 service 管理，不要在项目层覆盖成 `pnpm start`，也不要把整个项目改成一个 Docker 服务。

启用 Fluid Compute，确认当前项目可以使用 Services、Container Images 和 WebSockets Beta。框架配置和入口均已写入仓库。首次实际云端部署仍需要在账号中验证这些 Beta 功能的可用性。[Services 文档](https://vercel.com/docs/services)、[容器文档](https://vercel.com/docs/functions/container-images)

在项目 Settings → Environment Variables 中配置以下变量，选择对应的 Production 或 Preview 环境：

| 变量 | 配置 |
| --- | --- |
| `KAIWA_TALK_DEPLOYMENT` | `vercel`；启用云端模式和强制访问保护 |
| `KAIWA_TALK_PUBLIC_ORIGIN` | 实际访问地址，如 `https://your-project.vercel.app`；不包含路径 |
| `KAIWA_TALK_ACCESS_PASSWORD` | 至少 24 个字符的随机密码，供浏览器登录使用 |
| `PORT` | **`8080`**，让 Vercel 的容器路由端口与非 root 后端一致 |
| `TURSO_DATABASE_URL` | Turso 数据库连接 URL |
| `TURSO_AUTH_TOKEN` | Turso 数据库令牌 |
| `BLOB_READ_WRITE_TOKEN` | 上一步私有 Blob store 的读写令牌 |

已有部署可以继续使用对应的 `KAIWA_LAB_*`、`VIRTUALMAID_*` 变量；按 Kaiwa Talk → Kaiwa Lab → VirtualMaid 的顺序取第一个已设置值，包括显式空值。升级包名无需重建 Vercel 项目、Turso 数据库或 Blob store。

模型名称可按需使用仓库 `.env.example` 中的配置。百炼 API Key 和接入域名由用户登录后在「练习设置」中填写，保存在当前网站的浏览器中；未配置时页面会提示配置，不使用服务器环境变量兜底。旧的百炼密钥、地域、工作空间和端点环境变量可以删除，数据库、Blob 和访问密码仍需保留。不要给任何密钥添加 `NEXT_PUBLIC_` 前缀。

可以在自己的终端用以下命令生成访问密码，保存到密码管理器后填入 Vercel：

```sh
openssl rand -hex 32
```

`PORT=8080` 必须在 Vercel 项目中设置；Dockerfile 中的 `EXPOSE` 和 `ENV` 不能代替平台的路由端口配置。Vercel 默认将容器请求发往 80，官方允许用项目环境变量 `PORT` 修改。[容器端口说明](https://vercel.com/docs/functions/container-images#port-resolution)

`KAIWA_TALK_PUBLIC_ORIGIN` 必须和浏览器访问的域名一致。使用自定义域名时填自定义域名；Preview 使用固定的分支预览域名并单独设置对应值。不要把生产域名用于预览站点，也不要配置通配符来源。

当前生产项目为 `kaiwa-talk`，域名为 `kaiwa-talk.vercel.app`，沿用原项目 ID、数据库和 Blob store。生产环境变量已统一为 `KAIWA_TALK_*`，其中 `KAIWA_TALK_PUBLIC_ORIGIN=https://kaiwa-talk.vercel.app`。修改域名时须同步更新实际生效的 origin 变量并重新部署，确保 WebSocket 来源校验通过。新域名需要重新登录、填写浏览器保存的百炼 API Key / API Host 并设置个人偏好，云端历史和设置不受影响。

## 3. 发布并登录

完成上述配置后，从 Vercel Dashboard 部署，或提交代码触发 Git 部署。Vercel 分别构建前端和后端容器，并在一个部署中发布它们；本地不需要安装 Docker 才能使用 Git 部署。

首次打开网站时，浏览器会显示 HTTP Basic 登录框：

- 用户名：`kaiwa-talk`
- 密码：`KAIWA_TALK_ACCESS_PASSWORD` 的值

旧用户名 `kaiwa-lab`、`virtualmaid` 仍可登录；已有授权 Cookie 沿用原名称与签名格式，在相同域名且密码不变时继续有效。

登录后使用 `HttpOnly`、`Secure` Cookie 授权同域 API、WebSocket 和模型访问。密码不会作为 URL 参数传递。更换访问密码会使原有授权失效。

前端服务和后端服务必须配置相同的访问密码与公开域名。不能只依靠 Next.js 页面保护：`/api/**`、`/ws` 会直接进入后端，因此后端也独立校验授权。

## 4. 云端验收

首次部署需要在真实账号、数据库和 Blob store 上确认：

1. 无痕窗口访问页面要求登录；未登录的 API、WebSocket 和模型访问被拒绝。
2. 登录后切换三种界面语言，刷新仍保留选择；设置保存后重新打开仍存在。
3. 未配置百炼 Key 时显示设置入口且无法聊天；保存 Key 后完成文字和语音对话，确认历史、记忆写入 Turso。结束聊天并删除 Key 后再次要求配置。
4. 上传 VRM，重新打开页面仍能加载；Blob store 中的对象保持私有。
5. 连续对话超过 5 分钟，并在浏览器断网后恢复，检查会话恢复、已保存消息和继续说话行为。
6. 在另一个浏览器标签页尝试开启会话，确认现有会话不会被抢占。
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

镜像不需要云端凭据即可构建。启动容器时才注入 Turso、Blob、访问密码和公开域名等变量。不要在 Dockerfile 中写入密钥，也不要将本地 `data/` 挂载方案当成 Vercel 上的持久存储方案。

独立脚本 `pnpm build:server` / `pnpm start:server` 用于后端，`pnpm build:web` 用于前端。`NEXT_PUBLIC_KAIWA_TALK_SAME_ORIGIN=1` 仅在本地模拟同域代理的验收环境中需要；Vercel 正常线上域名无需此变量。
