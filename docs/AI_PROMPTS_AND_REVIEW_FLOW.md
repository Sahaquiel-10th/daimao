# AI 提示词与项目申请审核流程

## 提示词位置

默认提示词在：

- `cloudfunctions/daimaoBusiness/prompts.js`

云函数环境变量仍然可以覆盖默认提示词：

- `SECRETARY_RETRIEVAL_PROMPT`：生成 RAG 检索问题。
- `SECRETARY_PROJECT_REVIEW_PROMPT`：根据 SQL 硬数据和 RAG 证据做项目申请初审。

温度配置：

- `AI_TEMPERATURE`
- 当前推荐值：`0.1`
- 取值范围：`0` 到 `1`
- 越接近 `0` 越稳健、越少发散；越接近 `1` 越有创造性、波动更大。

项目申请审核建议继续使用 `0.1` 或 `0.2`，不要设高。

## 当前项目申请流程

用户点击申请参与项目后：

1. `applyProject` 立即写入 `project_applications`。
2. 申请状态：
   - `ai_review_status = pending`
   - `status = pending_secretary_review`
3. 系统立即给申请人写一条站内信：申请已提交。
4. 前端立即返回，不等待 AI。
5. 后台任务 `processProjectApplicationReviews` 处理待审核申请。
6. 后台任务完成后：
   - AI 初筛通过：状态改为 `pending_owner_review`，通知申请人和项目主理人。
   - AI 要求补充或拒绝：仍留在 `pending_secretary_review`，通知申请人，后续可人工秘书处理。

## 后续后台入口待做

管理后台需要补两个正式入口：

1. 项目完结后，项目主理人为成员写评价。
   - 对应云函数能力：`adminCreateProjectMemberReview`
   - 进入密封证据链。

2. 平台管理员为用户添加证据、访谈、风险备注。
   - 对应云函数能力：`adminCreateUserEvidence`
   - 进入密封证据链。

这些资料默认不对用户公开，只用于后台审核、项目申请判断和可信档案。

## ReAI Tag 策略

当前正式接入采用双轨 tag：

- 项目级总 tag：来自 `REAI_VDB_ID` 或 `REAI_DEFAULT_TAG_IDS`
- 用户级 tag：认证用户专属，后续记录在 `user_rag_tags`

每条知识库内容通过 `DAIMAO_META` 保存：

- `owner_user_id`
- `source_type`
- `source_id`
- `visibility`
- `source_trust`
- `evidence_polarity`
- `confidence`

项目申请时：

1. SQL 确定申请人和认证状态。
2. 优先用用户级 tag 召回这个人的证据链。
3. 召回后仍按 `owner_user_id` 校验，避免串人。
4. 用户级 tag 缺失或失败时，降级用项目级总 tag + `owner_user_id` 过滤。

平台级跨用户检索、未来人才池推荐、迁移重建仍使用项目级总 tag。
