# 第三方素材与代码

## 默认 VRM 人物

- 文件：`public/models/default.vrm`
- 人物：**AvatarSample_A（VRoid Avatar A）**；内嵌模型名称为 `Koharu · Avatar A v1`，版本 `1.0.0`。
- 原作者：pixiv VRoid Project。官方角色为 [AvatarSample_A](https://hub.vroid.com/en/characters/2843975675147313744/models/5644550979324015604)。
- VRM 1.0 来源为第三方公开镜像 [arkavo-org/VRMMetalKit](https://github.com/arkavo-org/VRMMetalKit/blob/05afb6828fd48415b8d0141f5047e8b91b5b0c75/AvatarSample_A_1.0.vrm.glb)，固定提交 `05afb6828fd48415b8d0141f5047e8b91b5b0c75`，生成器为 VRoid Studio 2.12.0；该镜像不是官方发布服务器。
- 发布文件 SHA-256：`fce86a78b4d7aad258af5e46236de1efcb5f84b1ad1b38fa99f55b3307f6579e`。
- 未修改的上游文件 SHA-256：`3a1956bf4e5aebae1013334af5bc16875154e3b8cd3bed1ff77e963d74f4b1ef`。
- 本版仅调整 `VRMC_vrm.meta.name`、`version` 并补充 `otherLicenseUrl`；原始网格、贴图、骨骼、表情、原作者及权限字段保留，二进制资源块与上游完全一致。本地制作产物为 `artifacts/avatar-a-v1/Avatar-A-Koharu-v1.vrm`，与发布文件一致；制作资料目录不随仓库发布。
- 许可：保留内嵌 [VRM Public License 1.0](https://vrm.dev/licenses/1.0/)，并适用 [VRoidPreset A–Z 官方使用条件](https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z)，**不是 CC0**。不得用应用或镜像仓库的代码许可证替代模型许可。
- 官方条件允许盈利与非盈利用途、在 VRM 应用中使用及按条件再分发。本项目免费随应用提供该模型。禁止重新标为 CC0、收费转售原始模型或其中资源、用于角色制作服务及暗示 pixiv 背书等行为；完整限制以上述官方条件为准（核对日期：2026-09-27）。
- 内嵌元数据声明允许 everyone 使用、corporation 商业使用、重新分发及修改后重新分发；原有使用限制仍然有效。

导入其他模型前，请自行确认模型作者的使用和再分发条件；本地运行时保存在 `data/avatars/`，Vercel 部署时保存在私有 Blob。用户导入模型不随 Git 仓库发布。

以下记录旧黑发原型的来源和许可，所列 `artifacts/` 与 Blender 文件未随仓库分发，也不作为新部署的默认模型。

## Koharu 黑色常服 3D 原型与 V2 修正版

- 当前文件：`artifacts/koharu-black-v2/koharu-black-v2.vrm`；可编辑源文件为同目录的 `.blend`。V1 保留在 `artifacts/koharu-black-v1/`。
- 基于 pixiv Inc. 的 `VRM1_Constraint_Twist_Sample v1.0.1` 改制，复用基础网格、人形骨骼、表情和原有头发弹簧骨；不是从零原创的全部网格，也不是 AvatarSample_A。
- 原始模型来源：[pixiv/three-vrm](https://github.com/pixiv/three-vrm/blob/5a3242b66124386c32b085c6693d9059040e72e5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm)，固定提交 `5a3242b66124386c32b085c6693d9059040e72e5`，SHA-256 为 `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`；[原始说明](https://github.com/vrm-c/vrm-specification/blob/master/samples/VRM1_Constraint_Twist_Sample/README.md)。该模型曾作为项目默认人物，现已由 Avatar A 替换。
- 改制包含面部比例、面部底色与发丝贴图、侧刘海与头冠、服装修改、长袖、靴筒和配饰。V2 进一步重塑面部、替换分层长发、添加随表情运动的睫毛和石簇首饰。新增贴图由内置图像生成工具辅助制作，过程记录在 `artifacts/koharu-black-v2/texture-generation.md`。
- 原作者和许可权限保留在导出文件的 VRM 元数据中；适用 VRM Public License 1.0。文件哈希、绑定与内嵌资源记录见 `artifacts/koharu-black-v2/asset-manifest.json`。
- 使用 Blender 4.5.14 与 VRM Add-on for Blender 4.7.2 制作。工具安装在本机隔离缓存目录，未作为前端依赖加入项目。
- 用户的参考照片未打包进 VRM；模型缩略图采用实际网格渲染，不使用设定图冒充模型效果。

## 代码依赖

Next.js、React、Three.js、three-vrm、Tailwind CSS、ws、better-sqlite3 使用各自随包分发的许可文件。准确依赖版本记录于 `pnpm-lock.yaml`；本项目没有复制第三方应用的业务代码。

## 本地语音活动检测资源

- `@ricky0123/vad-web` 固定为 0.0.31，ISC 许可：[项目来源](https://github.com/ricky0123/vad)。使用包内 `silero_vad_v6.onnx` 与 `vad.worklet.bundle.min.js`。
- Silero VAD 模型来源：[snakers4/silero-vad](https://github.com/snakers4/silero-vad)，MIT 许可；模型随上述固定包版本分发。
- ONNX Runtime Web 固定为 1.22.0，MIT 许可：[项目来源](https://github.com/microsoft/onnxruntime)。资源复制脚本从同一个已安装版本复制 WASM/MJS，禁止混用版本。
- `public/vad/` 是开发/构建自动生成的本地静态目录，已忽略；依赖版本及完整性记录在 `pnpm-lock.yaml`，不依赖运行时第三方 CDN。
- 原始许可文本保存在 `docs/licenses/`，构建时一并复制到 `public/vad/licenses/`。
