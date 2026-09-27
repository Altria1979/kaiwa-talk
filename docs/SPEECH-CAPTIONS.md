# 人物语音字幕

人物说话时，在嘴巴下方逐字展示正在播放的句子。字幕跟随人物头部、取景大小和画布尺寸；最多两行，自动滚动到最新文字。自然播放结束后保留 2 秒、用 200ms 淡出；取消、确认插话、断线和结束会话立即清除。聊天区继续保留完整的流式正文。

## 播放与协议

- 新增 `audio.sentence { turnId, sentenceId, text }`，在开始该句 TTS 合成前发送。只注册文字，不触发显示，也不等待音频收齐。
- 播放器记录每块 PCM 的实际排程，累计已播放时长，排除缓冲间隔。合成未结束时按每秒 6 个字素估算；收到 `audio.end` 后以剩余音频时长校正，显示字数只增加，播放结束时补齐。
- 重听按完整句子的 PCM 时长建立分段，使用音频元素的 `currentTime` 定位，正常速度和 0.8 倍速复用同一逻辑。示范朗读在首次播放前注册文本，缓存重听直接复用。
- 字幕事件与 `played` 确认独立。只有完整句自然播完才确认用户已听到，取消不确认；原有 `spokenContent` 与聊天上下文语义保持不变。
- 播放代次和当前音频实例共同阻止旧回调覆盖新字幕。自然结束事件留给展示层淡出，显式取消发送空字幕并撤销计时。

## 改动位置

| 模块 | 文件 |
| --- | --- |
| 句子元数据与转发 | `shared/protocol.ts`、`server/session.ts` |
| 播放时间、重听与字素切分 | `src/lib/browser-audio.ts`、`src/lib/playback-captions.ts` |
| 会话状态与示范音频接入 | `src/hooks/use-conversation.ts` |
| 骨骼投影与字幕显示 | `src/components/avatar-stage.tsx`、`src/components/avatar-speech-caption.tsx`、`src/lib/avatar-caption.ts` |
| 页面接入与样式 | `src/components/companion.tsx`、`src/components/companion.module.css` |
| 回归测试 | `tests/avatar-caption.test.mjs`、`tests/browser-audio.test.mjs`、`tests/conversation-captions.test.mjs`、`tests/session.test.mjs`、`tests/suggestion-playback.test.mjs` |

复用现有播放器、音频缓存和人物动画循环，无新增依赖、数据库迁移或额外模型调用。位置更新直接修改字幕容器的 transform，不逐帧重渲染 React；可见文字仅在字数或播放状态变化时更新。屏幕阅读器继续使用聊天区文字，避免重复朗读字幕。

## 边界

这是句内近似同步，不是字词时间戳对齐。音频时长尚未知时的语速估计，以及汉字读音、标点停顿，会造成文字与发音的少量偏差。不同 VRM 的头骨位置可能有差异；使用头部／下颌骨和模型比例偏移近似嘴下位置，位置无法容纳字幕时隐藏，避免盖住脸。纯文字会话不在人物身上增加字幕。

浏览器验证使用真实 VRM 和浏览器音频播放，但 API、WebSocket 和 PCM 均为隔离模拟，不调用收费模型，不写入日常聊天数据。验证产物保存在 `.omx/artifacts/speech-captions/`。

## 验证结果

- 共享工作区最终版本 270 项测试通过，lint、前后端类型检查和生产构建全部通过。与并行的语音识别及人物动作任务合并验证，保留它们的改动。
- 字幕播放器有 29 项测试，包含预注册文字不提前显示、断流暂停、时长校正不倒退、字素完整、重听／慢放、错误重试及旧回调隔离。会话测试覆盖确认插话和断线等生命周期。
- Chrome 浏览器 12 组检查通过；1440×900、390×844、667×375 三种视口与全身／默认近景／胸像共 9 种组合均无字幕越界，长句最多两行；实际 VRM 加载成功，无页面错误。截图是浏览器模拟视口，不代表真实手机设备测试。
- 视觉验收 94/100。流式、重听、慢放、示范缓存、取消迟到事件、纯文字、结束和断线清理全部覆盖。最后一次完整浏览器运行通过；前几次受开发热更新或测试计时影响的尝试不作为通过依据。
- 本地生产页面已由并行任务统一构建更新，HTTP 检查返回 200。未验证真实 TTS 音质和逐字发音对齐；当前功能明确采用近似同步。

证据：[完整浏览器结果](../.omx/artifacts/speech-captions/final-browser-results.json)、[视觉验收](../.omx/artifacts/speech-captions/visual-verdict-final.json)、[测试](../.omx/artifacts/speech-captions/final-tests.log)、[构建](../.omx/artifacts/speech-captions/final-build.log)、[桌面效果](../.omx/artifacts/speech-captions/final-stream-playing-1440x900.png)、[手机效果](../.omx/artifacts/speech-captions/final-speaking-390x844-framing85.png)。
