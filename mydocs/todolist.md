# Paseo Reforged 任务待办总表

## 编号索引

- 当前编号基线：`0077`
- 下一个建议编号：`0078`
- 最后更新：`2026-08-17`
- 迁移说明：既有 `0001` 至 `0014` 任务已于 2026-08-02 合并迁移至 `mydocs/specs/`，旧 `mydocs/tasks/` 目录已删除；这些编号继续占用。

## 用途

本文件是本项目新工作流的任务登记总表，用来记录正式任务的编号、状态和任务文档。新建或规划任务前先读本文件；尚未形成可验收任务的内容先放入“候选待办”。

## 使用规则

- 新任务先核对“编号索引”“任务汇总”以及 `mydocs/specs/`、`mydocs/micro_specs/` 中已占用编号，取大于当前基线的最小未占用四位编号。
- 分配正式编号后先写入“任务汇总”，再立即从已登记模板创建 Spec 或 micro-spec；创建失败时保留 `未落盘` 状态并说明原因。
- Heavy / Light 模板固定为 `mydocs/templates/SPEC.template.md` 和 `mydocs/templates/MICRO_SPEC.template.md`；任务实例只放 `mydocs/specs/` 与 `mydocs/micro_specs/`。
- 候选待办不占编号；推进时分配编号、创建或关联任务文档并写入“任务汇总”。
- 执行前确认编号索引、任务汇总、正文 `task_id`、文档类型和落盘/同步状态一致；冲突时暂停并按 `PROJECT.md#项目工作流参数` 处理。
- Light `zero`、查询和纯机械非行为修改不创建任务文档，也不进入正式任务汇总。
- 调研或 codemap 发现的非当前范围问题写入“候选待办”，不顺手扩大任务范围。
- 任务状态、落盘/同步状态、验证摘要或阻塞原因变化后同步本表；与任务文档冲突时以任务文档为准，再回写本表。
- Light 升级 Heavy 时沿用同一 `task_id`，旧 micro-spec 标为 `Superseded`；总表只索引 Heavy 为活跃文档。
- 跨项目任务只有创建本地子 Spec 或 micro-spec 时才使用本地编号；共同父级规则与共享 Spec 是跨项目真相源。

## 历史任务迁移索引

以下任务已从旧多文件任务包迁移为当前单文件 Spec。状态以迁移后 Spec 为准，历史原文保存在各 Spec 第 10 章。

| 编号 | 状态   | 文档类型 | 任务名                                                                                  | 迁移日期   | 备注                         |
| ---- | ------ | -------- | --------------------------------------------------------------------------------------- | ---------- | ---------------------------- |
| 0001 | 已收口 | spec     | [重命名与发布迁移](specs/0001_重命名与发布迁移.md)                                      | 2026-08-02 | 历史授权已消耗               |
| 0002 | 暂停   | spec     | [fork 改进与主线覆盖总控](specs/0002_fork改进与主线覆盖总控.md)                         | 2026-08-02 | 旧研究基线，不再作为执行入口 |
| 0003 | 已收口 | spec     | [更新 Universal Agents Kit](specs/0003_更新Universal_Agents_Kit.md)                     | 2026-08-02 | Kit 升级记录                 |
| 0004 | 暂停   | spec     | [修复 Playwright 基线失败](specs/0004_修复Playwright基线失败.md)                        | 2026-08-02 | 用户暂停，不重建旧 WIP       |
| 0005 | 已收口 | spec     | [导入会话标题传递](specs/0005_导入会话标题传递.md)                                      | 2026-08-02 | 提交 `084dca00b`             |
| 0006 | 已收口 | spec     | [主工作区对齐与发布副本收口](specs/0006_主工作区对齐与发布副本收口.md)                  | 2026-08-02 | 本地 Git 操作记录            |
| 0007 | 已收口 | spec     | [会话重试状态](specs/0007_会话重试状态.md)                                              | 2026-08-02 | 提交 `ae4af3dc1`             |
| 0008 | 已收口 | spec     | [新 Workspace 页导入会话入口](specs/0008_新Workspace页导入会话入口.md)                  | 2026-08-02 | 提交 `feb4e82d5`             |
| 0009 | 已收口 | spec     | [工作区字体与字号](specs/0009_工作区字体与字号.md)                                      | 2026-08-02 | 提交 `1a00eddcd`             |
| 0010 | 已收口 | spec     | [同步最新上游代码](specs/0010_同步最新上游代码.md)                                      | 2026-08-02 | 最终修正 `28046d7f4`         |
| 0011 | 已收口 | spec     | [文件链接路径与行号打开兼容](specs/0011_文件链接路径与行号打开兼容.md)                  | 2026-08-02 | 提交 `14f8ed70e`             |
| 0012 | 已收口 | spec     | [推理过程展开设置即时生效](specs/0012_推理过程展开设置即时生效.md)                      | 2026-08-02 | 提交 `432f4fd6e`             |
| 0013 | 已收口 | spec     | [Windows Playwright 运行链路兼容修复](specs/0013_Windows_Playwright运行链路兼容修复.md) | 2026-08-02 | 提交 `7bc87b12c`             |
| 0014 | 已收口 | spec     | [发布新版本](specs/0014_发布新版本.md)                                                  | 2026-08-02 | 发布提交 `4484d62a6`         |

## 状态枚举

| 状态         | 含义                                               |
| ------------ | -------------------------------------------------- |
| `待办`       | 已登记，尚未规划或执行。                           |
| `规划中`     | 正在编写或调整 Spec / micro-spec。                 |
| `待批准`     | 计划或 checkpoint 已完成，等待执行授权。           |
| `执行中`     | 已获批，正在修改。                                 |
| `待验证`     | 修改完成，等待验证或验收。                         |
| `待手工验收` | 自动验证完成，仍需人工或真实环境验收。             |
| `待提交`     | 已验证或收口，尚未提交。                           |
| `已收口`     | 验证和文档回写已完成；如有提交，提交记录也已完成。 |
| `暂停`       | 因依赖、权限、需求或外部阻塞暂停。                 |
| `取消`       | 任务不再继续。                                     |

## 落盘/同步状态枚举

| 落盘/同步状态 | 含义                                   |
| ------------- | -------------------------------------- |
| `未落盘`      | 仅登记在本表，尚无任务文档。           |
| `已落盘`      | 对应 Spec / micro-spec 已创建。        |
| `需同步`      | 任务文档存在，但本表尚未回写最新状态。 |
| `已同步`      | 本表与任务文档已核对一致。             |

## 任务汇总

| 编号 | 状态   | 文档类型   | 落盘/同步状态 | 任务名                                                                                            | 最近更新时间     | 备注                                                                                                                                            |
| ---- | ------ | ---------- | ------------- | ------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0015 | 已收口 | micro-spec | 已同步        | [新 Workspace 导入入口布局](micro_specs/0015_新Workspace导入入口布局.md)                          | 2026-07-30 03:42 | desktop/compact E2E 通过                                                                                                                        |
| 0016 | 已收口 | micro-spec | 已同步        | [Activity Fold 推理过程折叠](micro_specs/0016_推理过程轮次完成自动折叠.md)                        | 2026-07-31 15:25 | 浏览器三层开合、reload 与 final 常驻通过                                                                                                        |
| 0017 | 已收口 | micro-spec | 已同步        | [侧边栏项目与 Workspace 右键菜单](micro_specs/0017_侧边栏项目与Workspace右键菜单.md)              | 2026-07-30 03:42 | 三类右键菜单 E2E 通过                                                                                                                           |
| 0018 | 已收口 | micro-spec | 已同步        | [权限模式选择风险色](micro_specs/0018_权限模式选择风险色.md)                                      | 2026-07-30 03:42 | 映射与运行时颜色验证通过                                                                                                                        |
| 0019 | 已收口 | micro-spec | 已同步        | [会话文字选择操作 Tip](micro_specs/0019_会话文字选择操作Tip.md)                                   | 2026-07-30 17:13 | 三按钮与 preset E2E 通过                                                                                                                        |
| 0020 | 已收口 | micro-spec | 已同步        | [隐藏侧边栏代码改动数量](micro_specs/0020_隐藏侧边栏代码改动数量.md)                              | 2026-07-31 04:42 | 导航统计已移除；聚焦测试/typecheck 通过                                                                                                         |
| 0021 | 已收口 | micro-spec | 已同步        | [Workspace 顶部显示分支名](micro_specs/0021_Workspace顶部显示分支名.md)                           | 2026-07-30 03:42 | 分支优先级单测通过                                                                                                                              |
| 0022 | 已收口 | micro-spec | 已同步        | [统一 Interface 字号](micro_specs/0022_侧边栏与标签标题字号.md)                                   | 2026-08-16 13:16 | 自动化与 Web 验证已完成；用户确认完结并接受 Native smoke 验证例外                                                                               |
| 0023 | 已收口 | micro-spec | 已同步        | [最终回答 Markdown 排版](micro_specs/0023_最终回答Markdown排版.md)                                | 2026-08-16 13:16 | Web 验证已完成；用户确认完结并接受 Android/iOS smoke 验证例外                                                                                   |
| 0024 | 已收口 | micro-spec | 已同步        | [Web 右键菜单连续切换](micro_specs/0024_Web右键菜单连续切换.md)                                   | 2026-07-30 20:18 | 左键不下穿 mutation RED/GREEN 通过                                                                                                              |
| 0025 | 已收口 | micro-spec | 已同步        | [修复 file 链接行号解析与定位高亮](micro_specs/0025_修复file链接行号解析.md)                      | 2026-07-31 04:04 | Markdown Preview/Source RED→GREEN 通过                                                                                                          |
| 0026 | 已收口 | micro-spec | 已同步        | [会话轮次文件变更卡片](micro_specs/0026_会话轮次文件变更卡片.md)                                  | 2026-08-01 23:26 | 投影、Chromium、真实 Web 导航通过；提交 `b6ab2a314`                                                                                             |
| 0027 | 已收口 | micro-spec | 已同步        | [全平台 Mermaid 流程图渲染](micro_specs/0027_全平台Mermaid流程图渲染.md)                          | 2026-07-31 23:39 | 自动验证与用户对正常显示、源码查看、展开预览的人工验收通过                                                                                      |
| 0028 | 已收口 | micro-spec | 已同步        | [轮次变更卡片修饰点击侧分栏](micro_specs/0028_轮次变更卡片修饰点击侧分栏.md)                      | 2026-08-01 23:26 | Ctrl/Cmd side-pane RED/GREEN 通过；提交 `b6ab2a314`                                                                                             |
| 0029 | 已收口 | micro-spec | 已同步        | [更改页差异渲染卡顿修复](micro_specs/0029_更改页差异渲染卡顿修复.md)                              | 2026-08-01 00:18 | 默认折叠、定向单文件、canonical query 与 Electron 性能验证通过                                                                                  |
| 0030 | 已收口 | micro-spec | 已同步        | [Mermaid 展开视图缩放与拖动](micro_specs/0030_Mermaid展开视图缩放与拖动.md)                       | 2026-08-01 20:06 | 自动验证、用户验收与提交 hook 通过；Native 真机风险已接受                                                                                       |
| 0031 | 已收口 | micro-spec | 已同步        | [上游 v0.2.5 差异与冲突复检](micro_specs/0031_上游v0.2.5差异与冲突复检.md)                        | 2026-08-02       | 19 个冲突已解析并通过 Windows 验证；Nix 风险已接受，获准提交                                                                                    |
| 0032 | 已收口 | micro-spec | 已同步        | [发布上游 0.2.5 基线测试版](micro_specs/0032_发布0.2.6-beta.1测试版.md)                           | 2026-08-03       | `v0.2.5-beta.1` 已发布；三条 workflow 全绿，24 个资产已核验                                                                                     |
| 0033 | 已收口 | micro-spec | 已同步        | [后台完成会话的推理过程自动折叠](micro_specs/0033_后台完成会话推理过程自动折叠.md)                | 2026-08-03 18:32 | phased chunk catch-up E2E RED→GREEN；18 单测与静态检查通过                                                                                      |
| 0037 | 已收口 | micro-spec | 已同步        | [解码 Windows 中文文件链接路径](micro_specs/0037_解码Windows中文文件链接路径.md)                  | 2026-08-05 15:45 | 二轮分类保护、真实输入 RED→GREEN、完整链路、typecheck 与 lint 均通过；已授权提交                                                                |
| 0038 | 已收口 | spec       | 已同步        | [跨端会话性能与结论优先加载](specs/0038_跨端会话性能与结论优先加载.md)                            | 2026-08-10       | 七个子项、三轮集成静态审查、受影响单文件、typecheck/lint/format 与长期 docs 已收口；targeted Playwright teardown 超时作为验证例外保留           |
| 0039 | 取消   | spec       | 已同步        | [Windows 性能基线与门禁](specs/0039_Windows性能基线与门禁.md)                                     | 2026-08-09       | 仅恢复规范化取消审计；性能 baseline WIP 已清理，不再是 0038 或子项依赖                                                                          |
| 0040 | 已收口 | spec       | 已同步        | [Activity 折叠渲染与按需物化](specs/0040_Activity折叠渲染与按需物化.md)                           | 2026-08-10       | layout `35/35`、model `12/12`（5000 -> 1 fold）、strategy `13/13`、mock `16/16`；小规模 targeted Playwright 无有效证据，例外已记录              |
| 0041 | 已收口 | spec       | 已同步        | [ReplicaCache 写放大治理](specs/0041_ReplicaCache写放大治理.md)                                   | 2026-08-10       | ReplicaCache `19/19`、lifecycle `2/2`、HostRuntime `69/69`；dirty revision、flush 并发/失败与生命周期合同通过                                   |
| 0042 | 已收口 | spec       | 已同步        | [持久化 Timeline 与结论索引](specs/0042_持久化Timeline与结论索引.md)                              | 2026-08-10       | file `9/9`、memory `4/4`、storage `29/29`、manager `164/164`、session `158/158`（1 skipped）；durable/recovery 合同通过                         |
| 0043 | 已收口 | spec       | 已同步        | [结论优先协议与会话快速路径](specs/0043_结论优先协议与会话快速路径.md)                            | 2026-08-10       | protocol `4/4`、client `113/113` 与 summary/lane/detail/reducer/sync/store/session 定向验证通过                                                 |
| 0044 | 已收口 | spec       | 已同步        | [会话状态隔离与 Windows 渲染驻留](specs/0044_会话状态隔离与Windows渲染驻留.md)                    | 2026-08-10       | retained `2/2`、mounted `6/6`、attributes `3/3`、older gate `6/6`；modified file correctness exception 保留，浏览器 smoke 例外已记录            |
| 0045 | 已收口 | spec       | 已同步        | [会话导入索引与任务化](specs/0045_会话导入索引与任务化.md)                                        | 2026-08-10       | import `27/27`、transaction `13/13` 与 session/workspace/provisioning/archive 集成文件通过；commit/recovery/CAS 收口                            |
| 0046 | 已收口 | spec       | 已同步        | [Host 与 Agent 元数据启动优化](specs/0046_Host与Agent元数据启动优化.md)                           | 2026-08-10       | catalog `29/29`、manager `164/164`、MCP `113/113` 及 loading/archive/chat/workspace/provisioning/worktree 消费面验证通过                        |
| 0047 | 已收口 | micro-spec | 已同步        | [修复 beta.2 发布 CI 旧断言](micro_specs/0047_修复beta2发布CI旧断言.md)                           | 2026-08-04 18:02 | beta.2 已发布；CI 19/19、三条发布 workflow 与 24 个资产已核验；按用户决定保留 ACP pin                                                           |
| 0052 | 已收口 | micro-spec | 已同步        | [弱化侧边栏时间提示](micro_specs/0052_弱化侧边栏时间提示.md)                                      | 2026-08-05 21:28 | 16→13 RED/GREEN、字号边界、desktop/compact 视觉、9/9 组件测试与静态检查通过                                                                     |
| 0054 | 已收口 | micro-spec | 已同步        | [持久化最后消息编辑资格](micro_specs/0054_持久化最后消息编辑资格.md)                              | 2026-08-08 11:43 | 冷启动与 same-session refresh 均已 GREEN；定向回归、静态检查与正式本地提交完成                                                                  |
| 0055 | 已收口 | micro-spec | 已同步        | [合并 upstream 0.3.0-beta.4 到 Reforged](micro_specs/0055_合并upstream_0.3.0-beta.4到Reforged.md) | 2026-08-08       | 94 个冲突及语义重复已解决；beta.4、Reforged identity、Edit fail-closed 与定向门禁通过                                                           |
| 0056 | 已收口 | micro-spec | 已同步        | [审计 upstream 0.3.0 正式版冲突](micro_specs/0056_审计upstream_0.3.0正式版冲突.md)                | 2026-08-08       | stable 全部推荐方案已实施；History 搜索/错误态/响应式布局、Nix hash、CHANGELOG 与定向门禁通过；原位编辑继续 fail-closed                         |
| 0057 | 已收口 | micro-spec | 已同步        | [修复 stable 合并后 Playwright 合同](micro_specs/0057_修复stable合并后Playwright合同.md)          | 2026-08-09       | C01-C10 已由 `c017dcca1` 收口；定向验证、静态检查、main CI 18/18 与 Docker source-build 检查全绿                                                |
| 0058 | 已收口 | micro-spec | 已同步        | [修复 beta.5 Android APK 版本校验合同](micro_specs/0058_修复beta5AndroidAPK版本校验合同.md)       | 2026-08-10 01:35 | 修复提交 `1ef02da58` 与 CI 全绿；immutable tag 重跑成功，beta.5 共 24 个资产且三条发布 workflow 全绿                                            |
| 0059 | 已收口 | micro-spec | 已同步        | [状态分组显示项目名](micro_specs/0059_状态分组显示项目名.md)                                      | 2026-08-10 00:12 | desktop/compact 项目名 RED→GREEN；状态分组回归、5 单测、lint/format 通过；typecheck 仅有既有拖拽 prop 阻塞                                      |
| 0060 | 已收口 | spec       | 已同步        | [合并 upstream v0.3.1 到 Reforged](specs/0060_合并upstream_0.3.1到Reforged.md)                    | 2026-08-13       | 源 merge commit `948fd4a` 已合入本地 `main`；协议/存储/Hub、0059/0061、restart、identity 与静态回归通过，未 push                                |
| 0061 | 已收口 | micro-spec | 已同步        | [恢复最后一条消息编辑入口](micro_specs/0061_恢复最后一条消息编辑入口.md)                          | 2026-08-12       | 独立提交 `f647346fe`；真实 Playwright seam RED→GREEN，完整 Edit UI、模型、server-info、wire 与静态回归通过                                      |
| 0062 | 已收口 | micro-spec | 已同步        | [从当前主分支发布0.3.1测试版](micro_specs/0062_从当前主分支发布0.3.1测试版.md)                    | 2026-08-15       | `v0.3.1-beta.1` 已发布；main/tag、三条发布 workflow、24 个资产与 arm64-only APK 已核验；保留 ACP pins；禁止渠道未成功发布                       |
| 0063 | 已收口 | micro-spec | Review 完成   | [修复标题栏边界拖拽死带](micro_specs/0063_修复标题栏边界拖拽死带.md)                              | 2026-08-14       | 两个真实 Electron 切片均 Red→Green；连续性 gap `1→0`，原生 `y=46..52` 均为 `HTCAPTION`，完整 verifier、typecheck、lint 通过                     |
| 0064 | 已收口 | micro-spec | 已同步        | [工具调用字体与默认折叠](micro_specs/0064_工具调用字体与默认折叠.md)                              | 2026-08-14       | 两个单元 seam RED→GREEN，相关回归 `14/14`、typecheck、全仓 lint、目标 format 通过；按要求未做 e2e                                               |
| 0065 | 已收口 | spec       | Review 完成   | [合并 upstream v0.4.0 到 Reforged](specs/0065_合并upstream_0.4.0到Reforged.md)                    | 2026-08-15 13:12 | 本地 `main` 已快进到双父 merge commit `0aa4e1039`，临时分支/worktree 已清理；66 个冲突与 77 个自动合并文件已处理，验证通过；未 push、tag 或发布 |
| 0066 | 已收口 | micro-spec | 已同步        | [控制启动时恢复上次工作区](micro_specs/0066_控制启动时恢复上次工作区.md)                          | 2026-08-16 13:16 | 自动验证已完成；用户确认完结并接受真实客户端冷启动 smoke 验证例外                                                                               |
| 0067 | 已收口 | micro-spec | Review 完成   | [修复编辑提交的 Provider 消息定位](micro_specs/0067_修复编辑提交的Provider消息定位.md)            | 2026-08-14 17:37 | 独立提交 `f21eba8e9`；distinct-text Playwright 精确 RED→GREEN，完整 Edit `3/3`、server 与 App 回归、静态门禁通过；未 push                       |
| 0068 | 已收口 | micro-spec | 已同步        | [观测 Android 冷构建资源峰值](micro_specs/0068_观测Android冷构建资源峰值.md)                      | 2026-08-16 13:16 | 切片 1 baseline 与切片 2 Gradle cache seed/hit 已完成；用户确认完结，切片 3-4 不再实施                                                          |
| 0069 | 已收口 | micro-spec | 已同步        | [稳定 Android Gradle cache key](micro_specs/0069_稳定Android_Gradle_cache_key.md)                 | 2026-08-15       | tag-ref run `31885791889` exact hit 且 Save skipped；main-ref scope 额外副本已如实记录并保留                                                    |
| 0070 | 已完成 | micro-spec | 已同步        | [修复 Playwright shard 1 红项](micro_specs/0070_修复Playwright_shard_1红项.md)                    | 2026-08-15       | `e1827453f` 已进入 main；精确 CI run `31880050156` 的 shard 1-4 与全部 18 个 job 全绿                                                           |
| 0071 | 已收口 | micro-spec | 已同步        | [发布 0.4.0 beta 测试版](micro_specs/0071_发布0.4.0_beta测试版.md)                                | 2026-08-15       | `v0.4.0-beta.3` 已发布；release CI、三条 workflow、24 个资产和 arm64-only APK 均已核验                                                          |
| 0072 | 已完成 | micro-spec | 已同步        | [修复 upstream 合并后 CI 合同](micro_specs/0072_修复upstream合并后CI合同.md)                      | 2026-08-15       | `fc9c97515` 已进入 main；精确 CI run `31880050156` 全部 18 个 job 全绿                                                                          |
| 0073 | 已收口 | micro-spec | 已同步        | [修复 Windows Lefthook PATH](micro_specs/0073_修复Windows_Lefthook_PATH.md)                       | 2026-08-15       | 功能提交 `e955a7d26` 已进入 main；Windows 真实 hook、空格参数与远端 SHA 均已核验                                                                |
| 0074 | 已收口 | micro-spec | 已同步        | [关闭末个 Workspace 标签后返回新建页](micro_specs/0074_关闭末个Workspace标签后返回新建页.md)      | 2026-08-16 10:52 | 独立提交 `1a73fe3`；原 0069 因远端编号冲突改号；真实 Playwright RED→GREEN，transaction 6/6、静态门禁与资源回收通过                              |
| 0076 | 已收口 | micro-spec | 已同步        | [修复已读活跃会话状态分组](micro_specs/0076_修复已读活跃会话状态分组.md)                          | 2026-08-17 12:27 | running 为 Working，idle 无论已读均为 Ready，仅无 idle 且已读为 Done；协议/daemon/App/Playwright、静态与格式门禁全部通过                        |
| 0077 | 已收口 | micro-spec | 已同步        | [整理侧边栏会话元信息](micro_specs/0077_整理侧边栏会话元信息.md)                                  | 2026-08-17 11:52 | Agent 固定最右侧、desktop hover card 项目名及 desktop/compact 差异已完成；Vitest、Playwright、typecheck、lint 与格式检查通过                    |

## 候选待办

| 来源               | 分类 | 摘要                                                                    | 建议下一步                                                      |
| ------------------ | ---- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| CI `30750520143`   | 维护 | GitHub Actions 中仍有基于 Node 20 的 action，被 runner 强制切到 Node 24 | 独立升级相关 action 版本并复跑 CI，避免未来 runner 移除兼容路径 |
| `v0.2.5-beta.1/.2` | 发布 | 连续两次原子 tag push 未自动触发三条发布 workflow，均需手动 dispatch    | 核对 GitHub 凭证/事件链路并在下一 beta 验证自动 tag trigger     |
| `v0.2.5-beta.1/.2` | 发布 | Release Notes Sync 后仍需手工补充 macOS beta 未签名/未公证提示          | 将警告纳入持久事实源或同步脚本，并补回归测试                    |

## 维护检查

- 新增正式任务：更新“编号索引”和“任务汇总”。
- 新增候选待办：只写入“候选待办”，不占编号。
- 创建 Spec / micro-spec：回填文档类型和落盘/同步状态。
- 执行前通常设为 `待批准`；获批后设为 `执行中`。
- 验证完成但仍需人工验收时设为 `待手工验收`；收口后设为 `已收口`，并回写任务文档。
- 任务取消或暂停时更新状态并说明原因。
- 任务实例没有编号时，立即分配编号、重命名并同步本表。
- 候选待办进入代码前，按项目规则判断是否豁免；不豁免时先创建或关联 Spec / micro-spec。
