# 记忆管理前置约定

本 PR 提供 Memory 状态字段和可调用的派生数据失效函数。它**尚未**将记忆管理 API 改为软撤回，也未接入检索过滤、抽取复用、画像读取或月度回忆重建。不要将本 PR 视为遗忘功能已经完成。

## Memory 状态

| 情况 | status | userEdited | retractedAt |
| --- | --- | --- | --- |
| 自动抽取的有效记忆 | active | false | null |
| 用户更正的有效记忆 | active | true | null |
| 用户撤回 | retracted | true | 撤回时间 |

- 新字段：`status String @default("active")`、`revision Int @default(0)`、`retractedAt DateTime?`。已有记忆获得 active / 0 / null，不删除、不重建。
- `status` 在 SQLite 中使用字符串，业务层只允许 active / retracted，不是数据库枚举约束。
- 有效记忆只按 status=active 判断；用户更正后的记忆仍有效。
- 更正和首次撤回时 revision 加一；重复撤回成功但不重复递增版本或触发失效。
- 后台只允许写 status=active 且 userEdited=false 的记忆。若先读取后写入，更新条件必须带上读取时的 revision；条件不再满足时不能覆盖。
- 用户更正接口也检查 expectedRevision，冲突返回 409 并保留前端草稿。
- 已保存的记录永不重新抽取；任务重试复用已提交结果，不删除重建记忆。尚未保存的抽取任务与其他用户操作的协调由任务负责人实现。
- DELETE /api/memories/{id} 路径保持兼容；后续 PR 将物理删除改为状态撤回。
- 旧信引用保存原文快照及引用时 revision；当前版本变化时展示“这条回忆后来被你更正过”，撤回时展示“这条回忆已被你撤回”。由信件负责人接入。

## invalidateDerived

```ts
import { invalidateDerived } from "@/lib/memory/consistency";

await db.$transaction(async (tx) => {
  // 用 tx 创建、更正或撤回记忆，以及同步实体关联。
  const { derivedRevision } = await invalidateDerived(
    { memoryIds, entryId, reason: "memory_created" },
    tx,
  );
  // 返回值可用于后续重建任务。此处不执行远程模型调用。
  return { derivedRevision };
});
```

签名：`invalidateDerived(input: InvalidateDerivedInput, tx: Prisma.TransactionClient): Promise<{ derivedRevision: number }>`。

- input：`memoryIds?: string[]`、`entryId?: string`、`reason`。至少提供一个非空来源；提供的 ID 不允许为空白。
- reason：memory_created / memory_corrected / memory_retracted / entry_deleted。
- 来源参数表示本次变更原因，不用于查找待删除记忆，也不要求记录仍存在，支持删除后的失效。
- 第一版保守地清除**全部** MonthlyRecap 缓存，并标记全局画像过期。函数不会删除 Memory、Entry、Profile 或 StoryCard。
- 使用既有 Setting 表，递增 `memory.derivedRevision`，将 `memory.profileBuiltRevision` 设为 `-1`，无需增加 Profile/MonthlyRecap 字段。
- 函数不提交事务、不捕获失败、不重试、不调用模型。任何一步失败均应由调用方让异常冒出，整体回滚。
- 每次调用都会递增版本；“重复请求不重复修改”由调用方负责。一个事务可批量提交多条记忆并调用一次。
- 并发锁冲突由最外层事务/任务策略处理；不要仅重试函数的一部分。

## 后续画像和缓存接入规则

后续 PR 实现，下列约定不能只靠当前函数自动完成：

1. 派生版本缺失视为 0；画像构建版本缺失或 -1 表示过期。读取旧画像时需要识别过期状态，不能继续当作最新结果使用。
2. 重建开始时读取版本 R，再读取有效记忆；事务外调用模型。重建不能把失效旧画像作为事实输入。
3. 保存前在事务中核对当前版本仍为 R，不同则丢弃旧结果，不得将构建版本标记为最新。画像成功保存后将构建版本设为 R。
4. 月度回忆同样在模型调用后、保存前检查版本。否则已删除的缓存会被较早启动的任务重新创建。缓存读取与版本核对也须在一致的数据库快照中进行。
5. invalidateDerived 返回成功只说明失效已完成，不代表画像或月度回忆已重建。

## 本地接入

合入后执行 `npm run db:push`，会增加字段并生成 Prisma Client。项目目前采用 db push 管理本地 SQLite，未引入 Prisma Migrate，也不要对已有数据使用 reset。

`npm test` 包含独立临时 SQLite 集成测试，不使用 .env 中的演示数据库。

本 PR 不修改 extract.ts、finalize、retrieve.ts、generateStoryCard、信件展示和 ScoreBreakdown.tsx。profile.ts 和 buildRecap 的后续接入由记忆管理负责人完成。
