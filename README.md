# MTG Dictionary Discord Bot

AWS Lambda上で動作するMTG辞書配布用のDiscord botです。

## 概要

Discord Interactions API（webhook方式）を使用してスラッシュコマンドに応答します。
辞書ファイルの配布はSQSを介した非同期処理で行います。

## アーキテクチャ

```
Discord → Lambda Function URL (index.js)
                ↓ SQS
          Lambda (dictionary-handler.js)
                ↓
          Discord followup message
```

### Lambda関数

| 関数名 | ハンドラー | 役割 |
|---|---|---|
| `mtg-dic_discord-bot` | `index.handler` | Discord webhook受信・署名検証・コマンド処理 |
| `discord-bot-dictionary-handler` | `dictionary-handler.handler` | SQSトリガー・辞書ファイル生成・Discord送信 |

両関数に同じzipをデプロイし、AWS側のハンドラー設定で役割を分けています。

## スラッシュコマンド

| コマンド | 説明 |
|---|---|
| `/ping` | 応答確認 |
| `/get-dictionary` | 辞書ファイルを非同期で生成・送信（type 5 deferred response） |
| `/purge-queue` | SQSキューのメッセージを削除 |
| `/remove-guild-command` | ギルドスラッシュコマンドを全削除 |

## セットアップ

### 1. Discord Developer Portalでの設定

1. [Discord Developer Portal](https://discord.com/developers/applications)でアプリケーションを作成
2. 「Bot」タブでbotトークンを取得
3. 「General Information」タブで以下を取得：
   - Application ID
   - Public Key

### 2. 環境変数の設定

Lambda関数の環境変数として以下を設定します（`.env`はローカルの`register-commands.js`実行時のみ使用）：

| 変数名 | 説明 |
|---|---|
| `DISCORD_PUBLIC_KEY` | Ed25519署名検証用公開鍵 |
| `DISCORD_APPLICATION_ID` | DiscordアプリケーションID |
| `DISCORD_BOT_TOKEN` | Botトークン |
| `DISCORD_GUILD_ID` | ギルドID |
| `DICTIONARY_QUEUE_URL` | SQSキューURL |

### 3. 依存関係のインストール

```bash
pnpm install
```

### 4. スラッシュコマンドの登録

ローカルで`.env`を用意してから実行：

```bash
pnpm run register-commands
```

## デプロイ

GitHub Actionsによる自動デプロイが設定されています。

- `main`ブランチへのpushで自動実行
- GitHub ActionsのUIから手動実行（`workflow_dispatch`）も可能

### 手動でデプロイする場合

```bash
# パッケージ作成
zip -r discord-bot.zip . \
  -x "*.git*" -x "*node_modules/.cache/*" \
  -x "*.md" -x "tests/*" -x ".github/*"

# Lambda更新
aws lambda update-function-code \
  --function-name mtg-dic_discord-bot \
  --zip-file fileb://discord-bot.zip

aws lambda update-function-code \
  --function-name discord-bot-dictionary-handler \
  --zip-file fileb://discord-bot.zip
```

### Lambda関数の設定（AWS側）

**mtg-dic_discord-bot:**
- Handler: `index.handler`
- Timeout: 30秒
- Function URL: 有効（認証タイプ: NONE）

**discord-bot-dictionary-handler:**
- Handler: `dictionary-handler.handler`
- Timeout: 必要に応じて設定
- トリガー: SQS

### Discord Applicationの設定

「General Information」→「Interactions Endpoint URL」にLambda Function URLを設定。

## ファイル構成

```
├── index.js                  # Botハンドラー（webhook受信）
├── dictionary-handler.js     # SQSハンドラー（辞書処理）
├── register-commands.js      # スラッシュコマンド登録スクリプト
├── src/
│   ├── dictionaryProcessor.js  # 辞書ファイル生成
│   ├── discordUtils.js         # Discord followupメッセージ送信
│   └── messageProcessor.js    # 重複排除・ファイルサイズ確認
├── .github/workflows/
│   └── deploy-lambda.yml     # CI/CDワークフロー
└── CLAUDE.md                 # 設計方針・実装上の注意事項
```

## 技術仕様

- **Runtime**: Node.js 22.x
- **パッケージマネージャー**: pnpm
- **Discord API**: Interactions API（webhook方式）
- **認証**: Ed25519署名検証（tweetnacl）
- **非同期処理**: AWS SQS
- **CI/CD**: GitHub Actions（OIDC + IAMロール）

## トラブルシューティング

### アプリケーションが応答しない

1. Discordのタイムアウトは3秒。コールドスタート時はギリギリになることがある
2. Lambda Function URLのログを確認（CloudWatch）
3. 環境変数が正しく設定されているか確認
4. Function URLがDiscordのInteractions Endpoint URLに正しく設定されているか確認

### SQSにメッセージが届かない

1. `DICTIONARY_QUEUE_URL`環境変数が設定されているか確認
2. LambdaのIAMロールにSQS送信権限があるか確認
3. `dictionary-handler`のCloudWatchログを確認

### 署名検証エラー

1. `DISCORD_PUBLIC_KEY`が正しいか確認
2. リクエストボディが改ざんされていないか確認

## 新しいコマンドの追加

1. `register-commands.js`にコマンド定義を追加
2. `index.js`の`_handler`内のswitchにケースを追加
3. スラッシュコマンドを再登録（`pnpm run register-commands`）
4. Lambda関数を再デプロイ
