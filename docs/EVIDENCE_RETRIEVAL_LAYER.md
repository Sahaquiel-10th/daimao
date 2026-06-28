# 可信证据检索层

呆猫的 AI 判断不能直接依赖自由发挥。每一次项目申请审核、项目推荐、可信档案总结，都应该由两类材料组成：

```text
MySQL 硬数据：身份、社区、活动、项目、等级、申请状态、权限。
VectorDB 证据：从名片、活动记录、项目记录、转写文本、反馈里检索出的片段。
```

CloudBase SQL 负责给 AI “事实框架”，RAG 表负责保存可检索原文，VectorDB 负责保存向量索引并召回“证据片段”。AI 只能在这些材料上做归纳、判断和解释。

## 0. 存储边界

不要把 VectorDB 当主数据库用。成熟 RAG 路线通常是：

```text
业务主库：users / projects / events / project_members 等硬事实。
RAG 原文库：rag_sources / rag_chunks / rag_index_jobs。
向量库：embedding vector + chunk_id + source_id + 权限/过滤 metadata。
```

原因：

1. 向量库擅长相似度检索，不擅长承担事务、权限、审计、复杂关联。
2. 原文放在 SQL，能版本化、回查、重建索引，换向量库时不丢业务资料。
3. 向量库只存索引和必要 metadata，不会降低召回质量；召回质量主要由 `chunk.content` 生成的 embedding、query embedding、切片质量和过滤条件决定。
4. 检索返回后必须用 `chunk_id/source_id` 回查 SQL，确认权限、状态和原文，避免把向量库返回结果当成最终事实。

## 1. 核心目标

可信证据检索层要解决三个问题：

1. 找到申请人与项目是否匹配的证据。
2. 控制带回给 AI 的文字量，避免上下文过长导致判断发散。
3. 区分正向证据、弱证据和负向证据，避免把“不擅长销售”误读成“擅长销售”。

## 2. 数据来源

进入检索层的资料必须先有 MySQL 主记录，再进入 VectorDB。

推荐来源类型：

```text
profile              用户自己填写的可信资料
card                 名片内容
event_record         活动参与记录
project_record       项目记录、会议纪要
feedback             他人评价或主理人确认
admin_note           运营/营主补充记录
offline_transcript   线下录音设备同步后的转写文字
```

项目申请材料只保留在 `project_applications`，不进入长期可信证据检索层。

VectorDB 中的每个 chunk 至少需要带这些 metadata：

```text
chunk_id
source_id
source_type
owner_user_id
project_id
event_id
community_id
tags
visibility
confidence
evidence_polarity: positive | neutral | negative | preference
created_at
version
short_text 或 text_hash
```

其中：

- `chunk_id`：回查 `rag_chunks.id`，拿原文和状态。
- `source_id`：回查 `rag_sources.id`，知道这段资料来自名片、活动、项目记录还是管理员备注。
- `owner_user_id`：限定“只搜这个申请人的资料”，防止串人。
- `project_id/event_id/community_id`：做项目、活动、社区范围过滤。
- `visibility`：做权限过滤。
- `confidence`：证据可信度，项目记录、管理员备注、他人反馈高于自我介绍。
- `evidence_polarity`：标记这段资料是正向能力证据、普通描述、负向风险，还是个人偏好/不想做的事。
- `short_text`：便于向量服务返回摘要；最终判断仍以 SQL 原文为准。
- `text_hash`：识别内容版本，后续重建索引和去重。

## 3. 项目发布时必须采集的字段

官方/营主发项目时，不能只写项目介绍。至少要写：

```text
项目标题
项目目标
项目标签：例如 AI产品 销售 大型项目 品牌 共创
希望什么样的人来
不适合什么样的人
需要的能力
可接受的参与方式：顾问 / 执行 / 资源 / 主理 / 观察
```

其中最关键的是：

```text
project.tags
project.ideal_participant
project.not_fit_participant
project.required_capabilities
```

这几个字段会直接参与检索 query 拼接。

## 4. 不要只搜一次

不要把所有信息拼成一个大 query 去搜一次。应该多路检索，每一路只解决一个问题。

项目申请审核建议固定 5 路：

```text
Q1 标签匹配：
申请人是否有与项目标签相关的经历？

Q2 能力匹配：
申请人是否具备项目要求的能力？

Q3 交付证据：
申请人是否有真实完成、推进、主理或协作过事情的记录？

Q4 合作证据：
申请人是否有线下活动、社区评审、项目协作、他人评价等可信记录？

Q5 风险和不匹配：
申请人是否明确不想做、不擅长、退出过、长期未完成，或与项目要求冲突？
```

每一路取 `topK=3` 到 `topK=5`，合并后去重，再按证据质量重排。

## 5. Query 拼接规则

每条检索 query 应该包含四部分：

```text
主体：申请人是谁
目标：当前项目要什么
关键词：标签、能力、行业、角色
证据类型：要找经历、交付、评价、风险，还是偏好
```

### 5.1 标签匹配 Query

模板：

```text
查找申请人 {user_name} 与项目标签 {project_tags} 相关的过往经历、项目记录、活动记录和被确认的能力证据。
项目目标：{project_goal}
希望参与者：{ideal_participant}
只返回能证明匹配关系的资料。
```

例子：

```text
查找申请人张三与项目标签 AI产品、品牌实验、共创相关的过往经历、项目记录、活动记录和被确认的能力证据。
项目目标：两周内完成一个可演示的 AI 原生品牌工作流。
希望参与者：有产品原型、品牌设计、自动化工作流或内容生产经验的人。
只返回能证明匹配关系的资料。
```

### 5.2 能力匹配 Query

模板：

```text
查找申请人 {user_name} 是否具备这些能力：{required_capabilities}。
优先返回真实项目、活动、交付结果、他人评价中的证据。
不要返回纯自我宣传，除非没有其他资料。
```

### 5.3 交付证据 Query

模板：

```text
查找申请人 {user_name} 的真实交付记录：
主理过什么、完成过什么、推进过什么、解决过什么具体问题。
优先返回有时间、项目、结果、他人确认的资料。
```

### 5.4 合作证据 Query

模板：

```text
查找申请人 {user_name} 在线下活动、社区评审、项目协作、共同交付中的合作记录。
重点关注靠谱、响应、沟通、复盘、持续投入、被邀请继续合作等证据。
```

### 5.5 风险和不匹配 Query

模板：

```text
查找申请人 {user_name} 与项目 {project_name} 不匹配的证据。
包括：明确不想做 {project_tags}，不擅长相关能力，时间不匹配，退出记录，未完成记录，负面反馈。
如果资料中出现“不擅长”“不想做”“不接”“避免”“讨厌”“没经验”，必须作为负向或偏好证据返回。
```

风险 query 必须单独搜，不能混在正向 query 里。这样可以降低 AI 把负向表达误读成正向能力的概率。

## 6. Metadata 过滤规则

VectorDB 检索不能只靠自然语言 query，还必须加结构化过滤。

项目申请审核时：

```text
owner_user_id = applicant_user_id
status = active / confirmed
visibility in 当前审核人可见范围
source_type in profile, card, event_record, project_record, feedback, admin_note
```

如果是项目主理人审核申请：

```text
允许看：
- 申请人公开资料
- 申请人主动提交给本项目的资料
- 与本项目相关的申请内容
- 平台确认可用于匹配的证据

不允许看：
- 申请人在其他私密项目里的内部记录
- 其他社区不可共享的私密资料
- 管理员私密备注，除非审核角色是管理员
```

AI 之前必须再回 MySQL 校验一次权限和 source 状态。VectorDB 返回结果不能直接信任。

## 7. 控制带回 AI 的字数

不要把检索结果原样全部塞给 AI。推荐预算：

```text
MySQL 硬数据：800-1200 中文字以内
证据总量：1500-2500 中文字以内
单条证据：120-180 中文字以内
证据条数：8-12 条以内
```

如果结果太多，先做重排和压缩：

```text
1. 去重：同一 source_id 只保留最强 1-2 条。
2. 提权：feedback、project_record、event_record 优先于 profile 自述。
3. 降权：过旧、无来源、纯自夸、低置信度资料。
4. 分桶：正向证据、交付证据、合作证据、负向证据分别保留。
5. 摘要：每条证据压成“事实 + 来源 + 时间 + 置信度”。
```

传给 AI 的证据格式建议固定为：

```text
[正向证据]
1. 2026-05 项目记录：张三完成小程序支付流程联调。来源：项目A会议纪要。置信度：高。

[交付证据]
1. 2026-04 活动复盘：张三主导活动报名页上线，48小时内完成。来源：活动记录。置信度：中。

[风险/不匹配]
1. 名片资料：张三写明“不接纯销售地推”。来源：个人资料。置信度：高。
```

不要给 AI 一堆无结构原文。

## 8. 避免“不擅长”被误读

这是系统必须处理的高风险点。

### 8.1 入库时标 polarity

切片入库前，先做轻量分类：

```text
positive：我做过、完成过、擅长、被确认
neutral：普通经历描述
negative：不擅长、失败、退出、负面评价
preference：不想做、不接、不喜欢、只想做
```

出现这些词时要提高警惕：

```text
不擅长
不想做
不接
避免
讨厌
没经验
不熟
退出
延期
没完成
不适合
不考虑
```

### 8.2 检索时分开查

正向能力和负向风险必须分开 query，不能混在一起。

### 8.3 传给 AI 时显式分区

AI 输入里必须出现：

```text
以下是风险/不匹配证据，不得当作正向能力：
```

### 8.4 AI 输出必须引用证据编号

AI 判断时不能只说“我认为匹配”。必须引用证据编号：

```text
结论：建议递交主理人
理由：
- 与 AI 产品匹配：引用正向证据 1、2
- 有交付记录：引用交付证据 1
- 风险：风险证据 1 表明不适合纯销售任务，因此建议只参与产品原型部分
```

没有证据就必须说“证据不足”，不能脑补。

## 9. 最终给 AI 的输入结构

建议后端组装成固定 JSON：

```json
{
  "task": "project_application_review",
  "hard_facts": {
    "applicant": {},
    "communities": [],
    "level": {},
    "projects": [],
    "events": [],
    "application": {},
    "target_project": {}
  },
  "retrieval_plan": [
    {
      "name": "tag_match",
      "query": "...",
      "topK": 4
    }
  ],
  "evidence": {
    "positive": [],
    "delivery": [],
    "collaboration": [],
    "risk": []
  },
  "output_requirements": {
    "must_cite_evidence_ids": true,
    "allowed_status": ["pass", "revise", "reject"],
    "max_summary_chars": 180
  }
}
```

## 10. 项目申请审核的推荐算法

第一版可以用简单规则：

```text
硬门槛：
- 未通过任一社区认证：不可申请
- 项目已关闭：不可申请
- 权限不允许：不可申请

证据评分：
+3 与项目标签强相关的 confirmed/project_record/feedback
+2 有交付记录
+2 有合作记录
+1 自我资料中声明相关能力
-3 明确不想做或不擅长项目核心能力
-2 负面反馈或未完成记录

AI 只在硬门槛通过后做解释和建议。
```

不要让 AI 决定硬权限。AI 只做“证据解释”和“是否值得递交主理人”的建议。

## 11. 后续可调参数

这些参数以后应该放配置里，而不是写死：

```text
每路 topK
总证据条数
单条证据最大字数
证据来源权重
资料过期时间
负向关键词表
不同项目标签的检索模板
不同社区的偏好权重
```

## 12. 一句话原则

可信证据检索层不是“把用户资料搜出来”。它的目标是：

```text
针对一个具体判断场景，找出少量、高质量、带来源、带方向的证据，让 AI 在证据边界内做判断。
```
