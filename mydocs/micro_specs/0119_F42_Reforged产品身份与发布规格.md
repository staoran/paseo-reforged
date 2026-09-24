# F42 Reforged 产品身份与发布规格 Micro Spec

本任务承接 0118 的 F42 必做结论，锁定产品身份、发布边界和实施验收。Android APK 的 OOM、fallback、ABI 和构建资源边界见 [0120 F43 Android 发布可靠性与 APK 交付规格](0120_F43_Android发布可靠性与APK交付规格.md)。

## 0. 状态与索引

| 字段               | 值                                                          |
| ------------------ | ----------------------------------------------------------- |
| task_id            | `0119`                                                      |
| spec layer         | `Feature Spec`                                              |
| task status        | `实施中`                                                    |
| document status    | `Active`                                                    |
| depth              | `deep`                                                      |
| phase              | `Implement`                                                 |
| Execution Approval | `Approved`                                                  |
| Approval Source    | `User`                                                      |
| file path          | `mydocs/micro_specs/0119_F42_Reforged产品身份与发布规格.md` |
| parent spec        | `mydocs/micro_specs/0118_自定义功能重做与迁移分析.md`       |
| superseded by      | `N/A`                                                       |
| created / updated  | `2026-09-23 / 2026-09-24`                                   |

## 1. 目标与完成契约

- 当前理解：在 `90737e1dec064354d160ad51bcd4542b23852520` 基线上，将产品身份迁移为 Paseo Reforged，并为移动端、桌面端、CLI、更新源和商店发布建立一套可执行边界。
- 核心目标：锁定 Reforged 的名称、应用 ID、仓库和更新源；明确哪些兼容标识继续沿用；列出 EAS、商店、签名和 CI 发布前必须补齐的外部资源。
- Done Contract：本规格包含身份决策表、发布决策表、历史方案差异、实施文件清单、验收矩阵和回退边界；发布资源未核验前只做本地可逆实施和验证，不创建发布资源、不发布。

## 2. 范围与事实

### 范围内

- 应用显示名称、移动端包名、桌面 App ID、可执行文件和发布产物名称
- Reforged GitHub 仓库、桌面更新源、EAS Update 项目和发布身份
- CLI 展示文案、桌面发现路径、帮助链接、更新诊断和用户可见品牌文本
- 保留 `paseo://`、`paseo` CLI、`~/.paseo` 和内部 `@getpaseo/*` 的兼容边界
- Android/iOS/桌面发布前的账号、签名、商店和 CI 门禁

### 范围外

- F43 的 APK fallback、GitHub runner 构建资源优化、ABI 拆分和内存问题；这些内容由 0120 单独定义，F42 只提供身份和外部发布资源门禁
- 网站、Hub、Relay、官方文档站的域名迁移
- npm workspace 包 scope 重命名、协议命名空间重命名和 daemon 数据格式迁移
- 实际创建 Expo/GitHub/Apple/Google 资源、配置签名凭据、发布商店或推送远端

### 已确认事实

- 当前基线为 `upstream/main@90737e1de`，本地 `main`、`work/0118-custom-features` 和固定基线均已对齐。
- 当前 `origin` 已指向 `https://github.com/staoran/paseo-reforged.git`，`upstream` 指向 `https://github.com/getpaseo/paseo.git`。
- 历史演练分支为 `archive/drill/u0.9.0-beta.2-d636abd/feature/F42`，核心提交为 `aacb8806a779c422788dd525cc40cedff0e0946f`。
- 历史演练目标值包括 `Paseo Reforged`、`sh.paseo.reforged`、`sh.paseo.reforged.debug`、`sh.paseo.reforged.desktop`、`staoran/paseo-reforged` 和 Reforged artifact 命名。
- 上游 `ascAppId` 已从 `packages/app/eas.json` 移除；`packages/app/app.config.js` 已去掉上游 Expo project 默认值，缺新 ID 时关闭 Updates。

### 风险与未知

- 历史规格和 GitHub 仓库变量均出现 `EAS_PROJECT_ID=5e4527ba-abbd-428f-8a56-300c21b9e1af`，但其 Expo 归属尚未核验，不能据此开启 Updates；Expo owner、Apple App ID、Google Play application、Firebase 配置和签名也未核实。
- 2026-09-24 重新读取 GitHub Actions 清单：repository secrets 只有 `EXPO_TOKEN`，variables 只有 `EAS_PROJECT_ID=5e4527ba-abbd-428f-8a56-300c21b9e1af`。当前 APK 方案改为 GitHub runner 执行 `eas build --local`，由 EAS 提供托管签名凭据，不再要求五项本地签名 secret；Expo 项目归属和远端证书仍待实际构建核验。
- 历史规格 `0001_重命名与发布迁移` 记录：旧 APK 由 GitHub runner 执行 `eas build --local`，通过 `EXPO_TOKEN` 从 Expo server 使用 EAS 托管的默认 Android keystore；当时没有导出 keystore、alias 或密码。本机两份 debug keystore 的证书指纹均为 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`，与历史 Reforged APK 的 `cda6905cbfc3a949444f67ccc03c4ef4fe842efb4325966a021a34f40a2cf963` 不同。本机 EAS CLI 当前未登录，尚不能核验远端托管证书是否与历史 APK 相同。
- 移动端包名改变后，Reforged 与 Paseo 是不同的商店应用，不能依赖原应用的覆盖升级路径。
- daemon 的 npm 自更新仍以 `@getpaseo/cli@latest` 为目标；在 Reforged 自有 npm 发布轨道和兼容策略确定前，不把该入口计入更新源验收，也不对 Reforged npm 安装执行自更新演练。
- 桌面 App ID 改变后，旧 Paseo 桌面安装不会自动收到 Reforged 更新；必须先安装 Reforged，再使用 Reforged 更新源。
- 历史提交基于旧底座且包含与 F42 无关的历史差异，不能整体 cherry-pick。

## 3. 身份决策

下表是实施目标。`锁定`表示代码实现应按此执行；`外部核验`表示目标值已经确定，但执行前必须拿到对应平台资源或凭据证据。

| 身份面                      | Reforged 目标值                                | 状态     | 边界与理由                                                                           |
| --------------------------- | ---------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| 产品显示名                  | `Paseo Reforged`                               | 锁定     | App、桌面、CLI、通知、退出提示、错误提示和 onboarding 使用统一名称                   |
| 调试显示名                  | `Paseo Reforged Debug`                         | 锁定     | 与生产安装并存，避免调试包覆盖生产包                                                 |
| GitHub 仓库                 | `staoran/paseo-reforged`                       | 锁定     | 桌面发布、手工下载、issue 和社区入口使用该仓库                                       |
| 移动端生产 ID               | `sh.paseo.reforged`                            | 锁定     | iOS bundle identifier 与 Android package/applicationId 共用该产品身份                |
| 移动端调试 ID               | `sh.paseo.reforged.debug`                      | 锁定     | 独立于生产安装                                                                       |
| 桌面 App ID                 | `sh.paseo.reforged.desktop`                    | 锁定     | Electron/electron-builder 使用新身份                                                 |
| Expo slug                   | `paseo-reforged`                               | 锁定     | 不继续使用 `voice-mobile`                                                            |
| Expo owner                  | `tao-team`                                     | 外部核验 | 历史方案目标值；执行前确认该 owner 可管理新 Reforged project                         |
| EAS project                 | Reforged project，通过 `EAS_PROJECT_ID` 注入   | 外部核验 | 现有候选 ID 的归属待核验；禁止复用上游 `0e7f65ce-0367-46c8-a238-2b65963d235a`        |
| Desktop 更新仓库            | `staoran/paseo-reforged`                       | 锁定     | electron-builder publish、electron-updater 和手工下载统一指向该仓库                  |
| Expo Updates URL            | `https://u.expo.dev/<Reforged EAS project id>` | 外部核验 | 没有经核验的 project ID 时关闭 updates，禁止回退到上游 project                       |
| 应用 scheme                 | `paseo`                                        | 锁定     | 保留已有深链和配对链接兼容，F42 不改成新的 scheme                                    |
| CLI 命令                    | `paseo`                                        | 锁定     | 命令兼容与产品显示名解耦                                                             |
| daemon home                 | `~/.paseo`，由 `PASEO_HOME` 覆盖               | 锁定     | 不因品牌改名搬迁 daemon 数据、密钥、配对关系或 workspace 记录                        |
| npm workspace scope         | `@getpaseo/*`                                  | 锁定     | F42 不重命名内部包和 npm 发布 scope，避免扩大为依赖图迁移                            |
| 网站、文档、Relay、Hub 域名 | 继续使用现有服务地址                           | 锁定     | 只有 Reforged 对应服务实际部署后才替换链接；不能把 GitHub 身份改造伪装成基础设施迁移 |

## 4. 发布决策

### 4.1 发布轨道

1. 首个 Reforged 构建先走内部/预发布验证，确认应用 ID、签名、更新源和安装并存行为。
2. 不复用历史 `0.9.0-beta.2` 版本，也不把当前上游 `0.9.1` 直接当成 Reforged 发布版本。
3. 目标版本由当前代码差异和现行 release 流程在发布准备阶段重新判定；F42 规格不提前创建 tag、release 或 npm 发布。
4. Stable 发布前必须证明 Reforged 的桌面更新、移动端安装、daemon 连接和商店归属均不再指向上游资源。

### 4.2 外部资源门禁

| 资源            | 必须准备的证据                                                                        | 未满足时的处理                                         |
| --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| GitHub          | `staoran/paseo-reforged` 仓库、Actions 权限、Release 写权限                           | 不运行桌面发布 workflow                                |
| EAS             | 新 project ID、owner 归属、Update URL、build profile 可用                             | app config 不写入旧 project；缺 ID 时 updates 保持关闭 |
| Android         | `sh.paseo.reforged` 的 Play Console 应用、EAS 托管签名、Firebase/Google services 文件 | 不运行 production submit；APK 交付另由 F43 决策        |
| iOS             | `sh.paseo.reforged` 的 App Store Connect 应用、Apple team、证书和 provisioning        | 不运行 production submit                               |
| Desktop signing | macOS notarization、Windows signing、Linux 发布所需 secrets                           | 只允许本地未签名验证，不发布安装包                     |
| Update feed     | GitHub Release tag、artifact 名称、stable/beta channel 与 updater 配置一致            | 禁止从旧仓库下载或安装更新                             |
| 用户数据        | `~/.paseo` 保持可读，桌面新 userData 的并存行为通过验证                               | 不自动删除或覆盖旧 Paseo 数据                          |

### 4.3 资源 ID 约束

- 上游 `ascAppId: 6758887924` 已从 `packages/app/eas.json` 移除，Reforged App Store ID 尚未核验，不能运行 submit。
- `packages/app/app.config.js` 已去掉上游 Expo project 默认值，并拒绝注入已知上游 project ID；`tao-team` owner 仍需外部核验。
- 所有凭据通过环境变量、EAS secret、GitHub secret 或本地未纳入版本控制的 secret 文件提供，不写入规格、源码或仓库。

## 5. 历史方案对照

历史 F42 提交只作为身份目标和文件清单参考，不整体移植。实施时重新在当前基线定位同名入口。

| 历史做法                                                           | 本规格处理                          | 原因                                 |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------ |
| 根 package metadata 改成 Reforged 和新 GitHub 仓库                 | 保留目标，按当前版本重新实现        | 身份事实仍有效                       |
| app config 改包名、slug、owner，并从 `EAS_PROJECT_ID` 注入 project | 保留结构，先补新 project/owner 门禁 | 避免复用上游 Expo project            |
| desktop builder 改 App ID、产物、GitHub publish 仓库               | 保留目标，按当前 builder 配置重做   | 直接决定安装和更新归属               |
| CLI onboarding/open 改名称、路径和下载链接                         | 保留目标，逐入口核验                | 用户会从 CLI 进入发布产品            |
| i18n、welcome、help、changelog 和更新文案改名                      | 保留目标，覆盖所有语言资源          | 避免同一构建混用两套品牌             |
| 保留 `paseo://`、`paseo` 命令和内部 `@getpaseo/*`                  | 保留                                | 兼容协议、深链和 workspace 依赖      |
| 历史分支中的 `0.9.0-beta.2`、旧锁文件及无关测试变更                | 丢弃                                | 来自旧底座，不代表当前基线的发布输入 |
| 历史方案未更新 `eas.json` 的上游 App Store ID                      | 修正                                | 会把 Reforged 提交路由到上游应用     |

## 6. 实施文件与分阶段计划

当前在 `work/0118-custom-features` 上分阶段实施，基线为 `reforged/base/upstream-90737e1de`；现有 F43 未提交改动保留在工作树中。

### 阶段 A：身份常量与应用配置

| 文件范围                                                                     | 目标                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `package.json`、`packages/app/package.json`、`packages/desktop/package.json` | 更新描述、homepage、repository 等产品元数据；不改内部 workspace scope           |
| `packages/app/app.config.js`                                                 | 更新显示名、移动端 ID、slug、owner/project 注入、runtime version 和 Updates URL |
| `packages/app/eas.json`                                                      | 清除上游 App Store ID；补齐 Reforged submit 配置前先核验外部应用 ID             |
| `packages/app/public/index.html`、`packages/app/public/manifest.json`        | 更新 PWA 显示名                                                                 |

### 阶段 B：桌面、CLI 和更新链

| 文件范围                                                                               | 目标                                                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/desktop/electron-builder.yml`                                                | 更新 App ID、product name、executable、artifact、publish owner/repo 和安装器文本 |
| `packages/desktop/src/main.ts`、`packages/desktop/bin/*`、`packages/desktop/scripts/*` | 更新运行时名称、Helper/launcher 路径、打包 smoke 路径和工作区 userData 隔离名称  |
| `packages/app/src/desktop/updates/*`、daemon self-updater                              | 更新桌面 Release URL、artifact 名和 Reforged 文案                                |
| `packages/cli/src/commands/onboard.ts`、`open.ts`                                      | 更新 CLI 文案、桌面路径和下载入口；保留命令名                                    |

### 阶段 C：用户可见文本与入口

| 文件范围                                                           | 目标                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `packages/app/src/i18n/resources/*`                                | 所有语言统一显示名，更新测试期望                                    |
| welcome、community、sidebar help、startup error、changelog 入口    | GitHub、issue、changelog 和品牌文本指向已确认的 Reforged 位置       |
| `packages/cli/src/commands/plugin/scaffold.ts`、文档链接和服务链接 | 仅替换已确认属于产品仓库的链接；保留未迁移的官网/Relay/Hub 服务地址 |

### 阶段 D：验证和发布准备

1. 用无 secret 的配置评估 app config，确认缺失 Reforged EAS project 时不会回退到上游 project。
2. 静态核对产品仓库、桌面 release URL、artifact 名、移动端 ID 和 Expo project 入口。
3. 运行受影响的配置、桌面打包路径、更新 URL、i18n 和 CLI 测试；不运行全量测试。
4. 按 QA 要求覆盖 Android、iOS、Web、Electron Windows/macOS/Linux 中受影响的平台，并记录真实安装/启动证据。
5. 只有外部资源门禁和验证矩阵都通过后，才进入当前 release 流程，由用户另行授权发布。

## 7. 验收矩阵

| 验收项         | 通过标准                                                                                                       | 证据                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 品牌一致性     | 生产 App、桌面、CLI、PWA、通知和错误入口均显示 `Paseo Reforged`                                                | 配置检查、i18n 测试、桌面截图              |
| 移动端身份     | production/debug 的 iOS bundle ID 与 Android package ID 分别为 `sh.paseo.reforged` / `sh.paseo.reforged.debug` | `expo config` 输出、Android/iOS 构建元数据 |
| EAS 隔离       | 新 EAS project 生效；缺失 ID 时不引用上游 project                                                              | app config 输出、EAS build 记录            |
| App Store 隔离 | `eas.json` 不再提交上游 `ascAppId`，submit 目标是 Reforged 应用                                                | 配置审查、EAS submit 记录                  |
| Desktop 隔离   | App ID、安装器名称、artifact、更新源均指向 Reforged                                                            | builder 配置、安装包元数据、更新检查记录   |
| CLI 发现       | `paseo` 命令能找到 Reforged 桌面安装并展示 Reforged 下载入口                                                   | Windows/macOS/Linux CLI 记录               |
| 兼容边界       | `paseo://`、`paseo` 命令、`~/.paseo`、daemon 协议和 `@getpaseo/*` 未被无关改名破坏                             | 深链、CLI、daemon 连接和包构建验证         |
| 更新安全       | Reforged 不从 `getpaseo/paseo` 或旧 EAS project 拉取更新                                                       | 静态检索、更新源配置和运行时日志           |
| 并存安装       | 旧 Paseo 与 Reforged 不互相覆盖；Reforged 不删除旧数据                                                         | 各平台安装验证和目录检查                   |

## 8. 执行前检查点

- 当前目标：锁定 F42 的产品身份和发布边界，形成可直接进入实现的规格。
- 当前进度：阶段 A 的移动端身份、EAS project 隔离、上游 App Store ID 移除、包元数据和 PWA 名称已实施；阶段 B 的 Electron builder、Nix 桌面包、CLI 路径、更新诊断和下载入口已改；阶段 C 的多语言产品文案、GitHub 帮助及 changelog 入口已改。Expo 无 ID 生效配置显示 Updates 关闭，builder 配置的 App ID、仓库和产物模板已静态核对；i18n/更新 URL 测试 46 个及 daemon 提示测试 7 个通过，typecheck 和 lint 通过。桌面诊断测试因本机 Electron binary 缺失且下载中断，未执行断言；Nix、原生安装和签名 APK 尚未实测。
- 当前动作是否仍服务核心目标：是；已改用 EAS 托管签名，Firebase 配置与远端证书仍待核验，本地身份改造继续推进。
- 下一步：运行定向测试、typecheck 和 lint，复核静态发布链；恢复 GitHub/Expo 只读访问并核验项目归属与生产签名后，再做真实 APK 和商店链验收。
- 风险与回退：规格创建可删除；实施阶段保持旧上游引用和 `paseo://`/`~/.paseo` 兼容，发布资源未满足时停止在本地验证。
- 验证方式：静态配置核对、受影响测试、跨平台打包/安装证据和更新源隔离检查。
- TDD 判定、测试 seam 与验收行为：`N/A`；本轮不改产品代码。实施阶段复用现有配置测试、桌面打包测试、i18n 测试和 CLI 测试。
- seam 确认：`N/A`；本轮没有代码 seam。
- Execution Approval / Source：`Approved / User`；用户已授权在找不到旧 APK 密钥时开始其他实施工作，尚未授权发布。

## 9. 验证与完成判断

| 验收项    | 命令或步骤                                       | 结果 | 证据                                                         |
| --------- | ------------------------------------------------ | ---- | ------------------------------------------------------------ |
| 历史方案  | 查看 `aacb8806a` 及 F42 归档分支                 | 通过 | 已提取身份文件、包名、桌面更新源和 CLI 入口                  |
| 当前基线  | 核对 `90737e1de` 的 app/eas/desktop/release 入口 | 通过 | 已确认上游曾配置旧 EAS project 与 `ascAppId`                 |
| 规格覆盖  | 核对身份、发布门禁、实施文件和验收矩阵           | 通过 | 本文第 3–7 节                                                |
| 文档格式  | `npm run format:check:files -- ...`              | 通过 | 0119、Android 文档和改动的配置文件均通过格式检查             |
| Lint      | `npm run lint -- packages/app/app.config.js`     | 通过 | 当前改动文件 lint 无错误                                     |
| Typecheck | `npm run typecheck --workspace=@getpaseo/app`    | 通过 | 重建 protocol/client/plugin 声明后通过                       |
| 产品代码  | Expo config production/debug 与 EAS 注入检查     | 通过 | Reforged 身份正确；缺 ID 时 Updates 关闭，注入上游 ID 时失败 |

- 未验证项与原因：本机 EAS 未登录；未取得 Apple、Google 或商店资源。历史签名由 EAS 托管，本机仅有指纹不匹配的 debug keystore；GitHub Actions 已有 `EXPO_TOKEN` 和 `EAS_PROJECT_ID`，但尚无当前基线的完整 EAS local APK 构建，Firebase 配置也未核验。
- 剩余风险：Expo owner/project、商店应用 ID、托管证书和 Firebase 配置必须在发布前由实际构建与账号权限确认。
- Done Contract 是否由证据满足：阶段 A 的本地身份配置已实施；完整产品身份迁移和发布验收尚未完成。

## 10. 恢复与同步

- 状态说明：0119 阶段 A 的本地身份配置已完成；Android/iOS 的 Reforged production/debug 身份已在 Expo config 求值中通过验证。
- 当前卡点：EAS project 归属、Apple/Google 应用、EAS 托管证书、Firebase 配置和 daemon npm 自更新轨道尚未核验；F43 的 Android 交付仍缺 GitHub runner 实测。
- 下一步：推进不依赖外部资源的桌面与 CLI 身份改造，同时补齐发布凭据后再验收 APK。
- Resume / Handoff：先读本文第 3、4、6、7 节；基线为 `upstream/main@90737e1de`；历史参考为 `aacb8806a`。
- Project Sync Candidates：无；身份与发布决策先留在 F42 Feature Spec，待实际发布资源稳定后再判断是否同步到项目长期文档。
- 长期文档同步：已同步移动端身份和 APK 路径到 `docs/android.md`；发布资源稳定后再整合跨任务仍有效的事实。

### 提交记录

| 提交信息（Commit Message） | 提交脚注（Commit Footer） | 关联改动或阶段 | 文档同步状态 | 备注             |
| -------------------------- | ------------------------- | -------------- | ------------ | ---------------- |
| `不提交`                   | `N/A`                     | 0119 规格创建  | 已同步       | 用户尚未要求提交 |
