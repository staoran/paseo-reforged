# 项目知识、关键上下文与 Codemap 维护

## 模式边界

| mode | 接受内容 | 拒绝内容 |
| --- | --- | --- |
| `project-knowledge` | 已验证、稳定、跨任务会再次影响判断的项目事实与决策 | 临时步骤、未验证猜测、可由源码直接替代的大段说明 |
| `critical-context` | 高风险链路、状态机、不变量、兼容/迁移、事故教训、失败信号与回退 | 普通模块说明、一次性失败流水、没有来源的风险想象 |
| `codemap` | `$codemap` 生成或更新的 source-linked 地图，以及项目索引/新鲜度 | 业务愿望、完整源码副本、手工替代地图、替代 Spec 或测试的二手结论 |

## Project Sync 流程

1. SDD 在 Review、Reverse Sync、handoff、重复纠错或发现稳定事实时提出 Project Sync Candidate，写明事实、来源、复用原因、边界、建议 mode、敏感性和提交边界。
2. 读取目标文件并查重；未验证内容继续留在 findings。除非项目规则明确允许自动同步，否则先经过项目自定义 checkpoint。
3. 只写最小摘要并链接源码、契约、测试、Codemap 或复盘证据；不把 Feature Spec、日志和聊天原文整段复制进长期文件。
4. 验证日期、来源路径、适用范围与敏感性字段完整；默认不 stage 或提交内部知识与用户偏好。

## Codemap 子流程

Codemap 是 SDD Research / Pre-Research 的条件能力，不是平行主流程。项目层只负责触发判断、scope、批准、`CODEMAP_INDEX.md` 和 Reverse Sync；feature/project/drift-check/update-existing、模板与输出格式全部由 `$codemap` 持有。

- 陌生代码库、跨模块链路、架构/边界影响、跨项目定位或既有地图漂移时，先核对 `$codemap` 依赖，再按 SDD scope 调用。
- `$codemap` 未安装、不可加载或版本策略不满足时，立即停止当前任务并提示安装/更新；不得生成手工 CodeMap 替代。
- 小范围且入口、依赖、事实源已经清楚时不触发 Codemap，直接读取源码与测试；这不是缺失依赖 fallback。
- 全局 Skill 产出后，项目层只登记地图路径、覆盖范围、新鲜度、漂移信号、关联 Spec 和验证 evidence。
- Execute 改变入口、模块边界、依赖、数据流、生成链路或验证入口后，Review 调用 `$codemap` drift-check；无漂移只记录结论。

## 隐私与失败边界

- 密钥、令牌、个人数据、生产连接串、未脱敏内部地址和私有原文不得进入长期文件。
- 来源冲突时并列记录冲突并回到 Research，不静默选择方便实现的版本。
- 找不到证据、适用边界或长期复用理由时，只保留候选，不同步。
