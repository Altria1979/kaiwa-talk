# 第三方素材与代码

## 当前本地默认 VRM 人物

- 文件：`public/models/default.vrm`
- 来源：用户提供的本地文件 `2281553902699912246.vrm`，原样替换当前工作区的默认模型；不是项目取得公开分发授权的素材。
- 人物：**Violet Evergarden v1**；VRM 0.x 内嵌 `title` 为 `Violet Evergarden v1`，`version` 为 `Vers.1`，`reference` 为 `Violet Evergarden (Anime)`。
- 原作者：**Little Cwoissant**，保留内嵌作者及许可元数据。
- 原始文件与本地替换文件 SHA-256：`1431a286699dc1bc56d3e4f78e46e9ca093604acc3c4acef96fe68648707287c`。
- 内嵌许可类型为 `Other`；`otherLicenseUrl` 与 `otherPermissionUrl` 均指向同一份 [VRoid Hub 使用条件](https://hub.vroid.com/license?allowed_to_use_user=everyone&characterization_allowed_user=everyone&corporate_commercial_use=disallow&credit=necessary&modification=disallow&personal_commercial_use=disallow&redistribution=disallow&sexual_expression=disallow&version=1&violent_expression=disallow)。文件内声明允许 everyone 使用，要求署名，禁止个人及法人商业使用、再分发、修改、暴力和性表现。
- 以上说明来自用户文件内嵌元数据，不代表项目另行获得授权。该本地替换文件不得随公开仓库或部署分发；发布前须更换为获得相应分发授权的模型。模型**不适用应用源码的 MIT 许可证，也不是 CC0**。

导入其他模型前，请自行确认模型作者的使用和再分发条件；本地运行时保存在 `data/avatars/`，Vercel 部署时保存在私有 Blob。用户导入模型不随 Git 仓库发布。

## 历史默认人物 Avatar A

- 原作者：pixiv VRoid Project；官方角色为 [AvatarSample_A](https://hub.vroid.com/en/characters/2843975675147313744/models/5644550979324015604)。该模型已被上述用户提供的模型在本地替换。
- 原 VRM 1.0 来源为第三方公开镜像 [arkavo-org/VRMMetalKit](https://github.com/arkavo-org/VRMMetalKit/blob/05afb6828fd48415b8d0141f5047e8b91b5b0c75/AvatarSample_A_1.0.vrm.glb)，固定提交 `05afb6828fd48415b8d0141f5047e8b91b5b0c75`；镜像不是官方发布服务器。
- 历史默认文件内嵌名称为 `Koharu · Avatar A v1`，版本 `1.0.0`，SHA-256 为 `fce86a78b4d7aad258af5e46236de1efcb5f84b1ad1b38fa99f55b3307f6579e`；未修改上游文件 SHA-256 为 `3a1956bf4e5aebae1013334af5bc16875154e3b8cd3bed1ff77e963d74f4b1ef`。
- 历史版本仅调整名称、版本及 `otherLicenseUrl`，保留上游二进制资源块和权限字段。本地制作产物为 `artifacts/avatar-a-v1/Avatar-A-Koharu-v1.vrm`，制作资料不随仓库发布。
- 该历史模型保留内嵌 [VRM Public License 1.0](https://vrm.dev/licenses/1.0/)，并适用 [VRoidPreset A–Z 官方使用条件](https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z)，不是 CC0；这些许可不适用于当前的 Violet Evergarden 模型。

以下记录旧黑发原型的来源和许可，所列 `artifacts/` 与 Blender 文件未随仓库分发，也不作为新部署的默认模型。

## Koharu 黑色常服 3D 原型与 V2 修正版

- 当前文件：`artifacts/koharu-black-v2/koharu-black-v2.vrm`；可编辑源文件为同目录的 `.blend`。V1 保留在 `artifacts/koharu-black-v1/`。
- 基于 pixiv Inc. 的 `VRM1_Constraint_Twist_Sample v1.0.1` 改制，复用基础网格、人形骨骼、表情和原有头发弹簧骨；不是从零原创的全部网格，也不是 AvatarSample_A。
- 原始模型来源：[pixiv/three-vrm](https://github.com/pixiv/three-vrm/blob/5a3242b66124386c32b085c6693d9059040e72e5/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm)，固定提交 `5a3242b66124386c32b085c6693d9059040e72e5`，SHA-256 为 `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`；[原始说明](https://github.com/vrm-c/vrm-specification/blob/master/samples/VRM1_Constraint_Twist_Sample/README.md)。该模型曾作为项目默认人物，后被 Avatar A 替换。
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
