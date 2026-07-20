# Workspace、Worktree 与归档恢复 CodeMap (feature)

> Depth-first route across registry identity, filesystem placement, archive teardown and explicit recovery.

## 1. Orientation

- Goal: 定位 Workspace/Worktree 从创建或打开，到 registry 持久化、归档 teardown、owned worktree 删除和显式恢复的完整链路。
- Scope: Project/Workspace identity、directory/worktree provisioning、create/open RPC、archive scope、agent/terminal teardown、shared worktree reference、recovery inspect/restore。
- Non-Scope: 日常 checkout diff/status、PR 操作、workspace tabs/layout、setup script 具体命令、Project 删除生命周期。
- Primary question: “一个 workspace 的身份和磁盘位置由谁决定，归档时能删什么，恢复时凭什么重建？”
- Confidence:
  - confirmed: create/open/archive/recovery 路由、registry schema、worktree ownership、关键失败分支和测试入口已由源码复核。
  - inferred: archive 中部分 teardown failure 的最终人工处置取决于当时 registry、Git 和磁盘状态。
  - unknown: legacy records 缺少 `mainRepoRoot/worktreeRoot` 时的 compatibility fallback 将在目标日期移除；届时历史数据 floor 需重新确认。

## 2. Context Tree

```text
Node: Workspace / Worktree Lifecycle
  -> Node: Entry
  -> Node: Main Flow
  -> Node: Branches
  -> Node: Data And Dependencies
  -> Node: Effects
  -> Node: Related Capabilities
  -> Node: Risk And Unknowns
  -> Node: Validation
```

### Node: Workspace / Worktree Lifecycle

- Type: `capability`
- Status: `confirmed`
- Purpose: 为 same-`cwd` identity、worktree placement、归档数据安全和恢复失败提供最短源码路径。
- Read First:
  - [`docs/data-model.md`](../../docs/data-model.md) :: Project Registry / Workspace Registry。
  - [`workspace-provisioning-service.ts`](../../packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts) :: create/find/unarchive ownership。
  - [`workspace-archive-service.ts`](../../packages/server/src/server/workspace-archive-service.ts) :: `archiveByScope`。
  - [`workspace-recovery-service.ts`](../../packages/server/src/server/session/workspace-recovery/workspace-recovery-service.ts) :: `inspect` / `restore`。
- Edges / Children:
  - `Entry`: App/CLI/client RPC and Agent create workspace resolution。
  - `Main Flow`: request -> provisioning/registry -> archive teardown -> recovery plan/recreate。
  - `Branches`: directory/worktree、explicit project、shared backing、missing paths、capability/legacy。
  - `Data And Dependencies`: Project/Workspace records、Git、filesystem、agents/terminals。
  - `Effects`: registry updates、workspace events、process teardown、optional disk delete/recreate。
- Evidence: service implementations, schemas and focused tests below。
- Unknowns: out-of-band filesystem mutation can make persisted placement stale until reconciliation/inspect。
- Next Drill-Down: identity bugs start at registry/provisioning；data-loss risk starts at archive target and backing reference resolution。

### Node: Entry

- Type: `entry`
- Status: `confirmed`
- Purpose: 区分 create、open、archive 和 recovery 的 user intent；它们不是同一个 mutation。
- Read First:
  - App create: [`new-workspace-screen.tsx`](../../packages/app/src/screens/new-workspace-screen.tsx) :: `createMultiplicityWorkspace`。
  - CLI create/archive: [`workspace/create.ts`](../../packages/cli/src/commands/workspace/create.ts) :: `runCreateCommand`; [`workspace/archive.ts`](../../packages/cli/src/commands/workspace/archive.ts) :: `runArchiveCommand`。
  - App archive: [`workspace-archive.ts`](../../packages/app/src/workspace/workspace-archive.ts) :: `archiveWorkspaceOptimistically`。
  - App recovery: [`use-workspace-recovery.ts`](../../packages/app/src/workspace-recovery/use-workspace-recovery.ts) :: `useWorkspaceRecovery`。
  - Client RPC: [`daemon-client.ts`](../../packages/client/src/daemon-client.ts) :: `openProject`, `createWorkspace`, `archiveWorkspace`, `inspectWorkspaceRecovery`, `restoreWorkspace`。
  - Wire: [`messages.ts`](../../packages/protocol/src/messages.ts) :: workspace create/archive/recovery schemas。
- Edges / Children:
  - `workspace.create.request` calls create flow for `source.kind=directory|worktree`。
  - legacy/direct `open_project_request` calls find-or-create for an existing directory。
  - `archive_workspace_request` calls archive-by-record scope。
  - `workspace.recovery.inspect/restore.request` calls recovery service；App gates it with `server_info.features.workspaceRecovery`。
  - Agent/CLI run can create or resolve a workspace before agent creation。
- Evidence: call sites and session message switch。
- Unknowns: UI route ownership after recovery is outside service boundary and must be read in workspace screen/navigation code when changed。
- Validation: CLI unit, App archive/model tests, protocol parse tests and service tests。
- Next Drill-Down: identify the exact RPC first; do not treat route navigation or tab removal as archive authority。

### Node: Main Flow

- Type: `flow`
- Status: `confirmed`
- Purpose: 将 identity、placement、teardown 和 recovery 放在一条可验证链上。
- Route:
  1. App/CLI constructs a directory or worktree source and calls [`DaemonClient.createWorkspace`](../../packages/client/src/daemon-client.ts); existing directory open may call `openProject`。
  2. [`messages.ts`](../../packages/protocol/src/messages.ts) validates `workspace.create.request` / `open_project_request`; [`session.ts`](../../packages/server/src/server/session.ts) dispatches to `handleWorkspaceCreateRequest` or `handleOpenProjectRequest`。
  3. Directory create -> `handleWorkspaceCreateLocal` validates path -> `WorkspaceProvisioningService.createWorkspaceForDirectory` resolves/validates Project and persists a fresh Workspace record。
  4. Worktree create -> `handleWorkspaceCreateWorktree` resolves source cwd/project -> Paseo worktree workflow -> `createWorkspaceForWorktree` persists durable placement (`cwd`, `worktreeRoot`, `mainRepoRoot`, branch, ownership)。
  5. Open existing directory -> `findOrCreateWorkspaceForDirectory` selects earliest active equivalent cwd, may unarchive an archived record whose project/path is usable, otherwise creates a new directory workspace。
  6. Session describes the record, emits correlated response and `workspace_update`, then refreshes Git metadata in background。
  7. App/CLI archive -> `DaemonClient.archiveWorkspace` -> [`session.ts`](../../packages/server/src/server/session.ts) :: `handleArchiveWorkspaceRequest` -> [`workspace-archive-service.ts`](../../packages/server/src/server/workspace-archive-service.ts) :: `archiveByScope({ kind: "workspace" })`。
  8. `archiveByScope` resolves exact record/backing, marks archiving, archives live and persisted agents by `workspaceId`, kills workspace terminals, archives the workspace record, then runs teardown commands。
  9. If backing is Paseo-owned and no other active workspace references the same backing directory, delete the worktree; otherwise retain disk content。Project record remains active。
  10. Missing archived workspace route -> App [`useWorkspaceRecovery`](../../packages/app/src/workspace-recovery/use-workspace-recovery.ts) inspects state through capability-gated RPC。
  11. [`workspace-recovery-service.ts`](../../packages/server/src/server/session/workspace-recovery/workspace-recovery-service.ts) builds `unarchive` when `workspace.cwd` still exists, `restore` when an owned worktree can be recreated, or a typed unavailable reason。
  12. Restore action recreates the worktree from persisted source root + branch + placement, validates the mapped exact subdirectory, rolls back failed creation, and only then unarchives registry records。
  13. [`session.ts`](../../packages/server/src/server/session.ts) :: `restoreWorkspaceAndEmit` publishes the recovered workspace to active sessions or refreshes external mutation state。
- Key Objects:
  - [`workspace-registry.ts`](../../packages/server/src/server/workspace-registry.ts) :: `PersistedProjectRecord`, `PersistedWorkspaceRecord`, registries。
  - [`workspace-registry-model.ts`](../../packages/server/src/server/workspace-registry-model.ts) :: initial/reconciled placement and opaque id generation。
  - [`worktree-session.ts`](../../packages/server/src/server/worktree-session.ts) and [`paseo-worktree-service.ts`](../../packages/server/src/server/paseo-worktree-service.ts) :: worktree workflow/descriptor boundary。
  - [`utils/worktree.ts`](../../packages/server/src/utils/worktree.ts) :: create/delete/setup/teardown and placement mapping。
- Edges / Children:
  - branches to `Branches` on source kind, project validity, ownership/reference count and recovery state。
  - writes/emits through `Effects`: JSON registries, workspace updates, agent/archive snapshots, filesystem changes。
  - depends on filesystem path equivalence, Git CLI, project/workspace registries, AgentManager, AgentStorage and TerminalManager。
- Evidence: source route and data model invariants。
- Unknowns: filesystem/Git partial failure after record mutation may require manual retry or repair; archive intentionally logs and continues for some steps。
- Validation: provisioning/archive/recovery unit tests plus restart and same-directory e2e。
- Next Drill-Down: creation issues steps 2-6; deletion risk steps 7-9; restore issues steps 10-13。

### Node: Branches

- Type: `branch`
- Status: `confirmed`
- Purpose: 标出会改变 identity、磁盘副作用或 recovery availability 的条件。
- Branches:
  - Directory vs worktree source:
    - Source: `Session.handleWorkspaceCreateRequest`。
    - Condition: `request.source.kind`。
    - Effect: directory records use checkout observation；worktree records persist owned backing placement and branch metadata。
    - Status: `confirmed`
  - Explicit project vs inferred project:
    - Source: `WorkspaceProvisioningService.createWorkspaceForDirectory/resolveSourceProjectForWorktree`。
    - Condition: active `projectId` supplied or source workspace/root lookup required。
    - Effect: stable membership; unknown/archived explicit projects reject instead of silently rehoming。
    - Status: `confirmed`
  - Existing active/archived/no workspace:
    - Source: `findOrCreateWorkspaceForDirectory`。
    - Condition: lexically/realpath-aware equivalent `cwd` records。
    - Effect: earliest active reuse；eligible archived unarchive；otherwise fresh opaque workspace。
    - Status: `confirmed`
  - Worktree action:
    - Source: CLI `buildWorkspaceSource`, session worktree handler and worktree workflow。
    - Condition: branch-off、checkout branch、checkout change request/PR。
    - Effect: different Git source/ref validation but same persisted placement contract。
    - Status: `confirmed`
  - Archive record vs path compatibility scope:
    - Source: `archiveByScope`, `resolveWorkspaceIdAtPath`。
    - Condition: modern workspace id or legacy worktree target path。
    - Effect: exact record vs all records sharing resolved backing path。
    - Status: `confirmed`
  - Shared backing directory:
    - Source: `maybeRemoveDirectory` / `isDirectoryUnreferenced`。
    - Condition: another active workspace resolves to the same backing directory。
    - Effect: target record archives but disk worktree is retained。
    - Status: `confirmed`
  - Non-owned directory/worktree:
    - Source: `resolveWorkspaceBackingDirectory` and `isPaseoOwnedWorktreeCwd`。
    - Condition: placement not marked/proven Paseo-owned。
    - Effect: never delete backing directory。
    - Status: `confirmed`
  - Partial teardown failure:
    - Source: archive service `Promise.allSettled` and warnings。
    - Condition: agent archive, terminal kill, setup teardown or worktree delete fails。
    - Effect: continue where designed；workspace may already be archived while disk removal failed。
    - Status: `confirmed`
  - Recovery unarchive:
    - Source: `WorkspaceRecoveryService.resolveRecovery`。
    - Condition: archived record and exact `workspace.cwd` still exists。
    - Effect: no Git recreation；unarchive workspace/project and reconcile placement。
    - Status: `confirmed`
  - Recovery restore:
    - Source: same service。
    - Condition: missing cwd, `kind=worktree`, recorded branch and available `mainRepoRoot`/compat project root。
    - Effect: recreate worktree, map relative subdirectory, validate, then unarchive。
    - Status: `confirmed`
  - Recovery unavailable:
    - Source: `WorkspaceRecoveryState` union。
    - Condition: missing record/project/source/directory/branch or workspace not archived。
    - Effect: typed reason and no registry mutation。
    - Status: `confirmed`
  - Capability/legacy client:
    - Source: `server_info.features.workspaceRecovery`, Session legacy refresh shim。
    - Condition: new capability vs client older than v0.1.105。
    - Effect: new clients use explicit inspect/restore；legacy refresh may restore owning workspace until compatibility removal。
    - Status: `confirmed`
- Evidence: services, protocol flags and compatibility comments。
- Unknowns: behavior after compatibility cleanup must be remapped when daemon/client floor changes。
- Validation: branch-specific tests in Validation node。
- Next Drill-Down: for any delete/restore task, prove ownership and active references before touching Git/filesystem code。

### Node: Data And Dependencies

- Type: `dependency`
- Status: `confirmed`
- Purpose: 固定 identity 与 placement 语义，避免从目录名重新推断持久事实。
- Read First:
  - Project registry: `$PASEO_HOME/projects/projects.json`, schema in [`workspace-registry.ts`](../../packages/server/src/server/workspace-registry.ts)。
  - Workspace registry: `$PASEO_HOME/projects/workspaces.json`, model in [`workspace-registry-model.ts`](../../packages/server/src/server/workspace-registry-model.ts)。
  - Git/filesystem: worktree utilities, path equivalence helpers, `WorkspaceGitService`。
  - Owned runtime: AgentManager/AgentStorage records and TerminalManager sessions scoped by `workspaceId`。
- Critical invariants:
  - `workspaceId`: opaque stable identity，never a path。
  - `projectId`: stable membership，not derived from current cwd containment。
  - `cwd`: exact agent/file/script execution directory。
  - `worktreeRoot`: backing checkout root；may differ from `cwd` for a selected subproject。
  - `mainRepoRoot`: source repository used for worktree restoration。
  - `isPaseoOwnedWorktree`: authority to remove/recreate backing; kind alone is insufficient。
  - Workspace archive and Agent archive: separate lifecycles even when workspace archive tears agents down。
- Edges / Children:
  - provisioning writes registry placement。
  - archive consumes placement and live ownership, then writes archive timestamps and optional filesystem deletion。
  - recovery consumes persisted placement and Git state, then unarchives only after validation。
  - reconciliation may refresh mutable checkout facts but not identity/membership/exact placement fields。
- Evidence: [`docs/data-model.md`](../../docs/data-model.md) and service code。
- Unknowns: legacy records may rely on compatibility discovery until cleanup dates。
- Validation: registry-model, bootstrap, reconciliation and restart tests。
- Next Drill-Down: schema changes start at registry model + protocol projection + compatibility tests, not UI descriptor types。

### Node: Effects

- Type: `effect`
- Status: `confirmed`
- Purpose: 明确哪些动作只改展示，哪些会改 registry、process 和 disk。
- Effects:
  - Create/open: Project/Workspace JSON upsert, descriptor response, `workspace_update`, Git observer/snapshot refresh。
  - App archive: optimistic local hide first；RPC failure restores cached descriptor。
  - Server archive: mark archiving, archive owned agents/snapshots, kill terminals, set workspace `archivedAt`, emit updates。
  - Disk delete: only Paseo-owned backing with no remaining active reference；teardown/delete failure leaves archived record and logs warning。
  - Recovery inspect: read-only typed state。
  - Recovery restore: optional `git worktree` recreation, exact subdirectory validation, registry/project unarchive, active-session update。
  - Project lifecycle: archiving final workspace does not archive parent Project record。
  - User-visible: workspace disappears globally after archive and returns only through explicit open/unarchive/restore behavior supported by host。
- Evidence: App optimistic archive, Session responses, archive/recovery services。
- Unknowns: clients disconnected during mutation converge through later snapshot/update flow, not traced in depth here。
- Validation: App optimistic tests, Session e2e, restart recovery e2e。
- Next Drill-Down: distinguish API acceptance from successful disk removal; response includes archive result fields but warnings may indicate retained disk state。

### Node: Related Capabilities

- Type: `capability`
- Status: `confirmed`
- Purpose: 显示共享 workspace identity 的相邻模块。
- Relations:
  - upstream: project add/clone/create-directory、new workspace picker、Agent create intent。
  - downstream: agents、terminals、files、scripts、Git/forge status、workspace activity/navigation。
  - shared model: protocol `WorkspaceDescriptorPayload`, Project/Workspace registries, App session store。
  - shared config: `$PASEO_HOME`, worktrees root, workspace setup/teardown commands, `workspaceRecovery` capability flag。
  - companion map: [`Agent 创建、执行与 Timeline 同步`](2026-07-20_01-47_Agent创建执行与Timeline同步功能.md)。
- Evidence: workspaceId call sites, data model and session services。
- Unknowns: UI tab/layout cleanup and Project removal are separate flows。
- Next Drill-Down: use companion map only when agent creation/auto-archive is part of workspace lifecycle。

### Node: Risk And Unknowns

- Type: `risk`
- Status: `confirmed`
- Purpose: 阻止 identity 混用和不可逆 filesystem 操作。
- Risks:
  - Treating `workspaceId` as a path corrupts routing/ownership。Verify: opaque ID and same-cwd tests。
  - Using `cwd` as ownership clumps sibling workspaces and archives wrong agents/terminals。Verify: record-scoped and same-cwd isolation tests。
  - Deleting `cwd` instead of `worktreeRoot` can delete only a subproject or wrong checkout。Verify: placement model and exact-subdirectory restore e2e。
  - Deleting before final active reference is gone can break sibling workspaces。Verify: archive service shared-reference tests。
  - Unarchiving before recreation/validation can expose a missing workspace。Verify: recovery rollback and missing-subdirectory tests。
  - Ordinary missing directories are not reconstructible; only sufficiently described worktrees can restore。Verify: recovery unavailable reasons。
  - Archive is best-effort for several teardown steps; registry and disk may intentionally diverge after a failed delete。Verify: warning/result assertions and manual Git worktree inspection。
  - Compatibility fallbacks for missing placement fields have dated removal comments。Verify: `rg "COMPAT\\("` before changing historical behavior。
- Unknowns:
  - Manual Git mutation between inspect and restore can race the recovery plan; creation errors remain authoritative。
  - Operational repair procedure for a partially archived-but-not-deleted worktree is not mapped here。
- Next Drill-Down: for data-loss-sensitive changes, read archive/recovery tests and `utils/worktree.ts` before planning edits。

### Node: Validation

- Type: `validation`
- Status: `confirmed`
- Purpose: 证明 registry identity、disk ownership 和 restart behavior，而不运行全套。
- Validation Entry:
  - Provisioning: [`workspace-provisioning-service.test.ts`](../../packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.test.ts)。
  - Registry/model/bootstrap: [`workspace-registry.test.ts`](../../packages/server/src/server/workspace-registry.test.ts)、[`workspace-registry-model.test.ts`](../../packages/server/src/server/workspace-registry-model.test.ts)、[`workspace-registry-bootstrap.test.ts`](../../packages/server/src/server/workspace-registry-bootstrap.test.ts)。
  - Create worktree/error: [`workspace-create-worktree-source.e2e.test.ts`](../../packages/server/src/server/workspace-create-worktree-source.e2e.test.ts)、[`workspace-create-errors.e2e.test.ts`](../../packages/server/src/server/workspace-create-errors.e2e.test.ts)。
  - Archive: [`workspace-archive-service.test.ts`](../../packages/server/src/server/workspace-archive-service.test.ts)、[`workspace-archive-record-scoped.e2e.test.ts`](../../packages/server/src/server/workspace-archive-record-scoped.e2e.test.ts)。
  - Recovery: [`workspace-recovery-service.test.ts`](../../packages/server/src/server/session/workspace-recovery/workspace-recovery-service.test.ts)、[`model.test.ts`](../../packages/app/src/workspace-recovery/model.test.ts)。
  - Protocol/CLI: [`messages.workspaces.test.ts`](../../packages/protocol/src/messages.workspaces.test.ts)、[`messages.workspace-recovery.test.ts`](../../packages/protocol/src/messages.workspace-recovery.test.ts)、[`workspace/create.test.ts`](../../packages/cli/src/commands/workspace/create.test.ts)、[`worktree/archive.test.ts`](../../packages/cli/src/commands/worktree/archive.test.ts)。
  - App e2e: [`worktree-archive.spec.ts`](../../packages/app/e2e/worktree-archive.spec.ts)、[`worktree-restore.spec.ts`](../../packages/app/e2e/worktree-restore.spec.ts)、[`worktree-restore-after-restart.spec.ts`](../../packages/app/e2e/worktree-restore-after-restart.spec.ts)、[`same-directory-workspaces.spec.ts`](../../packages/app/e2e/same-directory-workspaces.spec.ts)。
  - Local command: `npx vitest run <one-listed-test-file> --bail=1`; e2e 按单个 spec 的项目命令运行。
  - Manual check when disk semantics change: inspect registry JSON, `git worktree list`, exact `cwd` and backing `worktreeRoot`; use checkout-local dev home only。
- Edges / Children:
  - proves: record allocation/reuse、ownership-scoped archive、shared backing retention、restore/restart behavior。
  - does not prove: arbitrary external Git corruption or every OS filesystem edge without the matching platform test。
- Evidence: listed tests exist and name the mapped invariants。
- Unknowns: Windows/POSIX worktree semantics may require their platform-specific test variant。
- Next Drill-Down: choose the smallest service test plus one e2e only when disk/restart behavior changes。

## 3. Compact Indexes

### Entry Point Index

| Entry           | Path                                                            | Handler / Function                              | Status    | Notes                            |
| --------------- | --------------------------------------------------------------- | ----------------------------------------------- | --------- | -------------------------------- |
| App create      | `packages/app/src/screens/new-workspace-screen.tsx`             | `createMultiplicityWorkspace`                   | confirmed | directory or worktree source     |
| CLI create      | `packages/cli/src/commands/workspace/create.ts`                 | `runCreateCommand`                              | confirmed | validates isolation/options      |
| Direct open     | `packages/client/src/daemon-client.ts`                          | `openProject`                                   | confirmed | existing directory only          |
| App/CLI archive | App workspace archive / CLI archive                             | `archiveWorkspace`                              | confirmed | opaque workspace id              |
| App recovery    | `packages/app/src/workspace-recovery/use-workspace-recovery.ts` | `useWorkspaceRecovery`                          | confirmed | capability-gated inspect/restore |
| Daemon          | `packages/server/src/server/session.ts`                         | workspace create/open/archive/recovery handlers | confirmed | correlated RPC boundary          |

### Key Object Index

| Object                         | Path                                  | Kind     | Responsibility                                | Used By                         |
| ------------------------------ | ------------------------------------- | -------- | --------------------------------------------- | ------------------------------- |
| `PersistedProjectRecord`       | `server/workspace-registry.ts`        | model    | stable selected-root membership               | provisioning/session            |
| `PersistedWorkspaceRecord`     | `server/workspace-registry.ts`        | model    | opaque identity + durable placement           | all workspace services          |
| `WorkspaceProvisioningService` | `session/workspace-provisioning/...`  | service  | create/find/unarchive registry records        | open/create/import/agent create |
| `archiveByScope`               | `server/workspace-archive-service.ts` | function | teardown, archive, reference-safe deletion    | Session/compat path             |
| `WorkspaceRecoveryService`     | `session/workspace-recovery/...`      | service  | inspect, recreate, validate, unarchive        | Session/App                     |
| Worktree utilities             | `server/utils/worktree.ts`            | module   | Git worktree operations and placement mapping | create/archive/recovery         |

### Branch Index

| Branch                        | Source                   | Condition                          | Effect                             | Status    |
| ----------------------------- | ------------------------ | ---------------------------------- | ---------------------------------- | --------- |
| Directory/worktree            | Session create handler   | source kind                        | placement strategy                 | confirmed |
| Active/archived/new           | provisioning service     | equivalent cwd records             | reuse/unarchive/create             | confirmed |
| Shared backing                | archive service          | remaining active reference         | retain disk                        | confirmed |
| Owned backing                 | archive service          | `isPaseoOwnedWorktree` + placement | allow delete                       | confirmed |
| Unarchive/restore/unavailable | recovery service         | path/branch/source state           | registry-only/recreate/no mutation | confirmed |
| New/legacy client             | capability + COMPAT shim | client version/feature             | explicit RPC/refresh shim          | confirmed |

### Quick File Index

- [`docs/data-model.md`](../../docs/data-model.md): identity and placement contract。
- [`packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts`](../../packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts): record creation/reuse。
- [`packages/server/src/server/workspace-archive-service.ts`](../../packages/server/src/server/workspace-archive-service.ts): scoped teardown and safe deletion。
- [`packages/server/src/server/session/workspace-recovery/workspace-recovery-service.ts`](../../packages/server/src/server/session/workspace-recovery/workspace-recovery-service.ts): recovery plan and rollback。
- [`packages/server/src/server/workspace-registry.ts`](../../packages/server/src/server/workspace-registry.ts): persistent records。
- [`packages/server/src/utils/worktree.ts`](../../packages/server/src/utils/worktree.ts): filesystem/Git side effects。

## 4. Next Drill-Down

- For implementation: start with registry invariant, then one provisioning/archive/recovery service and its adjacent test。
- For risk review: prove opaque identity, backing ownership, active references and recovery mutation ordering。
- For debugging: capture `workspaceId`, `projectId`, `cwd`, `worktreeRoot`, `mainRepoRoot`, `branch`, `archivedAt` and current `git worktree list`。
- For historical/compatibility confirmation: inspect `COMPAT(workspaceCreateMissingProjectId)`, `COMPAT(archiveMissingWorkspacePlacement)`, `COMPAT(worktreeRestore*)` and client floor before deletion。
- Drift check date: `2026-07-20`; index: [`.skills/project/CODEMAP_INDEX.md`](../../.skills/project/CODEMAP_INDEX.md)。
