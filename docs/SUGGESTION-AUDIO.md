# 推荐回答示范音频

用户可以查看两条 AI 推荐回答，每条原文下方以同一辅助行显示假名与中文翻译；假名可通过开关隐藏。点击「听示范」（日文界面为「お手本を聞く」）收听当前 AI 音色播放原句，或点击「发送」直接回复。

## 行为

- 只朗读推荐句子原文，不朗读假名、释义，不把示范发送成新消息。
- 准备时显示「準備中…」，播放时显示「停止」；再次点击当前项停止，点击另一项切换。失败后保留推荐，可以重试。
- 每条推荐保留「听示范」和「发送」两项操作，发送原句作为用户消息。
- 文字会话可以直接播放，无需麦克风授权。语音会话播放期间暂时静音，结束或取消后恢复用户原本的麦克风选择。
- 重复听同一句复用当前会话的音频缓存；新消息、下一轮回复、结束、断线和卸载会取消未完成的示范。
- 沿用当前纸面列表排版、日文界面和现有 BrowserAudio 输出分析器，使人物口型跟随实际播放。

## 实现边界

- `POST /api/messages/:id/suggestions/:index/audio` 只接收已保存消息的 ID 和第 0–2 条推荐索引；正文由服务端读取。
- 复用现有 TTS、Bailian 凭据及声音/学习语言设置，返回 24 kHz PCM。限制为 160 字、24 秒音频和 3 个并发；取消时中止上游合成。
- 前端以独立播放 ID 使用现有音频缓存和播放路径，示范的播放确认不会写入聊天回复。临时静音与用户静音偏好分开保存。
- 开始示范时也会取消上一轮仍在合成的回复，避免原回复语音与示范交错；已生成的推荐仍可继续使用。
- 未增加依赖，不改模型文件或已有人物取景设置。

## 验证记录

示范音频初次实现的历史验收结果见 [验收记录](../.omx/artifacts/suggestion-audio/VERIFICATION.md)。其中使用隔离 HTTP/WebSocket 模拟、测试 PCM 和虚拟麦克风，覆盖示范播放、取消、缓存、静音和会话生命周期，以及桌面和移动尺寸的布局。

真实 TTS 音色、声学回声及 Safari/Firefox/真实移动设备不在模拟验证范围。

## 修改文件

- 推荐操作和排版：`src/components/reply-suggestions.tsx`、`src/components/companion.tsx`、`src/components/companion.module.css`。
- 播放与接口：`src/hooks/use-conversation.ts`、`src/lib/api.ts`、`server/index.ts`、`server/suggestion-audio.ts`。
- 回归测试：`tests/suggestion-playback.test.mjs`、`tests/suggestion-audio.test.mjs`。
