# 小春全站纸感重构

## 修改前计划

1. 先记录现有聊天、记录、记忆、设置和弹窗行为，保存桌面截图，使用隔离浏览器和模拟 API 做回归，避免改动日常数据。
2. 复用指定 Pokotype skill 的纸色、静态颗粒、宋体、细线胶囊和五层彩色图形。只借用视觉规范，不引入其打字业务、页面入口和数据规则。
3. 把侧栏整理为响应式顶部导航；保留所有实际入口，补充滚动胶囊、手机菜单和键盘焦点管理。
4. 全面替换现有组件样式，集中语义变量，组件样式迁入 CSS Module；覆盖角色舞台、对话、推荐回答、学习回顾、所有面板和状态。保留业务 hooks、API 和存储实现。
5. 检查 1440、1920、390px 及短横屏、弹窗、滚动、减弱动效；运行 lint、类型检查和构建，记录实际验证结果。

## 边界

不增加依赖，不改服务端、密钥、存储和语音协议。系统字体存在跨平台差异。实时语音和外部模型调用不是本次样式测试的自动化范围。

## 完成的改动

| 文件 | 改动 |
| --- | --- |
| `src/app/globals.css` | 统一米白纸色、灰度纹理、墨色、系统字体和焦点状态，移除散落的旧组件样式 |
| `src/components/companion.tsx` | 接入顶部导航、响应式页头、彩色装饰与收尾；空聊天不再自动滚到底；其余会话流程保持 |
| `src/components/companion.module.css` | 将聊天、人物舞台、回答建议、学习回顾、设置、记录、记忆统一为局部作用域纸感主题，删除旧侧栏和厚重卡片规则 |
| `src/components/paper-navigation.tsx` / `.module.css` | 顶部导航、滚动胶囊、手机菜单、Esc与焦点返回 |
| `src/components/paper-art.tsx` / `.module.css` | 五层色块、圆形揭示、静态纹理、鼠标与减少动效处理 |
| `scripts/generate-paper-grain.mjs` / `public/paper-grain.png` | 无依赖、确定性256×256纹理 |
| `src/app/icon.svg` | 与纸面品牌一致的图标 |

简化：移除固定88px侧栏和1000px最小页面宽度，取消聊天空态重复标志与英文口号，统一颜色和边框语义。未增加依赖。

## 验证证据

- Node.js 24：`npm run lint`、`npm run typecheck`、`npm run build`通过。
- 隔离API模拟验证8组功能：三个面板开闭/Esc、设置保存重开、记忆增改删、长日文历史、解释、学习回顾、建议记忆保存以及768/390菜单与设置。
- 视觉浏览器检查涵盖1440×800、1440×900、1920×1080、390×844、667×375：首屏主按钮、聊天标题、快捷话题、零横向溢出、滚动胶囊、菜单和焦点、圆形揭示与减少动效。最终逐项结果见下方JSON。
- 圆形真实渐变常态半径179.2px/55%，内部鼠标230.4px/50%；实测PNG可见像素改变，非仅CSS变量变化。
- 本地生产页面实际加载验证：3D人物成功加载、纸纹请求正确、空聊天scrollTop=0、无页面异常和横向溢出。

证据目录：[paper-redesign](../.omx/artifacts/paper-redesign/)。

- [功能回归](../.omx/artifacts/paper-redesign/after-results.json)
- [视觉交互结果](../.omx/artifacts/paper-redesign/visual-results.json)
- [生产页面检查](../.omx/artifacts/paper-redesign/live-results.json)
- [最终桌面截图](../.omx/artifacts/paper-redesign/final-live-1440.png)
- [手机截图](../.omx/artifacts/paper-redesign/visual-home-390x844.png)

使用现有本机Playwright/Chrome，不新增测试依赖。基线与功能回归使用模拟API；生产烟测仅读取本地状态和渲染，不发送真实模型请求。未做真实麦克风/付费模型端到端验证，也未覆盖Safari、Firefox或真实移动硬件。系统字体在不同平台可能存在字形差异。

## 完整Skill包核对

用户后续提供 `paper-grain-ui-skill.zip`。解压后与本地已安装的同名 Skill 逐文件 SHA-256 核对：12/12 完全一致，无遗漏、无额外安装文件、无断开的内部资料链接。现有安装已经完整，无需覆盖。Skill 元数据验证通过，交互脚本语法检查通过，重建纹理与 Skill 资产及当前网站纹理逐字节一致。

完整包面向通用业务界面；本项目保留聊天产品的角色舞台和会话布局。手机小型图案静态显示，练习进行中隐藏装饰页尾，未复制打字项目的业务页面和导航。
