# 3D simulator — 4yi Web integration

Application display name: **3D simulator**. This release candidate is based on GitHub branch `codex/4yi-marketplace`, commit `d7e8531504bc0739e6250f99595357457764622e`, with the user-requested rename. Use this display name for the 4yi DEV application; service name `web`, runtime variables and deployment declaration fields remain the platform integration contract.

## 2026-11-06 DEV compatibility fixes

- Preserve the reference configuration: one Dedicated public service, port 3000, `/healthz`, non-root UID 1000, 1 CPU / 2048 MB, and a 1 GB `/data` volume. Keep required router signatures and the selected `gpt-6-sol` model slot; install-time gateway credentials remain server-only.
- Preview reads now report authorization, missing-artifact, storage, redirect and timeout failures. Authorized HTML is capped at 8 MiB and displayed in an opaque `allow-scripts` sandbox with a fixed CSP. Generated documents report startup exceptions and missing rendering instead of silently staying blank. These measures are not a complete execution/network isolation certification.
- A definite HTTP 413 on reference submission enables a scoped, signed chunk protocol (8,192 Base64 characters per chunk, requests below 12 KiB). Temporary storage is bounded in memory and expires after 10 minutes. Refresh or process restart during upload requires resubmission; accepted jobs and references remain persisted under `/data`. An uncertain job submission is never retried automatically.
- Authenticated `GET /api/runtime` returns a reproducible source fingerprint, a per-process instance identifier, the selected model and a hashed user/organization scope. It returns no credentials, raw identity IDs or disk paths. Compare it with `web-dist/build-info.json` from the release build when diagnosing mismatched installed versions.
- Local unit, HTTP and browser fixtures validate failure handling; they do not replace a real DEV install, generation, reference upload, restart test or multi-account isolation evidence. The optional local visual-review worker is not enabled in this deployment.

Status: incomplete Web adaptation. The Web UI, scoped task store, bounded multi-file authoring tools, and restricted browser preview are implemented. A DEV test version was imported, but it is not the full upstream agent workflow or a production-quality release. Later dated evidence below supersedes earlier local-only observations.

## 当前 4yi 部署配置

配置参照 [4yi-ai/teardown 部署声明](https://github.com/4yi-ai/teardown/blob/main/4yi-app.json) 与 [Dockerfile](https://github.com/4yi-ai/teardown/blob/main/Dockerfile)，于 2026-11-05 再次核对。导入时选择 Dedicated，每组织独立安装，当前只支持单副本；实例内任务继续按组织和用户隔离。

| 项目 | 配置 |
| --- | --- |
| 构建 | 根目录 `Dockerfile`，context `.`；Node 22 Debian，锁文件安装，两阶段构建 |
| 服务 | 唯一 public 服务 `web`；启动 `node web/server.mjs`；监听 `0.0.0.0:3000` |
| 健康检查 | `GET /healthz`，无需身份及模型调用 |
| 资源 | 1 CPU、2048 MiB 内存 |
| 持久化 | 1 GB 挂载 `/data`；`TEARDOWN_DATA_DIR=/data`；`node` 用户，`fsGroup:1000` |
| 模型槽位 | `TEXT_MODEL`，类型 `chat`；默认 `gpt-6-sol`，保留用户已验证选择；`TEARDOWN_REASONING_EFFORT=none` |
| 路由身份 | `FOURYI_ROUTER_IDENTITY_REQUIRED=1`；服务实际校验签名，不能与 `TEARDOWN_LOCAL_MODE=1` 同时启用，否则拒绝启动 |

平台必须通过运行环境注入以下配置，不将真实值提交 Git 或写进镜像：

- `OPENAI_API_BASE`：平台 OpenAI 兼容网关地址；不固定到开发环境。
- `OPENAI_API_KEY`：当前安装组织的网关令牌；不使用开发者个人密钥。
- `TEXT_MODEL`：安装时选定的模型，需实际支持本应用的工具调用及图片输入。
- `FOURYI_ROUTER_IDENTITY_KEY`：安装级路由校验密钥，与路由签名端匹配。
- `XCLAW_APP_HOSTNAME`：该安装实例的应用域名，与签名中的域名匹配。

以上 secret/runtime 映射在 Import 的 proposal 中核对，不向 `4yi-app.json` 添加平台未定义的字段。部署时不启用 `TEARDOWN_LOCAL_MODE` 或本地视觉渲染器；图片上传还要求平台路由允许 6 MiB 请求并对完整正文签名。本地配置文件由本地启动器使用，生产入口不自动读取它。

当前配置已对齐接入格式，尚未完成的容器、真实安装、资源及隔离验收见本文末尾部署自检记录。

## Product outcome

A user describes a machine and optionally provides reference material. The app starts a coding-agent job, shows its progress, and returns an interactive HTML simulator. A result can be previewed and downloaded after validation. The existing three example simulators are useful for testing, but they do not replace generation.

## Upstream behavior

`SKILL.md` is an agent workflow, not an HTTP service. The agent must create code, run `sims/build.mjs`, inspect rendered output, and iterate. Video additionally uses `sims/capture.mjs`, Chromium, Python and ffmpeg. These dependencies and the kit must be available to the execution environment; merely sending the skill text to a model is insufficient.

## Proposed integration boundary

The intended deployment is one dedicated installation per user, with each user installing through their own personal organization. The platform currently deduplicates installations per application and consumer organization, so this assumption is required to achieve one instance per user. A shared multi-tenant application is outside this release scope.

1. The web app authenticates the user through the existing 4yi marketplace application route.
2. The installed app uses its selected model and platform-provided OpenAI-compatible gateway configuration for model calls. An execution service runs the agent with an immutable copy of this repository and its skill, an isolated per-run workspace, and a fixed output contract.
3. The execution environment builds the simulator, captures inspection frames, and iterates. It reports durable progress, cancellation, failures, resource usage, and output artifacts through the platform's existing run/artifact mechanisms.
4. The app retrieves only artifacts authorized for that user and previews generated HTML in an isolated origin or suitably sandboxed frame. Downloads use the same authorization boundary.

Dedicated marketplace applications already have a model-selection and per-install gateway-token path; they need not call the platform chat API merely to use a model. The actual execution isolation and artifact contracts remain to be established. An SSO identity header alone is not a credential for invoking chat APIs. The architecture document in xclaw describes an Apps Builder as a future phase and is not evidence that such an endpoint is already deployed.

## Acceptance before marketplace release

- Starting a real generation from the app produces a new simulator for a request outside the bundled examples; its HTML opens and responds to interaction.
- Progress, failure, cancel, retry, refresh/reconnect, and output retrieval work for a real run.
- Verify that a user cannot access another personal organization's instance, jobs, or artifacts, including by bypassing the router. Browser preview cannot execute with app-origin privileges.
- Code execution is isolated from the web service, platform credentials, other runs, and unrestricted internal network access. Time, CPU, memory, output and concurrency limits are enforced.
- Model and execution costs are attributed to the installing organization; credentials are provided by the platform and never embedded in the browser or repository.
- Docker build, health endpoint, root `4yi-app.json`, storage lifecycle and runtime requirements are checked through the existing marketplace import and publish gates.
- Validate Chromium/WebGL, video and audio separately if those features are exposed. Do not advertise them based only on the presence of upstream scripts.

## Evidence and immediate work

- Fork: `4yi-ai/teardown`, base commit `a91262ac1109051e014662d42ecb0b7bc1f113b1`.
- `sims/build.mjs` produces self-contained HTML for machine source directories, with optional adjacent assets.
- The xclaw router injects user and route identity headers for SSO routes; the chat turn API separately authenticates its caller. A safe delegated call from a marketplace app has not been verified.
- `provisionDedicatedInstall` resolves selected models for the consumer organization and mints a per-install gateway token. `buildPlatformRuntimeGatewayEnv` injects the selected model, gateway URL, and token through the deployment environment. The app should read those variables server-side and never bundle the token into browser code.
- The existing 4yi Claude Code guide describes an Anthropic-compatible gateway for Claude Code. The standard imported-app runtime currently injects an OpenAI-compatible `/api/v1` base; using Claude Code directly must therefore verify the chosen model, protocol, URL and per-install token against the real gateway rather than assuming these contracts are interchangeable.
- 2026-11-04: a real DEV OpenAI-compatible gateway probe with a separately supplied test key listed models and exercised `gpt-5.6-sol` function calling, a tool-result follow-up, and streamed output. This proves that narrow protocol sequence only, not arbitrary simulator generation, the per-install token, or production readiness. `claude-sonnet-5` was listed but returned an upstream Bedrock account access error when called.
- 2026-11-04: `npm ci` succeeded and the upstream build produced all six example HTML files. Initial local gateway-client and restricted static-bundling tests pass. The experimental generator compiles model-provided source without executing it on the server, but has not been integrated into an application or verified as equivalent to the upstream skill's agent, rendering and visual review loop.
- The first real generation request using `gpt-5.6-sol` received HTTP 402. The user's personal-organization balance is positive; the key's actual billing organization has not yet been verified, and a 402 does not prove that this personal balance is insufficient. A later small request succeeded, while the larger `gpt-5.6-sol` request again returned 402.
- 2026-11-04: `gpt-6-luna`, with `max_completion_tokens` and `reasoning_effort: none`, generated one crank mechanism through the experimental generator. Browser smoke testing of the resulting HTML observed a 3D canvas, no page errors, a working pause button and a speed slider. This is one sample, not proof of arbitrary generation quality or of the upstream skill's full execution, visual-review, video, isolation, or marketplace workflow.
- The 2026-11-04 prototype supported bounded multi-file write/read/build tools and static build repair without executing generated code on the web server. At that point it did not execute the upstream coding agent, use the original simulation kit, inspect rendered frames with a vision model, upload references, or create video/audio. It must not be described as the complete Teardown skill. See the 2026-11-05 local changes below.
- Candidate change: non-local requests require a signed 4yi router identity, including the method, path and body. The platform injects an installation-scoped verification key; `/healthz` remains available to the platform health checker. For protected routes, the router uses a host-only SSO cookie and accepts only a session issued for that route. The key and router changes must be deployed together and independently validated before release.
- Replay protection persists verified nonces in the instance's data volume. This candidate supports one replica only. Request bodies are bounded at 16 KiB except `POST /api/jobs`, which accepts up to 6 MiB for inline reference images; the signature covers the entire body. The platform ingress limit must be checked before deploying image uploads. This is not a substitute for transport encryption or an independently assessed isolation boundary. Verify real install-scoped gateway tokens and access between separate personal installations before publishing.
- The job store supports one process and one persistent volume; it has not been validated for concurrent replicas or distributed queueing. Browser `sandbox` and CSP are defense in depth, not evidence of an isolated execution infrastructure.
- 2026-11-04: the local prototype UI submitted a Chinese prompt through the DEV model gateway and displayed a generated canvas. The pause control was exercised. Desktop 1440px and mobile 390px light/dark tests were also exercised using a fixture. These are local tests and do not establish production isolation or agent visual review.
- The `4yi-app.json` candidate passed the current declaration parser. The first local Docker build failed with `no space left on device`; an installed per-organization token has not been verified.
- On the user-specified ARM64 build host, the standard Docker image built successfully. A network-disabled smoke container returned HTTP 200 from health and UI as uid 1000 with a writable data directory. After a cancellation race fix, a rebuilt candidate passed all nine tests in the container. Non-local startup without the proxy-boundary setting was separately confirmed to fail closed. This does not verify a real install token or the deployed ingress boundary.
- The bounded multi-file tool loop passed local and ARM64 container tests with deterministic model fixtures. Real DEV runs reached the tool loop but returned HTTP 402 on a subsequent model call, so the full multi-file model workflow has not been validated against a real provider.
- A separate experimental visual-worker image was built on the ARM64 build host. A disposable container with no network, a read-only filesystem, dropped capabilities and bounded resources rendered a test canvas and returned a JPEG; a network fetch failed in the same configuration. The worker is not connected to the app or a vision model. Chromium uses `--no-sandbox`, so these smoke tests do not establish a sufficient hostile-code isolation boundary; production requires an independently assessed sandbox and orchestration, including timeouts and cleanup.
- The generator accepts an injectable visual reviewer. It can submit a frame to a vision-capable gateway and return failed-review feedback to the agent for a bounded repair loop; fixture tests cover rejection and subsequent repair. The HTTP service can enable this path only in local mode using `TEARDOWN_LOCAL_VISUAL_URL` and an optional `TEARDOWN_VISION_MODEL`. A local-only experimental supervisor runs one disposable worker container without passing model credentials; its container and screenshot path were smoke tested on the ARM64 build host. This is not a production executor, and a real multimodal gateway call has not been validated. Without a reviewer the prototype still completes after a static build and must not be presented as visually verified.
- An end-to-end probe on the ARM64 host exercised the actual local HTTP service, generation task, disposable screenshot container, visual-review request and authorized preview. The model was a deterministic HTTP fixture; this is not a real-model or marketplace-install test. Before the subsequent top-up, a DEV gateway image-input probe using the supplied key returned HTTP 402 `balance_required`; database inspection identified a separate same-name personal organization as the key owner.
- After the key-owning organization received funds, a DEV gateway image-input request to `gpt-5.6-sol` returned 200 and correctly described the supplied screenshot. A subsequent local HTTP job used `gpt-6-luna` for multi-file generation, the ARM64 host's disposable screenshot container through a loopback SSH tunnel, and `gpt-5.6-sol` for visual review; it completed and returned a preview. A browser check observed a canvas, a speed slider and a pause button that changed to resume when clicked. This is one scenario in local development mode, not the upstream agent workflow, a production sandbox, or a real marketplace installation.
- The DEV database's app-platform configuration specifies `xclaw-apps-prod` in account `398800074406`. The observed absence of Kubernetes NetworkPolicy in that shared cluster applies to that configured cluster; other network enforcement still needs to be assessed before trusting identity headers.
- A read-only inspection of the `xclaw-apps-prod` Kubernetes context returned zero NetworkPolicy resources, and the network policy agent reports disabled. A disposable same-namespace test demonstrated direct pod access. The signed-identity candidate has not yet been rolled out or verified in that cluster.
- Next: validate model tool-call support against the selected gateway model and establish a per-run isolated executor, then exercise a real non-production generation and artifact preview.

### 2026-11-05 local reference-image workflow

- The local Web UI accepts up to three JPEG, PNG or WebP reference images. Before upload it resizes to a maximum edge of 1536 px and converts to JPEG, removing source metadata. Server limits are 2 MiB per image and 4 MiB total, with binary container and dimension checks. The server does not decode pixels or claim full image-decoder validation.
- Reference files are stored privately with the task, retrieved through the same organization/user scope as the artifact, and excluded from public task JSON. Only metadata is returned there. The comparison panel shows the uploaded images and separate observed, inferred and uncertain findings. Draft images remain in browser memory until submission; reloading an unsubmitted draft requires selecting them again.
- A real request to the configured `gpt-6-sol` gateway analyzed a motor cutaway image. A subsequent job submitted through the upload UI passed the image to both analysis and code generation, persisted the analysis, and produced an HTML artifact. This validates the local multimodal path only, not arbitrary reconstruction accuracy or a marketplace installation.
- The generation workspace can read a fixed catalog of geometry, kinematics and lighting examples. It can import the exact browser-only `teardown-stage` module for reusable studio lighting, reflections, shadows, camera fitting and orbit controls. Arbitrary server imports and generated-code execution in the Web process remain prohibited.
- Code-generation instructions now require a single existing `#app` mount, named parts, real bores/wall thickness, sensible local rotation pivots, assembled/cutaway/exploded modes and explicit schematic assumptions. Generated source files are retained privately as `project.json` for future diagnosis; they are not returned in task lists.
- The local screenshot worker is not automatically enabled. Compilation success still does not certify runtime behavior or visual quality. The first uploaded-motor result needed manual correction for a duplicate root element and rotation pivots during browser review. Prompt changes alone are not evidence that future outputs will always avoid these defects.
- These artifacts are educational visualization models. Photo-based estimates must not be described as measured CAD, printable engineering parts, or physically verified assemblies. STEP/3MF export, dimensional constraints, tolerances, calibration and physical print/assembly verification remain separate future work.
- Final local checks: 28 unit/integration tests passed, including scoped image downloads and complete-body signatures. Independent browser tests covered upload/remove/reuse, draft retention on failure, delayed-image input preservation, and reference enlargement. Desktop/tablet/phone shell inspection passed. The motor sample was manually corrected and checked in assembled, cutaway and exploded modes; pause, resume, speed/readout synchronization, part selection and reset worked without page errors. These checks do not activate automated visual review for subsequent jobs or replace real print tests.

### 2026-11-05 4yi 部署自检（当前本地修改版）

结论：应用具备 Dedicated Web 应用的接入基础，但尚未达到正式部署验收标准。以下证据针对当前本地修改版，不代表 GitHub 上的版本，也不代表已在 4yi 安装或发布。

本次依据：[上游接入指南，提交 673c2db2f3148221ccd35c43030ad30e3b84fa70](https://github.com/4yi-ai/teardown/blob/673c2db2f3148221ccd35c43030ad30e3b84fa70/docs/4yi-app-developer-quickstart.md)。本地基准 HEAD 为 `c9ecd01d55dc4b11a473d0170e86b80d81c2e31f`；当前新增上传、生成与界面功能尚未提交推送，因此没有包含本次全部功能的可导入 SHA。

本轮修正：

- 部署声明默认模型调整为本地已验证的 `gpt-6-sol`，补充 `TEARDOWN_REASONING_EFFORT=none`，避免平台启动时漏掉本地成功调用所需参数。模型仍读取平台注入的 `TEXT_MODEL`，不硬编码个人令牌。
- 畸形请求地址（例如 `//[`）现在返回 400，避免在认证前产生未捕获异常而终止服务；回归测试确认后续健康检查仍返回 200。
- Docker 构建排除 `.local`、`.env`、`.env.*` 和 `*.env`，降低后续误将本地配置复制进镜像的风险。

| 检查项 | 本次结果与证据范围 |
| --- | --- |
| 部署声明一致性 | 版本 1、一个 public 服务、Dockerfile/context 路径、端口 3000、`/healthz` 与实现一致；未替代平台 Analyze 的声明解析。 |
| 监听与存储配置 | 生产入口配置监听 `0.0.0.0`；Dockerfile 使用 `node` 非 root 用户及 `/data`，声明 `fsGroup:1000`。容器和实际挂载卷尚未验证。 |
| 依赖与前端构建 | 全新临时源码目录执行锁文件安装及 `node web/build.mjs` 成功；环境为 macOS ARM64、Node 24.19.0、缓存 npm 12.2.1（离线安装，生命周期脚本由该 npm 默认策略阻止）。此证据不能替代 Dockerfile 的 Node 22/Linux 构建。 |
| 单元与集成检查 | `node --test web/*.test.mjs`：30 项通过、0 失败；`git diff --check` 通过。 |
| 生产入口完整流程 | 新增 `web/deployment.test.mjs`，真实启动 `node web/server.mjs`，使用独立临时目录、随机端口及人工模型响应。验证声明中的模型参数、健康检查无模型调用、签名图片上传、分析、工具编译、完成结果与参考图下载。没有读取个人配置或调用外部模型。 |
| 身份及重启 | 上述入口测试验证无签名/伪造身份 401，同组织其他用户和其他组织的详情/预览/图片 404。强制退出后，完成任务及图片保留；新进程拒绝仍在有效期内的已用 nonce；进行中任务变为 `failed/interrupted`，不会自动续跑或重复调用模型。均为模拟身份，未代替真实多账号验收。 |

发布前仍需完成：

1. **构建和可追溯版本**：提交并推送包含全部修改的授权 GitHub 分支，记录 SHA。本机未安装 Docker/Podman/Colima；本轮未构建容器，未验证 Linux/目标架构、非 root 卷写权限或容器资源。前文历史容器测试不适用于本次新版本。
2. **实际平台路由及模型**：确认安装级 `FOURYI_ROUTER_IDENTITY_KEY`、`XCLAW_APP_HOSTNAME`、网关地址/令牌/模型注入。确认入口允许 `POST /api/jobs` 的 6 MiB 请求，签名覆盖完整正文；使用安装组织令牌验证 `gpt-6-sol` 的工具和图片输入能力、权限及计费。个人本地调用成功不能替代此项。
3. **生成内容隔离**：当前 `sandbox="allow-scripts"`（没有 `allow-same-origin`）保护应用来源权限，CSP 阻断 fetch 等连接；但生成脚本仍能导航自身 iframe 到外站。本轮用同样响应 CSP 和 iframe 属性在临时浏览器中复现了 `location.href` 外站导航请求；请求被测试拦截并终止，没有真实外发。不能宣称完全禁止联网或据此填写完整隔离 Certify。需要明确平台接受的边界，或改为受控场景描述与可信渲染器/经验证的隔离执行方案。
4. **资源与容量**：有每次模型请求 120 秒、最多 24 轮、并发 3 个/每用户 1 个及源码/图片大小限制，但编译、模型响应体及浏览器脚本缺少完整独立预算。1 GB 卷没有应用级总量配额、删除或保留策略；磁盘耗尽时终态保存可能失败。正式持续使用前需要容量控制、可见失败处理及对应测试。当前仅支持单进程、单副本，不适合并发副本共享同一任务目录。
5. **4yi 验收流程**：对实际提交执行 Import → Analyze，检查 blocker 和 proposal；在获准部署后执行 Apply/Release、构建/启动/smoke、Publish Gate。再以真实组织与账号检查隔离、预览/下载、刷新、重启/更新、休眠唤醒、额度归属及消费者版本。本轮未执行导入、发布或人工 Certify。

功能边界保持不变：当前用于交互式教学展示；生产没有自动视觉验收，不提供经过验证的打印 CAD、配合公差或实物装配保证。

### 2026-11-05 生成质量审计与展台恢复

用户对比了 README 中精细机器人展台和实际生成的粗糙几何模型。审计确认原始
`SKILL.md`、`sims/`、`sfx/` 未删除，但 Web 原先只开放基础舞台及三份 V8 参考，
没有接入完整仪表、子系统控制和巡游。无视觉审核器时，静态编译后即标记任务完成。
这不是原版完整工作流，也没有证据将质量差距归因于某个模型。

本轮源代码修复：

- 新增可信 `teardown-exhibit` 模块，实际提供两侧仪表、可调参数、部件选择说明、
  子系统显隐、装配/剖切/爆炸、相机视角、暂停及巡游时间线。运动与读数使用同一个
  `model` 状态；爆炸偏移使用独立父组，保留原部件转轴。用户操作接管后闲置 25 秒
  恢复，明确关闭巡游或暂停时不自动恢复；支持减少动态效果及小屏滚动。
- 新生成项目必须将该模块保留在最终 bundle，仍由模型编写真正的机器几何和运动学。
  esbuild 依赖证据只表示模块被打包，不证明它实际挂载或质量合格。固定参考库补充
  V8 仪表、巡游、时间线和 Cessna/Strandbeest 几何/状态代码；不开放任意文件路径。
- 实验渲染器采集装配、剖切、爆炸和巡游画面，并操作实际控件，检查时钟暂停/恢复、
  显隐、位移及持续有效的读数。剖切必须使原本可见的外壳隐藏且保留可见内部件。
  视觉模型同时收到用户参考图。三个失败审核后终止，反馈及独立质量状态保存到任务。
- 历史及新结果明确区分生成完成、画面检查、基础交互检查。没有审核证据的旧任务
  标为未检查，不改写历史产物，也不声称 CAD、物理准确性或完整运动周期已经验证。

本轮本地证据：42 项 Node 测试通过，Web 构建及 diff 检查通过。独立临时 Chrome
在禁网、开启浏览器 sandbox 的配置中验证了原 V8 测试样机的 14 项基础检查，
1440/768/390 三种宽度、参数与读数联动、命名选择、真实 25 秒闲置恢复、显式关闭、
减少动态效果及清理。浏览器负例验证整机剖切消失、预先隐藏部件、运行后 NaN 和
更新异常均不能通过。`web/check-exhibit.mjs` 可复验，截图/报告在本地
`.taste-skill/exhibit-restoration/`。这是一份明确标注的手写回归样机，**不是模型生成
机器人达到参考图水平的证据**。

仍未完成：DEV 的生产画面检查和自动返修服务没有接入。现有 Docker supervisor
与 `--no-sandbox` worker 保持本地实验用途，不能通过删除 local 限制或把 Docker
socket 挂进 Web 容器启用。此前实际消费者实例中约 134 KB 的图片请求返回 413，
图片入口链路仍需处理。必须接入经验证的独立执行器，并重新以真实安装实例、
真实参考图完成生成/检查/返修、确认实际版本及权限，才能声称完成相应交付。
Web 端 60 fps 视频/音频录制仍未实现。仓库只有 Mellis HB-7 展示 GIF，没有可直接
恢复的蜂机器人完整源码。上述本轮修复尚不是新 DEV 发布或原版全部能力恢复。


### 2026-11-06 中英文适配（待目标环境验收）

本轮为 3D simulator 增加 `zh-CN` / `en` 完整界面文案、按用户保存的语言选择、
任务创建时固定的 `locale`，以及新模型和下载副本的语言切换。切换不会重新创建任务、
重载预览 iframe 或改写历史生成文件；原有单语结果保留原文并显示说明。

平台偏好入口沿用参考仓库 `4yi-ai/teardown` 提交
`7d66c89f7b2ce848181be33cadfa6896f9b8e251` 的 SSO Cookie 约定：
`__Host-xclaw_app_locale`（优先）或 `xclaw_app_locale`，只接受 `zh` / `en`。
新增 `GET /api/locale` 在原有路由身份验证之后返回规范化 locale 和用户 scope 指纹；
该 Cookie 只作为展示偏好，不能建立登录身份。应用默认跟随，在获得焦点、重新联网和
页面可见时检查平台最近传入的语言；暂时缺失时保留该用户上次已知语言。

这并不证明 DEV 平台在网站切换时会更新已打开应用的 Cookie。平台与应用跨域，
应用不能读取主站的 localStorage；主站首次 launch 传值和已打开页面同步必须分别实测。
缺少传递机制时，需要平台端配合，不能把轮询旧 Cookie 或浏览器翻译当成验收通过。
完整环境结果应以本次实际 release、消费者指纹和测试记录为准。

新生成文案、可信展台控件和预览语言桥使用同一 locale；桥只接受确切父窗口与来源，
不传递令牌或任务数据。预览仍采用不含 `allow-same-origin` 的 sandbox 及原 CSP。
这些修改没有扩大生成代码的执行权限，也不弥补前文已记录的完整网络/资源隔离限制。
