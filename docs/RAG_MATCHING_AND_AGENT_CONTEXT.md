# 呆猫 RAG 匹配与 Agent 上下文设计

## 核心结论

呆猫不应该只做“全库搜人”，也不应该只做“每个人一个封闭知识库”。更稳的路线是双层检索：

```text
全局发现：从整个呆猫人才池里发现候选人。
个人深查：围绕某一个人的可信档案，判断他是否适合某个项目。
```

这两条链路服务不同场景，不能混成一次 RAG 查询。

## 数据边界

CloudBase SQL 是唯一可信主库：

```text
users / user_profiles：人和名片资料。
projects / project_members / project_records：项目和参与留痕。
official_events / event_registrations：活动和参与留痕。
rag_sources / rag_chunks / rag_index_jobs：需要进入 RAG 的原文、切片和索引队列。
```

ReAI 知识库是可重建的检索副本：

```text
保存带 DAIMAO_META 的文本切片。
负责向量召回。
不作为权限、身份、经验值、项目状态的判断来源。
```

ReAI 必须保存一份文本切片才能做向量召回，但这份内容不是主数据。任何 AI 判断都要回查 SQL 后再使用。

## 两条检索链路

### 1. 全局候选发现

用于回答：

```text
谁可能懂 B2B 销售？
谁做过 AI 小程序？
谁适合某类项目？
```

推荐流程：

```text
1. 查 ReAI 全局 tag。
2. 拿回 chunks。
3. 解析 DAIMAO_META.owner_user_id。
4. 按 owner_user_id 聚合成人。
5. 回 SQL 拉硬资料、社区认证、经验、项目和活动记录。
6. 对人做重排，而不是对 chunk 做最终排序。
7. 必要时再对前 N 个候选人做个人深查。
```

关键点：

```text
RAG 初筛对象是 chunk。
产品排序对象必须是人。
```

否则会出现一个人贡献很多 chunk、挤掉其他候选人的问题。

### 2. 个人可信档案深查

用于回答：

```text
这个申请人是否适合这个项目？
我想了解某个人的真实经历。
这个人有没有交付过类似项目？
这个人有什么风险或明确不适合的地方？
```

推荐流程：

```text
1. 已知 user_id。
2. 优先查该用户的个人 tag，或查全局 tag 后按 owner_user_id 过滤。
3. 用多个问题检索：
   - 能力匹配
   - 交付证据
   - 协作记录
   - 风险/偏好/不适合证据
4. 回 SQL 拉硬资料：
   - 名片资料
   - 社区认证
   - 经验值
   - 项目参与记录
   - 活动参与记录
   - 管理员备注/评审记录
5. 把 SQL 硬资料和 RAG 证据一起交给 AI。
```

小秘书审核项目申请应该优先走这条链路。

## Tag 策略

当前第一阶段：

```text
REAI_VDB_ID=UOPFXoO3
```

它是默认全局 tag。当前所有切片都会写入这个 tag，保证链路简单可测。

代码现在支持多 tag：

```text
默认 tag：来自 REAI_DEFAULT_TAG_IDS 或 REAI_VDB_ID。
额外 tag：来自写入资料 metadata.reai_tags。
查询 tag：可以通过 vectorSearch 的 reaiTags 指定。
```

推荐演进：

```text
第一阶段：一个默认全局 tag。
第二阶段：增加个人 tag，但不替代全局 tag。
第三阶段：按场景增加 project / event / community / source_type tag。
```

同一条 chunk 可以写多个 tag：

```text
[
  "global_daimao",
  "user_4",
  "source_profile",
  "community_opc"
]
```

不要把“一个用户一个 tag”做成唯一主路径。原因是全局找人需要跨用户召回。更合理的是：

```text
所有可被全局发现的资料进 global tag。
同一份资料也可以进 user tag，供个人深查。
权限判断仍由 DAIMAO_META + SQL 控制。
```

## Agent 闲聊和项目匹配的上下文区别

### Agent 闲聊

目标是让两个用户的 AI 助手轻量交流，不产生可信档案结论。

上下文只使用：

```text
用户自己填写的简介。
用户自己回答的名片问题。
公开标签。
```

不使用：

```text
项目交付记录。
活动参与记录。
管理员备注。
评审记录。
负面/风险证据。
```

闲聊内容默认不进入可信档案，不参与经验值，不作为项目匹配证据。

如果未来要沉淀闲聊结论，必须经过用户确认或管理员确认后，才能写入 `evidence_records` 或 `rag_sources`。

### 项目适配判断

目标是判断“这个人是否适合这个项目”。

上下文必须更完整：

```text
SQL 硬资料：
- 个人资料
- 社区认证
- 经验值
- 项目参与和主理记录
- 活动参与记录
- 管理员备注/评审记录

RAG 证据：
- 名片简介和问答
- 项目过程记录
- 活动参与记录
- 管理员备注/评审记录
- 后续线下录音转文字
```

AI 输出必须区分：

```text
硬事实：来自 SQL。
证据片段：来自 RAG，且能回查 rag_chunks。
推断：AI 基于事实和证据做出的判断。
```

## DAIMAO_META 必备字段

每个进入 ReAI 的切片都应保留：

```json
{
  "chunk_id": 123,
  "rag_source_id": 45,
  "source_type": "profile",
  "source_id": 4,
  "owner_user_id": 4,
  "project_id": null,
  "event_id": null,
  "community_id": null,
  "reai_tags": ["user_4"],
  "visibility": "match_only",
  "evidence_polarity": "positive",
  "confidence": 0.72,
  "text_hash": "sha256..."
}
```

召回后必须：

```text
1. 解析 DAIMAO_META。
2. 用 chunk_id 回查 rag_chunks。
3. 用 rag_source_id 回查 rag_sources。
4. 校验 owner_user_id、visibility、status、source_type。
5. 再交给 AI。
```

## 近期实现顺序

### 已完成

```text
CloudBase SQL 主库已接通。
rag_sources / rag_chunks / rag_index_jobs 已建立。
ReAI 写入和查询已跑通。
rag_chunks.vector_doc_id 已能回写 ReAI objectId。
代码已支持 ReAI 多 tag 结构。
```

### 下一步

```text
1. 继续跑完所有 pending 的 rag_index_jobs。
2. 增加“用户资料补索引”动作，确保老用户都有 profile RAG。
3. 增加个人深查接口：
   - 输入 user_id + question/project_id
   - 查个人 tag 或按 owner_user_id 过滤
   - 回 SQL 汇总硬资料
4. 增加全局候选发现接口：
   - 查全局 tag
   - 按 owner_user_id 聚合
   - SQL 重排
5. 再接 AI 判断和小秘书项目审核。
```

### 暂缓

```text
Agent 与 Agent 闲聊。
自动创建 ReAI 个人 tag。
线下录音自动同步。
闲聊内容沉淀为可信档案。
```

这些功能都依赖权限、确认和隐私边界，等项目匹配主链路稳定后再做。
