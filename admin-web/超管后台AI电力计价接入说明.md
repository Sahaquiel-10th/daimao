# 超管后台 AI 电力计价接入说明

## 1. 文档目的

本文档交给超管后台开发者，用于完成 AI 电力计价页面、倍率预览、计价发布和社区后台展示数据的接入。

职责边界：

```text
超管后台前端
  填写客户结算价格、实时预览倍率、确认发布

数据中心
  校验价格、重新计算倍率、生成计价版本、保存当前方案、执行扣费、保存历史快照

社区小程序管理后台
  从数据中心读取当前价格、当前倍率和历史账单，只展示，不自行计价
```

超管后台不计算实际 token 消耗，不直接修改客户余额，也不把计价配置分别写进各社区后台。

## 2. 固定计价规则

平台永久使用以下人民币价格作为统一基准：

```text
基准输入价：35 元 / 1M tokens
基准输出价：210 元 / 1M tokens
充值比例：1 元 = 1000 电力
```

这个基准不随实际模型、上游通道、采购价格或汇率变化。

管理员填写准备向客户展示的结算价格：

```text
客户输入价：人民币 / 1M tokens
客户输出价：人民币 / 1M tokens
```

倍率计算：

```text
输入倍率 = 客户输入价 ÷ 35
输出倍率 = 客户输出价 ÷ 210
当前消耗倍率 = max(输入倍率, 输出倍率)
```

当前消耗倍率四舍五入保留两位小数。

示例：

| 客户输入价 | 客户输出价 | 输入倍率 | 输出倍率 | 当前消耗倍率 |
| ---: | ---: | ---: | ---: | ---: |
| 28 元 | 168 元 | 0.80 | 0.80 | `×0.80` |
| 14 元 | 84 元 | 0.40 | 0.40 | `×0.40` |
| 35 元 | 210 元 | 1.00 | 1.00 | `×1.00` |
| 42 元 | 252 元 | 1.20 | 1.20 | `×1.20` |

如果输入输出不是等比设置，统一采用较高倍率。例如输入倍率为 `0.70`、输出倍率为 `0.80`，发布倍率为 `×0.80`，后续整笔 AI 用量按 `×0.80` 结算。

## 3. 页面入口

建议入口：

```text
超管后台
└── 财务与计费
    └── AI 电力计价
```

菜单名称使用“AI 电力计价”，不要使用“模型采购价”“中转站价格”等名称。页面只处理客户结算价，采购成本不在本页面展示。

进入页面后，先通过 `adminGetPlatformBillingSettings` 读取数据中心当前计价方案，再渲染表单。读取失败时不得用前端默认值覆盖当前方案。

## 4. 页面整体结构

建议从上到下分为四个区域：

```text
当前生效方案
固定计价基准
编辑客户结算价
发布预览与操作
```

### 4.1 当前生效方案

页面顶部使用概览卡展示：

```text
当前标签：优惠价
当前客户输入价：28.00 元 / 1M tokens
当前客户输出价：168.00 元 / 1M tokens
当前消耗倍率：×0.80
计价版本：V12
生效时间：2026-07-12 20:00
```

推荐状态颜色：

- 小于 `×1.00`：蓝色或绿色，标签“优惠价”。
- 等于 `×1.00`：中性灰色，标签“标准价”。
- 大于 `×1.00`：橙色，标签“保障价”或管理员填写的名称。

倍率超过 1 不需要隐藏或改写，直接展示真实倍率。

### 4.2 固定计价基准

使用只读卡片：

```text
固定基准
输入：35.00 元 / 1M tokens
输出：210.00 元 / 1M tokens
```

附一行说明：

```text
当前消耗倍率均相对这一固定基准计算。
```

这里不能出现输入框和编辑按钮。

### 4.3 编辑客户结算价

表单字段：

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| 客户输入价 | 金额输入框 | 是 | 大于 0，最多四位小数，单位“元 / 1M tokens” |
| 客户输出价 | 金额输入框 | 是 | 大于 0，最多四位小数，单位“元 / 1M tokens” |
| 计价标签 | 文本框或下拉框 | 是 | 最多 60 字，例如“优惠价”“标准价”“保障价” |
| 修改说明 | 多行文本框 | 否 | 最多 500 字，只供超管审计，不向客户展示 |

建议在计价标签旁提供快捷选项：

```text
优惠价  标准价  保障价  自定义
```

选择快捷项只填写标签，不自动修改价格。

### 4.4 发布预览

管理员修改任一价格后，前端立即计算并显示：

```text
输入倍率：28 ÷ 35 = 0.80
输出倍率：168 ÷ 210 = 0.80
发布后消耗倍率：×0.80
```

同时显示客户后台将看到的样式预览：

```text
客户输入价 28.00 元 / 1M tokens
客户输出价 168.00 元 / 1M tokens
当前消耗比例 ×0.80
```

如果输入倍率与输出倍率不相等，显示橙色提醒：

```text
输入输出价格不是等比设置。系统将取较高值，整笔用量按 ×0.80 结算。
```

如果新倍率大于当前倍率，再显示：

```text
发布后，客户后续 AI 请求的电力消耗将由 ×0.40 调整为 ×0.80。
```

如果新倍率小于当前倍率：

```text
发布后，客户后续 AI 请求的电力消耗将由 ×0.80 调整为 ×0.40。
```

## 5. 按钮与交互

### 5.1 恢复当前方案

按钮名称：

```text
恢复当前方案
```

作用：丢弃尚未发布的表单修改，恢复为数据中心当前生效值。

没有修改时禁用。

### 5.2 预览客户展示

按钮名称：

```text
预览客户展示
```

点击后打开弹窗或侧边抽屉，展示社区管理后台顶部计价卡和一条模拟账单：

```text
当前客户输入价：28 元 / 1M tokens
当前客户输出价：168 元 / 1M tokens
当前消耗比例：×0.80

模拟账单
基准 100 电力 | 优惠价 ×0.80 | 实扣 80 电力
```

预览只使用表单草稿，不调用发布接口。

### 5.3 发布计价方案

主按钮名称：

```text
发布计价方案
```

点击后先进行前端校验，再显示二次确认弹窗：

```text
确认发布新的 AI 电力计价方案？

客户输入价：28.00 元 / 1M tokens
客户输出价：168.00 元 / 1M tokens
当前倍率：×0.40
发布后倍率：×0.80

新价格只影响发布后开始的 AI 请求，历史账单不会改变。
```

弹窗按钮：

```text
取消
确认发布
```

发布请求进行中：

- 禁用所有表单字段和按钮。
- 主按钮显示“发布中…”。
- 禁止重复提交。

发布成功：

- 使用接口返回值刷新“当前生效方案”。
- 清除表单脏状态。
- 提示“计价方案已发布，后续 AI 请求将使用 ×0.80 结算”。
- 显示数据中心返回的新版本号和生效时间。

发布失败：

- 保留管理员已经填写的草稿。
- 显示数据中心返回的错误信息。
- 不得在页面上假装新方案已经生效。

## 6. 前端预览算法

前端计算示例：

```js
const REFERENCE_INPUT_PRICE = 35;
const REFERENCE_OUTPUT_PRICE = 210;

function roundFactor(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function previewPricing(customerInputPrice, customerOutputPrice) {
  const inputFactor = Number(customerInputPrice) / REFERENCE_INPUT_PRICE;
  const outputFactor = Number(customerOutputPrice) / REFERENCE_OUTPUT_PRICE;
  const displayFactor = roundFactor(Math.max(inputFactor, outputFactor));

  return {
    inputFactor,
    outputFactor,
    displayFactor,
    factorText: `×${displayFactor.toFixed(2)}`
  };
}
```

前端预览结果不能作为可信计费指令。发布时只提交客户输入价、客户输出价、标签和说明；数据中心用相同公式重新计算倍率并保存。

这样既避免每次实际扣费重新推导倍率，也防止有人篡改前端请求，直接上传一个与价格不一致的倍率。

## 7. 读取与发布接口

### 7.1 读取当前方案

页面首次进入、发布成功后需要重新确认服务端状态时，调用：

```text
adminGetPlatformBillingSettings
```

请求：

```json
{
  "action": "adminGetPlatformBillingSettings",
  "adminWebToken": "<超管登录令牌>"
}
```

返回：

```json
{
  "platformBillingSettings": {
    "powerPerCny": 1000,
    "referenceInputCnyPerMillion": 35,
    "referenceOutputCnyPerMillion": 210,
    "customerInputCnyPerMillion": 28,
    "customerOutputCnyPerMillion": 168,
    "inputFactor": 0.8,
    "outputFactor": 0.8,
    "displayFactor": 0.8,
    "customerBillingFactor": 0.8,
    "pricingLabel": "优惠价",
    "pricingVersion": 12,
    "pricingEffectiveAt": "2026-07-12 20:00:00"
  }
}
```

页面以这份返回值初始化“当前生效方案”和编辑表单。

### 7.2 发布新方案

使用数据中心超管 action：

```text
adminUpdatePlatformBillingSettings
```

请求示例：

```json
{
  "action": "adminUpdatePlatformBillingSettings",
  "adminWebToken": "<超管登录令牌>",
  "settings": {
    "customerInputCnyPerMillion": 28,
    "customerOutputCnyPerMillion": 168,
    "pricingLabel": "优惠价",
    "note": "调整当前客户结算价"
  }
}
```

不要提交以下字段作为计费依据：

```text
customerBillingFactor
displayFactor
inputFactor
outputFactor
```

这些字段均由数据中心计算。

成功返回示例：

```json
{
  "platformBillingSettings": {
    "powerPerCny": 1000,
    "referenceInputCnyPerMillion": 35,
    "referenceOutputCnyPerMillion": 210,
    "customerInputCnyPerMillion": 28,
    "customerOutputCnyPerMillion": 168,
    "inputFactor": 0.8,
    "outputFactor": 0.8,
    "displayFactor": 0.8,
    "customerBillingFactor": 0.8,
    "pricingLabel": "优惠价",
    "pricingVersion": 12,
    "pricingEffectiveAt": "2026-07-12 20:00:00"
  }
}
```

超管后台必须以返回的 `customerBillingFactor`、`pricingVersion` 和 `pricingEffectiveAt` 为最终发布结果，不能继续使用本地预览值冒充服务端结果。

## 8. 数据中心如何使用发布结果

发布时：

```text
接收客户输入价和输出价
→ 数据中心重新计算输入倍率和输出倍率
→ 取较高值并保留两位小数
→ 生成新的 pricingVersion
→ 保存客户价格、发布倍率、标签和生效时间
```

实际 AI 请求时：

```text
请求开始
→ 读取当前已发布计价版本
→ 固化本次请求的倍率和价格快照
→ 模型返回真实 input/output tokens
→ 按固定基准计算基准电力
→ 基准电力 × 已发布倍率
→ 扣除电力并保存账单
```

数据中心不会在每次请求中重新执行“客户价 ÷ 基准价”的倍率推导，只读取发布时已经保存的倍率。每次仍然必须根据真实 token 计算本次基准电力，这是实际用量结算不可省略的部分。

## 9. 社区小程序管理后台如何获得更新

计价方案不由超管后台分别推送给每个社区后台，也不让各社区后台保存自己的计价副本。

统一流程：

```text
超管发布新方案
→ 数据中心保存新方案并增加 pricingVersion
→ 社区后台调用账单查询接口
→ 数据中心返回最新 currentPricing
→ 社区后台更新页面展示
```

社区后台继续调用：

```text
getAppClientBillingStatement
```

读取返回值：

```json
{
  "currentPricing": {
    "customerBillingFactor": 0.8,
    "pricingLabel": "优惠价",
    "badgeText": "优惠价 ×0.8",
    "referenceInputCnyPerMillion": 35,
    "referenceOutputCnyPerMillion": 210,
    "customerInputCnyPerMillion": 28,
    "customerOutputCnyPerMillion": 168,
    "pricingVersion": 12,
    "effectiveAt": "2026-07-12 20:00:00"
  }
}
```

社区后台顶部展示：

```text
当前客户输入价：28.00 元 / 1M tokens
当前客户输出价：168.00 元 / 1M tokens
当前消耗比例：×0.80
```

### 更新时机

不需要做复杂的实时推送。社区后台在以下时机重新读取即可：

- 进入电力或账单页面时。
- 用户主动点击刷新时。
- 页面保持打开时，每 30～60 秒刷新一次。
- 完成一次 AI 请求并刷新余额或账单时。

社区后台可以缓存成功响应 30～60 秒。比较 `pricingVersion`：

- 版本相同，只刷新余额和账单即可。
- 版本变大，立即更新顶部价格和倍率展示。

超管发布成功后，不需要等待所有社区后台确认同步。数据中心从生效后的新请求开始使用新版本；社区后台下次读取时自然显示相同版本。

如果以后确实需要即时通知，可以增加“计价方案已更新”的通知事件，但通知只能用于提醒页面刷新，不能携带一份独立计价配置作为扣费依据。

## 10. 社区历史账单展示

历史账单使用每条记录自己的 `pricingDisplay`：

```json
{
  "pricingDisplay": {
    "tokenText": "1,240 tokens",
    "baseText": "基准 100 电力",
    "factorText": "优惠价 ×0.80",
    "chargedText": "实扣 80 电力",
    "factor": 0.8,
    "referenceInputCnyPerMillion": 35,
    "referenceOutputCnyPerMillion": 210,
    "customerInputCnyPerMillion": 28,
    "customerOutputCnyPerMillion": 168,
    "pricingVersion": 12
  }
}
```

社区后台不得使用 `currentPricing` 重算历史账单。即使当前已经从 `×0.80` 改为 `×1.20`，旧账单仍然展示当时保存的 `×0.80`。

推荐账单行：

```text
1,240 tokens | 基准 100 电力 | 优惠价 ×0.80 | 实扣 80 电力
```

展开详情再显示：

```text
当时客户输入价：28 元 / 1M tokens
当时客户输出价：168 元 / 1M tokens
计价版本：V12
```

## 11. 验收清单

1. 页面进入时先读取数据中心当前方案。
2. 固定基准 35/210 只读，不可编辑。
3. 管理员只填写客户输入价、客户输出价、标签和说明。
4. 修改价格后实时预览输入倍率、输出倍率和较高倍率。
5. 不等比价格有明确警告。
6. 有“恢复当前方案”“预览客户展示”“发布计价方案”三个操作。
7. 发布前有包含新旧价格和倍率的二次确认。
8. 发布请求不上传自定义倍率作为计费依据。
9. 发布成功后使用数据中心返回值刷新页面。
10. 发布失败时保留草稿，不显示为已生效。
11. 社区后台通过 `getAppClientBillingStatement` 读取最新版本。
12. 社区后台进入页面、主动刷新或每 30～60 秒刷新时更新计价展示。
13. 历史账单使用自己的价格和倍率快照，不使用当前方案重算。
