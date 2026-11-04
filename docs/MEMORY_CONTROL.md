# 记忆更正、撤回与一致性

## 本期完成

- 记忆宫殿：有效/已撤回列表，内容、重要度、人物/地点/主题关联编辑，更正标识，失败保留草稿，版本冲突提示。
- PATCH /api/memories/{id}：必填 expectedRevision；检查 active 状态与版本后，原子更新文字、向量、实体关联、userEdited 和 revision，调用 invalidateDerived。只修改文字时未提供 entities 则保留原关联；界面会要求用户一同确认关联。
- DELETE /api/memories/{id}：保留现有无请求体调用；可选 expectedRevision。撤回保留 Memory 和来源关联，设置 userEdited/retractedAt、递增 revision。重复撤回不再次失效缓存或更改撤回时间。
- 更正和撤回仅影响目标记忆。实体清理仅删除无任何关联的实体；图谱只统计 active 记忆，不把撤回来源作为有效关系。
- 画像过期后，getProfile 不再返回旧摘要、标签和文风内容；记忆页显示“画像待更新”，用户可手动重建。缺少版本标记的旧画像也需更新一次。
- 画像重建只读取 active 记忆，不将旧画像作为事实输入。已更正/撤回来源的原文不再用于文风样本，防止将旧内容带回生成上下文。
- 月度回忆携带 derivedRevision；页面和生成服务均拒绝无版本或过期缓存，生成输入中的记忆及实体统计只使用 active 记忆。
- 画像和月度回忆从一致的数据库快照获取源数据，模型调用在事务外；保存前在事务中核对派生版本。期间发生记忆变更时拒绝保存旧结果，返回可重试的 409。
- 画像和月度回忆的 API/界面增加错误与重试处理。这是为接入失效机制所需的最小配套变更。

## API

更正请求示例：

```json
{
  "expectedRevision": 0,
  "content": "小鹿是我的同学",
  "importance": 8,
  "entities": [{ "name": "小鹿", "type": "person" }]
}
```

成功返回 memory（含状态、版本、关联，不含 embedding）、derivedRevision、profilePending。撤回响应另保留 ok=true。400 表示输入无效，404 表示记忆不存在，409 表示过期编辑、已撤回或生成版本冲突，失败时不提示成功。

撤回仅指不再作为有效长期记忆使用，原始日记、历史信件和撤回记录仍保留。本期没有恢复、重新抽取或全系统内容抹除功能。

## 与邮差负责人交接

1. 前置字段和 invalidateDerived 的签名不变。保存新记忆后，在同一事务里调用 reason=memory_created。已经提交的记忆只复用，不删除重建。
2. retrieve.ts、邮差快照与锚点查询、信件生成/核查只能使用 status=active。用户修改优先，后台更新条件需核对 status、userEdited、revision。
3. 记录详情页及收进邮局结果列表也需要排除已撤回记忆或明确显示撤回状态；旧 DELETE 调用已兼容。
4. 旧信引用保留原文快照和当时的 revision，分别展示“后来被更正过”或“已被你撤回”。本分支未改信件展示。
5. 后台写信任务若跨越用户更正/撤回，投递前也需重新校验引用版本/状态，避免使用已经失效的上下文。
6. entry_deleted 触发失效仍需记录删除负责人接入；本期未修改原始记录删除与附件清理。
7. 本分支修改 story.ts 的 import、RecapPayload 和月度缓存/生成部分，未改变 generateStoryCard 函数或故事卡片模板逻辑。未修改 prompts.ts、extract.ts、finalize、retrieve.ts、ScoreBreakdown.tsx、任务和信件相关文件。

## 验证

运行 npm test、npm run lint、npm run build。

新增 memory-management.test.ts 使用独立临时 SQLite 和固定模型输出，覆盖真实事务、实体同步、旧编辑冲突、向量/数据库失败回滚、软撤回幂等、画像失效及生成中的撤回、月度缓存复用及过期结果拒绝、原 DELETE 接口兼容。

浏览器在独立数据库验证：更正内容/重要度/人物后刷新仍保留；重建画像采用更正后的关联；撤回后有效数归零、图谱移除节点、已撤回列表保留内容且不可编辑；保存接口失败时草稿仍在且可重试。没有修改主预览中的演示记忆。

真实模型接口和邮差联动由对方分支负责，合并后需联合验收，不能将本分支的本地/固定模型验证视为真实模型端到端联调已经完成。
