# 降低语音误识别与误打断

## 实施计划

1. 先补回归，锁定无本地人声确认的 ASR final 不得保存、回复或打断。
2. 共用 16 kHz PCM 采样时间轴，按连接和识别段关联本地 VAD 证据。
3. 普通回答要求 250ms 有效人声；插话要求 1000ms 持续发声、800ms 有效人声及 300ms 稳定文字。短应声不排队。
4. 服务端暂存识别文本，只根据同段确认提交一次；处理重连、静音、结束、示范朗读与迟到事件。
5. 复用现有 Silero/ONNX 资源，完成真实 VAD 音频回放、浏览器协议检查、全量测试及构建。

参数集中在 shared/speech-policy.ts；不增加依赖或数据迁移。保留说完后的等待时间和手动停止。

## 实现

- 浏览器将上传的同一份 PCM16 音频转为 512 样本帧交给已有 Silero v6 模型。取消第二条麦克风/VAD 采样路径，时长由累计样本数确定；流、暂停和生命周期切换会撤销迟到推理。
- 人声概率至少 0.9，连续段内低概率间隙最多 200ms。普通输入要求至少 250ms 有效人声，插话要求跨度至少 1000ms、有效人声至少 800ms、识别文字稳定至少 300ms。识别段结束时间未知时继续累计本地证据，不等待下一次云端文字包。
- 连续发声段锁定第一个有效人声帧的场景；AI 在发言中途说完不会把剩余短应声当成普通回答。真正静音后开始的新发言重新判断。
- 云端 `speech_noise_threshold` 设为 0.2。识别字幕与自动提交都需要同段本地确认；纯标点不提交，正常短文字不按字数屏蔽。
- 本地模型加载或推理失败时关闭自动语音输入并提示文字输入，可重新开启语音重试；不采用仅凭云端文字打断的回退。

## 协议

`session.started` 在语音模式携带 `asrStreamId`。上行 `audio` 带 `streamId`；`transcript` / `speech.started` 带 `streamId`、`segmentId`、`beginMs`、`endMs`。

客户端 `speech.accept` 只发送连接和段标识，不重传文字；后端唯一提交已保存的 ASR 结果。`speech.reset` 带当前 PCM 时间截止，撤销未完成候选，旧连接、旧段、重复确认和越界时间不会放行。候选数量限制为 32。

Fun-ASR 同一段可能把 onset 的占位 `begin_time: 0` 修正为 final 的实际起点，适配器允许合法的时间细化，并重新检查截止和已上传音频边界。正常结束仅保存结束前确认的尾句，不开启回复。

## 验证与边界

回归覆盖服务端确认前后顺序、无证据噪声 final、连接与段去重、时间修正、结束尾句，以及前端短应声、持续插话、AI 中途结束、静音、示范播放、断线和迟到计时器。采集测试覆盖同源 PCM、采样时间、静音、暂停、推理队列和资源释放。

[真实 VAD 回放记录](../.omx/artifacts/speech-admission/VAD-VALIDATION.md)：9 段公开的真实呼吸/键盘/咳嗽录音均未达到输入门槛；3 段较长的本地合成日语通过，慢速「はい」通过普通输入门槛。默认语速合成「はい」仅 192ms 有效人声，另一条「いいえ」概率峰值 0.876，均被当前保守门槛过滤。不能将这些样本描述成所有短回答都能接受，也不代表真实麦克风和扬声器回声测试。

官方参数与事件依据：[客户端事件](https://help.aliyun.com/zh/model-studio/fun-asr-client-events)、[服务端事件](https://help.aliyun.com/zh/model-studio/fun-asr-server-events)。本地技能来源：`bailian-docs-llm-wiki/raw/_short/fun-asr-realtime-python-sdk-c8b5a715c3e66b70.md` 和 `raw/_short/fun-asr-server-events-666d2f9990cd5ae1.md`。

## 最终检查

2026-09-27，Node.js 24 下 `pnpm lint`、`pnpm typecheck`（前后端）、`pnpm test`（270/270）及 `pnpm build` 全部通过，包括同时落盘的流式字幕与人物互动功能。

真实 Chrome 开发页面通过 8 项采集链路检查：产品 AudioWorklet、Silero v6 与 WASM 实际运行，使用录音注入 MediaStream；非空噪音 final 被拒绝，慢速「はい」在等待回答时通过、AI 发言时不打断且不排队，长句插话只取消原回复一次。后端 HTTP/WebSocket 为模拟协议，未使用真实云 ASR 或物理麦克风。首轮热更新期间的超时未计作成功，记录在 VAD 验证报告中。

生产服务已更新至 `http://127.0.0.1:13000`，页面 HTTP 200，后端 `ready: true`。构建后的页面再次通过相同 8 项真实 Chrome 检查，上传 1032 块 PCM，无页面异常、无意外语音降级；所有服务端交互仍由独立浏览器上下文模拟，未创建真实验证会话。

原始证据位于 `.omx/artifacts/speech-admission/`：`final-{lint,types,tests,build}.log`、`browser-vad-results.json`、`production-browser-vad-results.json`。不将协议模拟与录音注入结果描述为真实麦克风环境或云 ASR 验证。

## 修改文件

- 参数与协议：`shared/speech-policy.ts`、`shared/protocol.ts`。
- 采集与确认：`src/lib/browser-vad.ts`、`src/lib/browser-audio.ts`、`src/lib/speech-admission.ts`、`src/hooks/use-conversation.ts`；失败提示在 `src/components/reply-suggestions.tsx`。
- 服务端：`server/providers/asr.ts`、`server/session.ts`、`server/index.ts`。
- 回归：`tests/asr.test.mjs`、`tests/session.test.mjs`、`tests/ws-speech-protocol.test.mjs`、`tests/browser-capture.test.mjs`、`tests/speech-admission.test.mjs`、`tests/conversation-speech.test.mjs`，并迁移现有字幕/推荐播放测试。
