# 呆猫微信小程序 MVP

> 2.0 已新增 OPC 项目围观、官方活动、AI 秘书、约见入局、项目协作空间、
> 文字记录抽取、日程提醒、Agent Profile 和 MySQL 后端骨架。
> 本地默认使用 `miniprogram/config/business.js` 的 `mock` 模式。
> 正式部署见 `docs/DEPLOYMENT_2_0.md`。

这是一个微信个人名片交换小程序原型，当前先使用本地存储模拟用户资料、碰过的人和 NFC 贴纸唯一链接绑定。

## 当前流程

1. 第一次直接打开小程序：进入微信对话式问答，引导用户填写姓名、工作和兴趣介绍。
2. 问答结束：进入名片编辑页，补充头像、微信号和关键词。
3. 再次打开小程序：显示“碰过的人”和“关于自己”两个入口。
4. NFC 唯一链接打开：通过 `pages/tag-entry/index?token=8F3K2P9XQ7` 进入贴纸识别和认领流程。
5. 名片页：支持复制微信号，并提示用户用系统截图保存介绍图。

推荐真实业务流程：

1. 新用户先直接打开小程序，填好自己的名片。
2. 等实体 NFC 贴纸寄到后，碰一下贴纸进入认领页。
3. 如果贴纸未绑定，用户点击认领，贴纸就绑定到当前账号。
4. 以后别人碰这张贴纸，会直接打开这个用户的介绍名片。

每张贴纸写入的不是同一个链接，而是同一个入口页面加不同 `claimToken`：

```text
pages/tag-entry/index?token=8F3K2P9XQ7
pages/tag-entry/index?token=KBRKDHFCLJ
pages/tag-entry/index?token=65QYUA8F2H
```

入口页面一样，token 必须每张贴纸唯一。不能所有贴纸写同一个 token，否则大家会抢同一张“虚拟贴纸”的绑定关系。

## NFC 唯一链接绑定策略

每张 NFC 贴纸提前写入一个小程序路径，路径里带唯一随机 `claimToken`，例如：

```text
pages/tag-entry/index?token=8F3K2P9XQ7
```

用户碰贴纸后，小程序进入 [miniprogram/pages/tag-entry/index.js](/Users/machao/Desktop/I have a 呆猫/miniprogram/pages/tag-entry/index.js)，查询贴纸状态：

- `unbound`：提示当前用户绑定到自己的账号。
- `bound`：打开 owner 的个人介绍页，并记录一次访问。
- `frozen`：显示贴纸已失效。
- 数据库已有 token：读取现有贴纸状态。
- 数据库不存在：显示链接无效，不能查询或绑定。

这一版不做 NFC 读写、不读取 SN 码、不让用户手动输入 SN。

正式量产使用微信“NFC 标签调起小程序”的一机一码短 Scheme。脚本为每张贴纸生成唯一 `tagCode`、业务 SN 和 16 位随机 token，同时输出云数据库导入文件与工厂写入文件。未绑定记录需要先导入 `daimao_nfc_tags`；每个业务 SN 再调用 `generateNFCScheme`，得到一条 `weixin://dl/business/?t=...` 交给工厂写入。这里不读取芯片 UID。批量生成说明见 `scripts/README_NFC_SCHEMES.md`。

## 数据结构

新增云数据库集合：

- `daimao_nfc_tags`：贴纸表，字段包括 `tagCode`、`claimToken`、`ownerUserId`、`status`、`batchNo`、`createdAt`、`boundAt`、`lastVisitedAt`。
- `daimao_tag_visits`：访问记录表，字段包括 `tagId`、`tagCode`、`ownerUserId`、`visitorUserId`、`source`、`createdAt`。

名片和个人主资料已迁移到 CloudBase SQL：

- `users`：用户主身份，`openid` 与微信用户对应。
- `user_profiles`：名片主档案，保存姓名、工作、简介、微信号、标签、三个问答。
- `user_connections`：猫友关系聚合表。
- `rag_sources`、`rag_chunks`、`rag_index_jobs`：可信证据检索层入口。

`daimao_user_profiles` 只作为历史名片迁移来源保留，新保存名片不再写入。

## 云函数

新增 [cloudfunctions/daimaoTagFunctions/index.js](/Users/machao/Desktop/I have a 呆猫/cloudfunctions/daimaoTagFunctions/index.js)，包含四个 action：

- `getTagByToken`
- `bindTagToCurrentUser`
- `recordTagVisit`
- `upsertCurrentUserProfile`
- `getCurrentProfile`
- `getProfileByUserId`
- `getMyConnections`

`bindTagToCurrentUser` 在云函数里用事务二次检查 tag 状态，避免两个用户同时认领同一张贴纸时覆盖绑定。

## 测试 token

当前前端在云函数不可用时会自动使用 mock 数据，方便本地预览：

- `8F3K2P9XQ7`：未绑定贴纸。
- `BOUND2OWNER`：已绑定到示例用户。
- `FROZEN0001`：已冻结贴纸。
- `RACECLAIM1`：并发/重复绑定测试贴纸。

批量生成 token、数据库导入文档和 NFC Scheme，统一使用
[scripts/generateNfcSchemes.js](/Users/machao/Desktop/I have a 呆猫/scripts/generateNfcSchemes.js)。
操作说明见
[scripts/README_NFC_SCHEMES.md](/Users/machao/Desktop/I have a 呆猫/scripts/README_NFC_SCHEMES.md)。

当前演示闭环：

1. 用 `pages/tag-entry/index?token=BOUND2OWNER` 模拟碰到别人的贴纸。
2. 在对方名片页点击“我也想领一只呆猫”。
3. 填写并保存自己的名片。
4. 在“关于自己”里可以“预览我的名片”并保存完整图。
5. 点击“我也想要呆猫贴”，内测版会弹出作者微信二维码，提示用户一对一领养呆猫贴。

## 素材云存储

前端云环境配置集中在 [miniprogram/config/cloud.js](/Users/machao/Desktop/I have a 呆猫/miniprogram/config/cloud.js)。当前小程序作为消费方访问资源方小程序 `wxf07383c20790894b` 共享的云环境 `cloud1-8gocbg40af3862ce`。

前端资源入口集中在 [miniprogram/config/assets.js](/Users/machao/Desktop/I have a 呆猫/miniprogram/config/assets.js)。正式版只使用云存储素材，不再依赖本地兜底图片。

上线前建议在微信开发者工具里打开“云开发 - 存储”，上传大图素材，然后把每个文件的 `fileID` 填到 `remoteAssets` 对应 key 里，例如：

```js
const remoteAssets = {
  stickerNine: "cloud://your-env-id.xxx/daimao/sticker-nine.png",
  contactQr: "cloud://your-env-id.xxx/daimao/contact-qr.png",
  catLaying: "cloud://your-env-id.xxx/daimao/cat-laying-cutout.png",
};
```

页面会把云存储 fileID 转成临时 URL 后渲染；生成名片图时也会先换成临时 URL 再绘制到 canvas。`remoteAssets` 里每个 key 都必须填写当前云环境可访问的 fileID。

上线前检查：

- 确认 `remoteAssets` 里的 fileID 都属于资源方云环境 `cloud1-8gocbg40af3862ce`。
- 确认云开发控制台“存储”里存在 `daimao/*.png` 这些文件。
- 确认小程序端可以调用 `wx.cloud.getTempFileURL` 获取这些文件的临时 URL。

## 下一步建议

1. 增加内部管理端：批量导入 token、冻结贴纸、查看绑定状态。
2. 做贴纸批次管理和小程序码生成。
3. 将活动报名/签到动作统一切到 CloudBase RDB，并补齐 `event_record` RAG 写入。
