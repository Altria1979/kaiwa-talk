# V1 实施约定

本机单用户；Next.js 3000，常驻 Node 3001，仅监听 loopback。保留 pelican-bike.html。交付运行 test、typecheck、lint、build；测试使用 Node 24 内置测试与现有 tsx，不新增依赖。

## 模块所有权

- shared/protocol.ts：前后端公共类型，修改先同步协调。
- server/config.ts、server/storage.ts、server/index.ts：配置、SQLite、HTTP/WS 入口。
- server/providers/*、server/session.ts：百炼适配及会话编排。
- src/components/*、src/app/*：界面及人物控制器。
- src/lib/*、src/hooks/*、public/audio/*：浏览器网络和音频。

## HTTP 合约

浏览器直接访问 http://127.0.0.1:3001；仅允许 localhost:3000 / 127.0.0.1:3000 来源。

可选 KAIWA_TALK_WEB_PORT（兼容旧 KAIWA_LAB_WEB_PORT / KOHARU_WEB_PORT）修改网页端口，服务端口始终为网页端口 + 1，来源校验同步调整。默认端口不变。

- GET /api/status → ServiceStatus
- GET /api/settings → Settings；PUT /api/settings，body Partial<Settings> → Settings
- GET /api/sessions → SessionRecord[]
- GET /api/sessions/:id → {session: SessionRecord, messages: ChatMessage[]}
- POST /api/messages/:id/translate → {translation: string}
- GET /api/memories → MemoryRecord[]
- POST /api/memories {content} → MemoryRecord
- PUT /api/memories/:id {content} → MemoryRecord
- DELETE /api/memories/:id → {ok:true}
- POST /api/avatar，Content-Type application/octet-stream，原始 VRM body → {avatarUrl:string}，同时保存 settings
- GET /api/avatars/:id.vrm → 内嵌资源的 VRM 1.0 二进制
- GET /ws WebSocket upgrade，JSON 消息类型见 shared/protocol.ts。voice.stop 用于录音故障后的文字降级；speech.started 携带 turnId:string|null，只通知候选目标，不直接取消或改变会话状态。前端结合本地确认与有效中间文字判断插话；降级时至少需要有效中间文字。仅中断匹配轮次或在无服务器轮次时停止本地重听。cancel 可带 turnId，服务端对不匹配目标完全忽略，手动无目标取消保持原行为。
- reply.suggestions 输出 {turnId, messageId, status:'loading'|'ready'|'unavailable', suggestions:ReplySuggestion[]}。ReplySuggestion 为 {text,reading,meaning}；ready 必须三项。ChatMessage.replySuggestions 为可选持久化字段；不加入后续聊天上下文。正文完成后并行生成，18 秒超时，取消随当前轮次传播。

错误统一 {error:string}。不返回密钥、上游响应正文或带认证信息的 URL。

## 服务器跨模块接口

config 导出模型及运行配置、resolveBailianConfig(credentials?) 和 getStatus(): ServiceStatus。API Key 与 API Host 由每个用户在网页设置填写，通过请求传入后解析为本次请求／会话的服务配置；项目不提供共享 Key，不从服务器环境变量或源码读取 Key。没有浏览器凭据时 ready=false。TTS 模型及默认音色使用 shared/protocol.ts 导出的 DEFAULT_TTS 常量：model 为 qwen3-tts-vc-realtime-2026-01-15，voice 为 qwen-tts-vc-kaiwa-voice-20261001155111507-6512，前后端统一使用，不读取 TTS 环境变量。

storage 导出 store 对象，同步方法：getSettings(), updateSettings(patch), listSessions(), getSession(id), createSession(), endSession(id, review?), saveReview(id,review), listMessages(sessionId), getMessage(id), addMessage({sessionId,turnId,role,content,delivery}), updateMessage(id, Partial<ChatMessage>), listMemories(), addMemory(content), updateMemory(id,content), deleteMemory(id), recentReviews(limit), close()。

读取设置时，新用户采用 DEFAULT_TTS.voice，旧 Cherry 存量设置迁移为该默认音色，已有自定义音色保持不变。

server/providers/qwen.ts 导出 QwenClient 类：stream(messages,signal): AsyncGenerator<string>、complete(messages,signal?): Promise<string>，以及 PromptMessage {role:'system'|'user'|'assistant',content:string}。

server/providers/tts.ts 导出 TtsClient.synthesize(text,voice,languageType,signal,onAudio):Promise<void>，languageType 为必传 TtsLanguage。resolveTtsLanguage(learningLanguage) 将日/英/韩/法/德/西班牙语映射到 Japanese/English/Korean/French/German/Spanish，未知语言使用 Auto。不根据文字是否包含汉字猜测语种；session.update 使用传入语种及音色，保留 server_commit 与 24 kHz PCM。复刻音色绑定创建时的模型、账号和地域，target_model 必须与 DEFAULT_TTS.model 一致；其他用户需在网页设置中填写自己账号可用的复刻音色 ID。

server/session.ts 导出 RealtimeSession(socket:WebSocket)，handle(event:ClientEvent):Promise<void>、dispose():Promise<void>；导出 getActiveSessionId():string|null。HTTP translate 可使用 QwenClient.complete，需缓存结果。会话模块直接使用 store/config。

beginTurn 读取一次设置及回复模式：回复模式由语音是否开启决定，与用户输入来自打字还是麦克风无关。本轮提示词和所有短句 TTS 共用学习语言/音色快照。语音正文只使用学习语言，中文解释保留在 translate 的文字结果中；纯文字正文允许辅助语言解释。历史内容不做字符过滤，模式变化仅影响后续轮次。

## 浏览器跨模块接口

src/lib/api.ts 导出 api {status,settings,saveSettings,sessions,session,translate,memories,addMemory,updateMemory,deleteMemory,uploadAvatar}，返回上述 Promise 类型。

src/hooks/use-conversation.ts 导出 useConversation()：{state,connected,active,voiceEnabled,muted,session,messages,transcript,error,audioLevelRef,start({voice,sessionId?}),end(),sendText(text),cancel(),toggleMute(),replay(turnId,slow?),canReplay(turnId),loadHistory(sessionId),clearError()}。start / end / sendText / replay / loadHistory 均 Promise<void>。audioLevelRef 是 React.MutableRefObject<number>，Three 帧读取，不逐帧更新 React。无配置时仍可展示人物和设置；不伪造 AI 回复。

useConversation() 另返回 replySuggestions（上述事件或 null）。只接受当前未取消轮次的建议；ASR 开始说话时保留已生成卡片以便跟读，用户最终消息到达后清空。新回复、结束、断线、历史切换时清空。界面在回复播放结束后展示操作卡；消息内保留可展开的历史参考。

## Fun-ASR 与本地 VAD

- ASR 独立 inference WebSocket，使用 run-task/task-started/二进制 PCM/finish-task；模型 fun-asr-realtime，language_hints:["ja"]，semantic_punctuation_enabled:false，heartbeat:true，max_sentence_silence 取设置（默认1600ms）。心跳忽略，按任务与句子ID过滤重复和迟到结果；正常结束有界等待末句，只保存不回复。
- BrowserAudio 独占麦克风/AudioContext；BrowserVad 借用资源，覆盖默认暂停/恢复流行为。MicVAD v6 使用0.8/0.5阈值、600ms累计语音门槛，redemptionMs与语音启动时设置一致。浏览器动态加载、单线程WASM，本地资源由开发/构建命令准备。
- 候选 onSpeechStart 捕获轮次，onSpeechRealStart 确认本地人声；只有本地确认与同一段发言的非空ASR中间文本同时满足时才定向中断；onSpeechEnd/Misfire只改变输入提示，不提交文本或覆盖AI状态。userSpeaking 与 vadStatus 为低频状态，推荐卡片保留至最终用户消息。
- 0.0.31 的 destroy 对未完成 start 的实例会抛错且不关闭 worklet port；兼容清理隔离在 browser-vad.ts，升级依赖时必须复核。初始化/暂停/销毁及推理串行，关闭会话不等待模型下载，迟到完成独立释放；推理积压或加载失败只降级本地检测。
- 浏览器仍持续发送原始分块PCM（包括静音）；VAD产生的完整音频片段不重新上传。只有ASR final驱动对话，避免重复提交与两次串行停顿。
