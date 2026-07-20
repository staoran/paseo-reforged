# <任务名称> 交接锚点

本文件不复制合同、状态、验证、风险或下一步；它只帮助下一个会话定位权威记录。

## 恢复锚点

- task_id：`<task id>`
- 记录根：`<task record root>`
- AGENTS / 项目规则：`<path and anchor>`
- 任务索引：`<path and anchor or N/A>`
- spec：`<path and anchor>`
- task plan：`<path and anchor or N/A>`
- findings：`<path and anchor or N/A>`
- 最近 progress：`<path and anchor>`

## 恢复动作

1. 先按 task_id 和记录根确认唯一任务，再读取上述锚点。
2. task plan 存在时从中读取当前状态；从 progress 读取验证、残余风险和下一步。
3. 在 progress 继续记录；不要在本文件复制或改写任何权威事实。
