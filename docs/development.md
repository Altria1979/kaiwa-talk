# Kaiwa Talk 开发与进阶使用

[返回中文介绍](../README.md) · [日本語](../README.ja.md) · [English](../README.en.md)

本文面向本地开发与自托管。产品介绍和操作教程见 README；线上所需资源、环境变量与验收步骤见 [Vercel 部署指南](vercel-deployment.md)。

## 本地进程与配置

使用 Node.js 24 与 pnpm 9.9.0。`pnpm dev` 启动 Next.js 和 Node 后端，默认端口分别为 3000、3001；统一启动器会在退出时关闭子进程。

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

通过命令环境变量修改端口：

```sh
KAIWA_TALK_WEB_PORT=13000 pnpm dev
```

生产模式先运行 `pnpm build`，再运行 `KAIWA_TALK_WEB_PORT=13000 pnpm start`，无需按端口重新构建。浏览器以页面主机名和下一端口连接本地服务，保证浏览器身份 Cookie 可以正常发送。本地服务校验 Host 与 Origin，不应直接暴露到公网。

无需为本地使用配置 Turso 或 Blob；默认模型名内置在 `server/config.ts`。需要调整时，将 `.env.example` 复制为 `.env.local` 后编辑；已有环境文件不要覆盖：

```dotenv
BAILIAN_CHAT_MODEL=qwen3.8-flash
BAILIAN_ASR_MODEL=fun-asr-realtime
BAILIAN_TTS_MODEL=qwen3-tts-flash-realtime
BAILIAN_TTS_VOICE=Cherry
```

模型名称和默认音色的变化需要重启后端。`BAILIAN_TTS_VOICE` 用于新用户及仍使用内置默认音色 `Cherry` 的设置，其他已保存的自定义音色保留。网页中保存、更新或删除 API Key 无需重启；每次会话固定使用开始时的凭据。默认模型能否使用取决于实际账户、地域、模型权限和额度，不由配置格式检查保证。

使用复刻音色时，先通过百炼 `qwen-voice-enrollment` 创建音色，再将本地 `.env.local` 的 `BAILIAN_TTS_MODEL` 设为 `qwen3-tts-vc-realtime-2026-01-15`，`BAILIAN_TTS_VOICE` 设为接口返回的 `voice`。创建时的 `target_model` 必须与合成模型完全一致；网页中需使用拥有该音色的同一百炼账号和地域。已有自定义音色可在练习设置中替换。音色 ID 保存在本地配置，不将账号专属音色或原始录音加入公共源码。

百炼 API Key 与 API Host 仅从浏览器请求传入，不使用服务器环境变量中的旧百炼密钥兜底。后端按允许的百炼官方域名构造端点，不接受任意代理 URL、端口或路径。具体配置见[使用教程](../README.md#2-使用教程)。

## 数据流与目录

```text
浏览器 / Next.js
  ├─ Three.js + three-vrm：人物、表情、动作、字幕
  ├─ AudioWorklet：麦克风音频采集
  ├─ 本地 Silero VAD：人声活动与插话辅助
  └─ 带浏览器身份的 HTTP / WebSocket
      ├─ Fun-ASR：日语识别与最终断句
      ├─ Qwen：流式对话、回复候选、解释、回顾
      ├─ TTS：分句合成与取消
      └─ 按浏览器隔离的持久化
          ├─ 本地：SQLite + 磁盘头像
          └─ 云端：Turso + Private Vercel Blob
```

| 路径 | 职责 |
| --- | --- |
| `src/app`、`src/components` | 页面、弹窗、设置和人物渲染 |
| `src/hooks/use-conversation.ts` | 浏览器会话状态、连接与重连 |
| `src/lib/browser-session.ts` | 初始化并验证浏览器身份，协调同页和跨标签首次请求 |
| `src/lib/browser-audio.ts`、`public/audio` | 麦克风采集、句子播放、缓存与慢放 |
| `src/lib/browser-vad.ts` | 本地人声活动检测与降级 |
| `src/i18n` | 三语界面字典、日期和错误提示 |
| `server/providers` | Qwen SSE、ASR 与 TTS 服务适配 |
| `server/session.ts` | 会话租约、轮次编排、取消、上下文与学习回顾 |
| `server/storage.ts` | 共享数据库连接与按身份绑定的存储视图 |
| `server/avatars.ts` | VRM 验证、私有上传、完成和所属检查 |
| `shared/protocol.ts` | 前后端事件与数据类型 |
| `shared/cloud-access.ts` | 浏览器身份 Cookie 的签名与校验 |
| `scripts/prepare-vad-assets.mjs` | 从锁定依赖复制 VAD、Worklet、ORT 与许可文件 |
| `data/` | 自动生成的本地数据库、签名密钥和导入头像，不提交到仓库 |

## 会话与音频行为

- 文本对话使用流式响应，关闭思考输出，仅消费面向用户的正文。回复按完整短句顺序合成，每句拥有可取消的 TTS 连接。
- 音频播放采样率为 24 kHz。重听和慢放共用本轮缓存，慢放为 0.8 倍并保持音高；缓存上限 24 MB，待播队列上限 30 秒。结束、断线或刷新后不恢复音频缓存。
- 每轮包含独立 `turnId`。停止回复或有效插话会取消生成、合成与播放，过期事件不能覆盖新轮次。
- 本地 VAD 与云端有效识别内容共同确认提前插话；只有声音活动或空开口通知不会直接停止回复。最终发言仍由 Fun-ASR 断句，不重复提交整段录音。
- VAD、Worklet 与 ONNX Runtime 资源从本站加载；检测不可用时切换为文字输入，重新开启语音可重试，不会仅凭云端识别结果提交发言。VAD 不能区分用户声音与扬声器回声，也不提供发音评分。
- 只有完整句自然播完，浏览器才确认已播放；语音上下文据此区分用户已听到的句子与中断部分。纯文字会话以已显示正文为上下文。
- 回复候选在主回复生成后额外请求，不阻塞主回复播放；解释、候选音频和回顾也可能单独产生模型调用。生成失败时保留已有对话，记忆建议必须由用户主动保存。
- 语音输入固定日语提示。语音回复按本轮学习语言设置 TTS 语种；日语解释、参考释义和回顾不会跟随界面语言切换。
- 口型依据实际播放音量变化，不做逐音素同步；字幕在句内近似跟随音频进度，汉字读音与停顿可能产生偏差。
- 同一浏览器同时只允许一段活跃会话；不同浏览器有独立租约。未开始会话的空闲连接会被关闭，断线重连以已持久化消息为准，不自动重发上一句。

## 浏览器身份与持久化

页面无需登录，通过 `POST /api/browser` 获得签名 HttpOnly Cookie，再用 `GET /api/browser` 确认浏览器接受了 Cookie。后续 API 和 WebSocket 必须带有效身份；错误身份不会回退到任何旧共享记录。

云端 Cookie 使用 `Secure`、`SameSite=Strict` 和一年有效期，打开网页时续期。`KAIWA_TALK_BROWSER_SECRET` 必须稳定保存；更换签名密钥会使原身份失效。本地签名密钥自动写入 `data/.browser-secret`，重启会继续使用。

设置、历史、消息、记忆与会话租约使用 `browser_*` 表；新访客读取默认设置，不继承旧数据。头像位于 `avatars/<browserId>/<id>.vrm`，云端临时上传位于 `avatar-uploads/<browserId>/<id>.vrm`，下载前检查所属身份，再签发短期私有读取链接。

API Key 仅保存在浏览器 localStorage 与单次请求／会话的服务端内存中，不写入会话数据库。浏览器身份与 API Key 是不同的用途：前者选择自己的记录，后者授权百炼调用。共用一个浏览器配置文件的人也会共用该站点身份。

清除站点数据、结束无痕会话、切换域名或浏览器，可能无法继续访问原记录。当前没有账号恢复或跨设备同步。备份本地数据时先停止服务，再备份整个 `data/`，包括数据库、头像与签名密钥；备份应作为私人资料保存。

## 名称与旧版兼容

当前项目名为 `kaiwa-talk`。配置优先使用 `KAIWA_TALK_*`，仍兼容旧 `KAIWA_LAB_*`、`VIRTUALMAID_*` 与对应的公开配置前缀；网页端口继续兼容 `KOHARU_WEB_PORT`。显式设置的新值优先，包括空值，不会自动回退。

部分浏览器存储键仍使用旧名称，目的是保留语言、阅读方式、取景和 API Key 偏好。网站不再接受旧用户名或访问密码登录，旧授权 Cookie 也不能访问新身份数据。旧密码环境变量仅作为签名密钥的升级回退；新部署使用专门的 `KAIWA_TALK_BROWSER_SECRET`。

旧共享数据库表与未分身份的头像文件保持原样，不会自动公开或分配给新浏览器。若确实需要恢复到某个新身份，应另行备份并执行受控迁移，不要在公共 API 中增加旧表回退。

## 检查与故障排查

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

测试使用 Node.js 24 内置测试工具、tsx、临时数据库和模拟模型服务，不读取用户的日常会话数据或调用收费模型。不要把单元测试、页面加载成功或格式检查等同于真实设备语音体验的完整验收。

| 问题 | 排查方式 |
| --- | --- |
| Node 或原生模块错误 | 执行 `nvm use` 并确认 Node.js 24；换大版本后重新安装或重建 better-sqlite3 |
| 本地服务无法连接 | 使用统一启动器，检查网页端口及下一端口，从 localhost 或 127.0.0.1 访问 |
| 无法初始化浏览器身份 | 允许保存本站 Cookie；确认访问域名与配置一致，再刷新页面 |
| 鉴权、权限或额度错误 | 检查网页里的 API Key、地域、接入域名、模型权限和账户额度 |
| 增强检测不可用 | 执行过 `pnpm dev` 或 `pnpm build` 后检查本站 VAD 静态资源；重新开启语音会重试 |
| 识别、合成或断线异常 | 先保留可用文字交流，必要时重新开启语音；上一句不会自动重发 |
| 回顾没有出现 | 可能超时或返回格式不完整；已保存的聊天记录仍可查看 |
| 自定义人物无法加载 | 确认 VRM 1.0、资源内嵌、不超过 30 MB，并使用上传它的浏览器身份 |

## 发布边界

仓库只发布源码、测试、锁文件、部署配置、必要静态资源和许可说明。环境文件、私人数据库、录音、导入模型、构建目录、IDE 状态及本地制作资料应保持忽略；`.env.example` 只包含非敏感示例。不要上传本地工具的快照引用或使用 `git push --mirror` 发布工作站内部资料。

历史设计与验收文档可能引用不随仓库发布的本地证据，这些目录不是运行依赖。默认角色来源与分发条件见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
