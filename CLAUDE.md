# CLAUDE.md

## Lambda ハンドラーの設計方針

### callback-based handler を使う理由

`index.js` のメインハンドラーは **callback-based handler** (`function(event, context, callback)`) で実装している。`async handler` ではない。

```js
exports.handler = function(event, context, callback) {
    _handler(event)
        .then(response => callback(null, response))
        .catch(err => callback(err));
};

async function _handler(event) { ... }
```

**理由:** `/get-dictionary` コマンドでSQS送信をfire-and-forgetしつつ、Discordの3秒タイムアウト内にtype 5レスポンスを返す必要があるため。

- `async handler` では `return` した時点でLambdaコンテナが即時凍結する → 未完了のSQS送信が破棄される
- `callback-based handler` では `callbackWaitsForEmptyEventLoop = true`（デフォルト）により、`callback()` でDiscordへ即レスポンスした後もイベントループ（SQSのpending promise）が空になるまでLambdaが待機する → SQS送信が確実に完了する

**絶対に `async handler` に戻さないこと。**

### /get-dictionary の処理フロー

```
1. 署名検証
2. sqs.send() を await せず起動（fire-and-forget）
3. _handler が type 5 を return → callback() でDiscordへ即送信
4. Lambda: SQS promise完了を待機
5. SQS送信完了 → Lambda凍結
```

## Lambda 関数名

| 用途 | 関数名 |
|---|---|
| Botハンドラー（Discord webhook受信） | `mtg-dic_discord-bot` |
| SQSハンドラー（辞書処理） | `discord-bot-dictionary-handler` |

関数名はワークフローの `env` セクションに定数として定義している（secretsではない）。

## GitHub Actions

- Lambda関数名は `.github/workflows/deploy-lambda.yml` の `env` セクションにハードコード
- 両Lambdaに同じ `discord-bot.zip` をデプロイ（ハンドラー設定はAWS側で別々に設定）
- `workflow_dispatch` により手動実行も可能

## SQS / Discord タイムアウト

- Discordのinteractionタイムアウトは **3秒**
- `/get-dictionary` はtype 5（deferred response）+ SQS非同期処理で対応
- コールドスタート時はSQS送信に最大2秒程度かかる場合がある（TCP接続確立コスト）
- ウォームスタート時は数十ms程度
- 根本的なコールドスタート対策が必要な場合は Lambda Provisioned Concurrency を検討
