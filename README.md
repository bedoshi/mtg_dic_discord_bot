# Discord Bot for AWS Lambda

AWS Lambda上で動作するDiscord botのサンプルです。

## 概要

このプロジェクトは、AWS Lambdaを使用してサーバーレスで動作するDiscord botです。Discord Interactions API（webhook）を使用して、スラッシュコマンドに応答します。

## 機能

- `/ping` - botの応答確認
- `/hello` - ユーザーへの挨拶

## セットアップ

### 1. Discord Developer Portalでの設定

1. [Discord Developer Portal](https://discord.com/developers/applications)にアクセス
2. 「New Application」をクリックしてアプリケーションを作成
3. 「Bot」タブでbotを作成し、トークンを取得
4. 「General Information」タブで以下の情報を取得：
   - Application ID
   - Public Key

### 2. 環境変数の設定

`.env.example`を参考に環境変数を設定してください：

```bash
DISCORD_PUBLIC_KEY=your_discord_public_key_here
DISCORD_APPLICATION_ID=your_application_id_here
DISCORD_BOT_TOKEN=your_bot_token_here
```

### 3. 依存関係のインストール

```bash
pnpm install
```

### 4. スラッシュコマンドの登録

```bash
pnpm run register-commands
```

## AWS Lambdaへのデプロイ

### 1. デプロイパッケージの作成

```bash
pnpm run deploy
```

これにより`discord-bot.zip`ファイルが作成されます。

### 2. Lambda関数の作成

1. AWS Lambdaコンソールで新しい関数を作成
2. Runtime: Node.js 18.x以上を選択
3. `discord-bot.zip`をアップロード

### 3. Lambda関数の設定

- **Handler**: `index.handler`
- **Timeout**: 30秒
- **Environment variables**: 上記の環境変数を設定

### 4. Function URLの設定

1. Lambda関数の「Configuration」→「Function URL」で有効化
2. 認証タイプ: NONE
3. 生成されたURLをコピー

### 5. Discord Applicationの設定

1. Discord Developer Portalに戻る
2. 「General Information」→「Interactions Endpoint URL」にLambda Function URLを設定
3. 「Save Changes」をクリック

## botをサーバーに招待

1. 「OAuth2」→「URL Generator」で以下を選択：
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: 必要な権限を選択
2. 生成されたURLでbotをサーバーに招待

## ファイル構成

- `index.js` - Lambda関数のメインハンドラー
- `package.json` - プロジェクト設定と依存関係
- `register-commands.js` - スラッシュコマンド登録スクリプト
- `.env.example` - 環境変数のテンプレート

## 技術仕様

- **Runtime**: Node.js 18.x
- **Framework**: なし（Native Lambda）
- **Discord API**: Interactions API（webhook方式）
- **認証**: Ed25519署名検証

## トラブルシューティング

### botが応答しない場合

1. Lambda関数のログを確認
2. 環境変数が正しく設定されているか確認
3. Discord ApplicationのInteractions Endpoint URLが正しいか確認
4. Function URLが公開されているか確認

### 署名検証エラーの場合

1. DISCORD_PUBLIC_KEYが正しいか確認
2. Lambda関数のタイムアウト設定を確認
3. リクエストの形式が正しいか確認

## 拡張方法

新しいコマンドを追加する場合：

1. `register-commands.js`にコマンド定義を追加
2. `index.js`にコマンドハンドリング処理を追加
3. スラッシュコマンドを再登録
4. Lambda関数を再デプロイ
