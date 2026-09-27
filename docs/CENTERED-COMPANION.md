# 人物居中与简洁字幕改版

## 修改前计划

1. 基线运行现有语音/文字/TTS 回归测试并保存相关源文件，使用隔离的模拟 API/WebSocket 验证 UI，不修改日常聊天数据。
2. 主页面改为精简导航、居中全身人物、当前轮次双字幕、聊天操作；保留纸感背景，删除重复文案和双栏布局样式。
3. 调整完整模型取景，按包围盒、水平和垂直视野适应容器，保留头脚边距。
4. 识别中间结果与最终消息平滑交接；按 turnId 配对字幕，保留完成/打断内容，清理结束/断线/识别失败状态。先添加针对性测试再接入。
5. 完整对话和学习回顾移入记录弹窗，当前会话实时读取，历史记录独立加载并丢弃迟到请求；文字输入与回答提示按需展开。
6. 运行 lint、类型检查、测试、构建，以及桌面/手机/短横屏截图和交互检查；保存 visual-verdict 结果。

## 边界与基线

- 保留现有服务端 API、WebSocket 协议和存储结构，不增加依赖；TTS 字幕显示流式全文，不实现逐字播放同步。
- Node.js 24.15.0 下现有 26 项测试通过。
- 当前目录没有 Git 元数据；修改前文件快照位于 `.omx/artifacts/centered-companion/before/`。

## 实现结果

| 文件 | 改动 |
| --- | --- |
| `src/components/companion.tsx` | 居中人物与本轮双字幕；折叠文字输入；记录弹窗内独立加载历史、实时查看当前会话和学习回顾；错误提示出现在当前操作面板内 |
| `src/components/companion.module.css` | 删除双栏、营销页头、人物旁介绍和重复页脚样式；增加响应式舞台、居中字幕、记录详情滚动区 |
| `src/components/paper-navigation.tsx` / `.module.css` | 精简品牌与导航，保留手机菜单、Escape 和焦点返回 |
| `src/components/reply-suggestions.tsx` | 原生 details 默认折叠，保留照着读、发送、读音和释义 |
| `src/components/avatar-stage.tsx` / `src/lib/avatar-framing.ts` | 完整包围盒居中，按宽高和深度取景；CSS 控制画布显示尺寸，避免缩屏时内联像素宽度短暂溢出 |
| `src/hooks/use-conversation.ts` / `src/lib/conversation-captions.ts` | 识别中间/最终文字连续展示，按 sessionId + turnId 配对；失败、断线与结束清理临时内容；结束后打字创建新会话，保留旧回顾 |
| `tests/avatar-framing.test.mjs` / `tests/conversation-captions.test.mjs` | 取景几何与实际 Hook 事件处理回归测试 |

简化：主页面只保留人物、当前轮次字幕与操作。完整记录和学习回顾在弹窗查看，文字输入和回答建议按需展开。删除旧展示结构和对应 CSS，无新增依赖，也未修改服务端和协议。

## 验证结果

- Node.js 24.15.0 下 lint、前后端类型检查、43 项测试和生产构建通过。新增字幕测试验证了真实 Hook 事件处理器；结束后文字新建会话的测试先失败、修复后通过。
- 浏览器合计 20 项检查通过，证据由两次隔离运行组成（15 + 5），不是一次连续运行。覆盖 1440×900、1920×1080、390×844、667×375、识别交接、连续轮次、打断、长字幕、建议练习/发送、记录请求竞态、弹窗内错误重试、回放/慢放、结束回顾、设置和记忆操作。
- 另以只读方式加载本地已配置的黑发人物，在桌面、手机和短横屏确认完整显示、水平居中、字幕位于下方、无横向溢出。
- 最终视觉验收 94/100。软件渲染的长页面截图曾出现重复拼接伪影；使用独立视口重新拍摄，并确认 DOM 仅有一个导航、人物和画布。旧异常截图不作为通过证据。
- 浏览器没有页面错误。交互验证拦截所有 API/WebSocket 请求，使用虚拟麦克风和合成 PCM；未调用真实 ASR/TTS 模型，未修改真实聊天记录。真实麦克风识别质量、模型音色及 Safari/Firefox 不在本次验证范围。

证据：

- [浏览器汇总](../.omx/artifacts/centered-companion/browser-aggregate-results.json)
- [当前人物只读检查](../.omx/artifacts/centered-companion/live-results.json)
- [构建输出](../.omx/artifacts/centered-companion/build.log)
- [桌面当前轮次](../.omx/artifacts/centered-companion/after-captions-1440x900.png)
- [实际人物桌面](../.omx/artifacts/centered-companion/live-1440x900.png)
- [实际人物手机](../.omx/artifacts/centered-companion/live-390x844.png)
- [长字幕视口复核](../.omx/artifacts/centered-companion/long-caption-viewport-results.json)
- [手机长字幕](../.omx/artifacts/centered-companion/long-viewport-mobile-bottom.png)
- [最终视觉验收](../.omx/artifacts/centered-companion/visual-verdict-final.json)
