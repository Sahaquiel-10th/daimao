# NFC 贴纸批量生成

以后只使用：

```text
scripts/generateNfcSchemes.js
```

脚本会自动生成唯一 token、`tagCode`、业务 SN、批次号和结果文件夹。不需要手工填写批次，也不用记录上次生成到第几号。

## 每次生产时运行

下面以生成 20 张为例。只需要修改 `--count`：

```bash
cd "/Users/machao/Desktop/I have a 呆猫"
export WECHAT_APP_SECRET='这里替换成呆猫小程序当前有效的AppSecret'

node scripts/generateNfcSchemes.js \
  --count 20 \
  --concurrency 10

unset WECHAT_APP_SECRET
```

例如生产 10000 张，只改成：

```bash
node scripts/generateNfcSchemes.js \
  --count 10000 \
  --concurrency 10
```

脚本自动创建类似下面的文件夹：

```text
scripts/生成结果_20260615153045_ABCD_20张/
```

文件用途：

- `需要导入云数据库的文档.json`：导入 `daimao_nfc_tags`。
- `需要交给工厂的链接.txt`：交给工厂写入 NFC。
- `内部核对表.csv`：token、tagCode、SN、链接对照表。
- `内部主清单_请勿删除.json`：本批次原始数据，必须归档。
- `生成进度_请勿删除.json`：中断续跑记录。
- `生成失败记录.json`：失败明细。

## 正确顺序

1. 运行生成命令。
2. 将 `需要导入云数据库的文档.json` 以新增记录方式导入 `daimao_nfc_tags`。
3. 抽取少量链接实际写入和测试。
4. 将 `需要交给工厂的链接.txt` 交给工厂。
5. 整个结果文件夹内部归档。

`claimToken` 和 `tagCode` 必须在数据库建立唯一索引。

## 中断后继续

正常情况下无需填写输出目录。如果生成中断，需要对已有文件夹续跑：

```bash
node scripts/generateNfcSchemes.js \
  --count 20 \
  --output "scripts/生成结果_实际文件夹名称" \
  --concurrency 10
```

脚本会复用 `内部主清单_请勿删除.json`，不会更换 token。

## AppSecret

AppSecret 只用于向微信接口申请 Scheme，不参与 token、tagCode 或 SN 的生成。

- 不需要每批重置。
- `unset WECHAT_APP_SECRET` 只会清除当前终端里的临时环境变量。
- 重置 AppSecret 不会让已经生成或已经写入贴纸的链接失效。
- 只有怀疑 AppSecret 泄露时才需要在微信后台重置。
