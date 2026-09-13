# Paseo 项目规则

本文件由项目根 `AGENTS.md` 符号链接加载，只保留项目路由、授权和任务边界。

## 项目资料路由

- 工程任务先读 `PROJECT.md#基本介绍`
- 修改、记录、验证或提交前再读 `PROJECT.md#项目工作流参数`
- 按任务信号匹配 `PROJECT.md#项目专有规则`
- 只加载 `PROJECT.md#私有技能路由` 精确登记且命中的 `SKILL.md`
- 规则优先级为局部 `AGENTS.md`、项目根 `AGENTS.md`、`PROJECT.md`、私有 Skill
- 必需章节、路径或登记缺失时报告，不补造规则

## 任务与授权

- 任务深度、文档、编号和批准以 `PROJECT.md#项目工作流参数` 为准
- 查询和 `zero` 不创建任务文档；`zero` 只用于不改变行为的单点机械修改
- 其他行为改动至少使用 `fast`，执行前创建登记的 Light 任务文档
- 公共契约、数据、权限、生成链路或高风险任务建议 Heavy
- 非 Goal 模式按项目门禁取得执行授权
- Goal 模式只授权既定目标、范围和安全边界；Agent 可选择 Light 深度
- Goal 模式不启动 Heavy 或 `grilling`
- 高风险操作仍按上级规则确认
- 范围外问题写入登记的候选入口，不顺手修复
- 跨项目任务转到双向登记的共同父目录；入口缺失或越界时停止

### Spec 真相源

- 每个任务只有一份活跃 spec 或 micro-spec
- Light 升级 Heavy 时沿用 `task_id`，登记替代关系并停止更新旧文档
- 模板、路径、命名、语言和 footer 使用 `PROJECT.md` 登记值
- 单项目默认不拆 Spec；仅在独立执行单元妨碍阅读或恢复时拆分
- 跨项目本地写入、项目验证或独立交付物必须建立本地任务
- 纯只读参与可免本地任务，由父 Spec 记录原因
- 恢复跨项目任务时先读父 Spec，再读本地任务

## 外部 Skill 路由

主机或用户触发 Skill；本表只定义项目级覆盖。

| 能力                      | 使用条件                         | 项目级覆盖                                                             |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `sdd-riper-one-light`     | 低风险单项目任务                 | `zero` 不落盘；其他深度使用登记的 Light 模板；Goal 批准来源记为 `Goal` |
| `sdd-riper-one`           | 用户明确调用的非 Goal Heavy 任务 | 使用登记的 Heavy 模板；Execute 前记录 `Plan Approved`                  |
| `grilling`                | 非 Goal 且关键边界无法核实       | 结论写入活跃任务文档，不授权实施                                       |
| `diagnosing-bugs` / `tdd` | 按 Skill 触发                    | 复用活跃任务文档和既有批准                                             |

- Skill 的必填语义、阶段和门禁以当前 Skill 为准
- Skill 不得扩大范围、授权或创建平行真相源
- Skill 缺失或不可读时报告，不自创替代流程
- 未列出的 Skill 按主机、上级规则或用户要求触发

### 本项目外部能力补充

| 能力            | 使用条件                                          | 项目级约束                                                                    |
| --------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `prototype`     | 用户明确要求验证 Paseo 的逻辑、状态模型或 UI 方案 | 只建立本地 throwaway 证据；远程写入、分支、commit 或 issue 仍服从项目授权边界 |
| `skill-creator` | 用户要求创建或修改 Paseo 的 Skill                 | 只处理当前授权范围；项目私有 Skill 的登记仍以 `PROJECT.md` 为准               |
| `darwin-skill`  | 用户明确要求对 Skill 评分或优化                   | 执行其评测流程，不作为 Skill 创建后的默认步骤                                 |

## 完成

- 按风险执行最窄有效验证
- 只把稳定、复用且已验证的项目事实写入 `PROJECT.md`
- 修改规则、Skill、任务模板或长期资料时遵守项目门禁

- Write a sentence to land a point. "It's not X, it's Y", "That's not a Z, that's a W", and every other setup-and-punchline shape.
- Add a clause that only asserts importance: "and that matters", "which is what keeps it working", "this is critical".
- Use "honest", "robust", "seamless", "powerful", "simply", "just", "delightful".
- Restate something you already said, in different words, for emphasis.
- Hedge with "generally", "typically", or "you may want to" when the answer is "do this".
- Clear your throat: "It's worth noting that", "In order to", "This section covers".

## Quick start

```bash
npm run dev                          # Start the dev daemon
npm run dev:app                      # Start Expo against the dev daemon
npm run dev:desktop                  # Start Electron desktop dev
npm run cli -- ls -a -g              # List all agents
npm run cli -- daemon status         # Check daemon status
npm run typecheck                    # Always run after changes
npm run lint                         # Always run after changes
npm run format                       # Auto-format with Biome
npm run format:check                 # Check formatting without writing
```

Repo dev commands use checkout-local state by default. In this checkout, `PASEO_HOME` resolves to `.dev/paseo-home`, and `npm run cli -- ...` targets that same dev home automatically. The packaged desktop app and production-style daemon keep using `~/.paseo` on port `6767`.

See [docs/development.md](docs/development.md) for full setup, build sync requirements, and debugging.

## Release branches

When the user says "this goes to next", create or
retarget the PR to `next` and preserve that destination through delivery. Follow
[release branch discipline](docs/release.md#release-branch-discipline) for creating
and updating `next`, integrating it after a release, and releasing a hotfix from a tag.

## Critical rules

- **NEVER restart the main Paseo daemon on port 6767 without permission** — it manages all running agents. If you're an agent, restarting it kills your own process.
- **NEVER assume a timeout means the service needs restarting** — timeouts can be transient.
- **NEVER add auth checks to tests** — agent providers handle their own auth.
- **Before changing app routes, startup routing, remembered workspace restore, or active workspace selection, read [docs/expo-router.md](docs/expo-router.md).**
- **NEVER run the full test suite locally.** The test suites are heavy and will freeze the machine, especially if multiple agents run them in parallel. Rules:
  - Run only the specific test file you changed: `npx vitest run <file> --bail=1`
  - Never run `npm run test` for an entire workspace unless explicitly asked.
  - If you must run a broad suite, pipe output to a file and read it afterward: `npx vitest run <file> --bail=1 > /tmp/test-output.txt 2>&1` then read the file.
  - Never re-run a test suite that another agent already ran and reported green — trust the result.
  - For full suite verification, push to CI and check GitHub Actions instead.
- **Always run typecheck and lint after every change.**
- **Build workspace packages before diagnosing cross-package type errors.** This repo consumes generated declarations across workspaces. If typecheck fails in a package that depends on another workspace, rebuild the owning stack first so `dist` declarations are current:
  - `npm run build:client` — rebuild protocol and client declarations.
  - `npm run build:server` — rebuild highlight, relay, protocol, client, server, and CLI when server/CLI types may be stale.
  - Do not patch inferred callback parameters or add local duplicate types just to silence stale declaration errors.
- **Run `npm run format` before committing.** This repo uses Biome for formatting. Do not manually fix formatting — let the formatter handle it.
- **Always use npm scripts for linting and formatting.** Do not run tools directly with `npx eslint`, `npx oxfmt`, `npx oxlint`, or package-local binaries. For targeted checks, pass file paths through the npm script:
  - `npm run lint -- packages/app/src/components/message.tsx`
  - `npm run format:files -- CLAUDE.md packages/app/src/components/message.tsx`
- **The protocol stays backward-compatible. Features don't have to.** Read [docs/protocol-compatibility.md](docs/protocol-compatibility.md) before touching `packages/protocol`. The short version:
  - **Protocol contract (always):** an old client parses messages from a new daemon, and a new daemon parses messages from an old client. New fields are optional; never narrow, never remove, never require. Wire schemas stay pure — no `.transform()`, `.catch()`, or `.preprocess()`.
  - **Feature contract (per-feature):** gate the capability once on `server_info.features.*`, then run the feature or tell the user to update the host. No fallback paths, no defensive branches.
  - **Every shim is tagged.** `// COMPAT(name): added in vX, remove after <date>` at the site that has to be deleted. `rg "COMPAT\("` is the cleanup backlog; untagged back-compat is permanent by accident.
  - **New RPCs use dotted namespaces with direction suffixes.** Follow [docs/rpc-namespacing.md](docs/rpc-namespacing.md): `domain.provider.operation.request` pairs with `domain.provider.operation.response`. Existing flat RPC names will migrate over time; don't add new ones.

## Platform gating

The app runs on iOS, Android, web (browser), and web (Electron desktop). Code is cross-platform by default. Gate only when you must. Import gates from `@/constants/platform`.

### The four gates

| Gate                       | Type      | When to use                                                                                                                 |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`. This is the **exception**, not the default. |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera/scanner, `expo-av`.                              |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag region, daemon management, app updates, dock badges.                 |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen, single-panel vs split. From `@/constants/layout`.       |

### Decision matrix

| I need to...                                                   | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access DOM (`document`, `window`, `<div>`, `addEventListener`) | `if (isWeb)`                                                              |
| Use a native-only API (Haptics, push tokens, camera)           | `if (isNative)`                                                           |
| Use an Electron bridge (file dialog, titlebar, updates)        | `if (getIsElectron())`                                                    |
| Switch layout between phone and tablet/desktop                 | `useIsCompactFormFactor()`                                                |
| Show something on hover, always-visible on native              | `isHovered \|\| isNative \|\| isCompact` (hover only works on web)        |
| Gate to iOS or Android specifically                            | `Platform.OS === "ios"` / `Platform.OS === "android"` (rare, keep inline) |

### Rules

- **Default is cross-platform.** Don't gate unless you have a specific reason.
- **Prefer Metro file extensions over `if` statements.** When a module has fundamentally different implementations per platform, use `.web.ts` / `.native.ts` file extensions instead of runtime `if (isWeb)` branches. Metro resolves the correct file at build time — the unused platform code is never bundled. Reserve `if (isWeb)` for small, inline checks (a single line or a few props). If you find yourself writing a large `if (isWeb) { ... } else { ... }` block, split into separate files instead.
  ```
  hooks/
    use-audio-recorder.web.ts    ← uses Web Audio API
    use-audio-recorder.native.ts ← uses expo-audio
  ```
  Import as `@/hooks/use-audio-recorder` — Metro picks the right file automatically.
- **Use `.electron.ts` / `.electron.tsx` for Electron-only web modules.** Electron is still the Metro `web` platform, but desktop dev/build sets `PASEO_WEB_PLATFORM=electron`, so Metro first looks for `.electron.*` files and falls back to normal `.web.*` files. Use this when the implementation depends on Electron-only behavior such as `webviewTag`, desktop preload APIs, or the Electron bridge. Keep plain browser web in `.web.*`, and keep native fallbacks in the base file or `.native.*`.
  ```
  desktop/browser/pane/
    index.electron.tsx ← Electron <webview> implementation
    index.web.tsx      ← plain web fallback
    index.tsx          ← native fallback
  ```
  Import as `@/desktop/browser/pane` — Electron desktop gets the `.electron.tsx` file, browser web gets `.web.tsx`, and native gets the native/base implementation.
- **NEVER use raw DOM APIs without `isWeb` guard.** DOM APIs crash native. Casting a RN ref to `HTMLElement` is a red flag — ensure the block is web-only.
- **NEVER use `onPointerEnter`/`onPointerLeave`.** They don't fire on native iOS.
- **Hover only works on web.** React Native's `onHoverIn`/`onHoverOut` on `Pressable` does NOT fire on native iOS/iPad — the underlying W3C pointer events are behind disabled experimental flags. For hover-to-show UI (kebab menus, action buttons), use `isHovered || isNative || isCompact` so the controls are always visible on native and hover-to-show on web.
- **Don't use Platform.OS as a proxy for layout capabilities.** Use breakpoints for layout decisions, not platform checks.
- **Import `isWeb`/`isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.

## Debugging

Find the complete daemon logs and traces in the $PASEO_HOME/daemon.log
