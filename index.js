const nacl = require('tweetnacl');
const { SQSClient, SendMessageCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');
const sqs = new SQSClient({});

exports.handler = function(event, context, callback) {
    // callbackWaitsForEmptyEventLoop = true（デフォルト）により、
    // callback()でDiscordへ即レスポンスした後もイベントループが空になるまで待機する。
    // これによりSQS送信のPromiseが完了してからLambdaが凍結される。
    _handler(event)
        .then(response => callback(null, response))
        .catch(err => callback(err));
};

async function _handler(event) {
    console.log('Event received:', JSON.stringify(event, null, 2));

    const signature = event.headers['x-signature-ed25519'] || event.headers['X-Signature-Ed25519'];
    const timestamp = event.headers['x-signature-timestamp'] || event.headers['X-Signature-Timestamp'];
    const body = event.body;

    console.log('Headers:', JSON.stringify(event.headers, null, 2));
    console.log('Signature:', signature);
    console.log('Timestamp:', timestamp);

    if (!verifySignature(signature, timestamp, body)) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid signature' })
        };
    }

    const interaction = JSON.parse(body);

    if (interaction.type === 1) {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 1 })
        };
    }

    if (interaction.type === 2) {
        const commandName = interaction.data.name;
        const user = interaction.member?.user || interaction.user;
        switch (commandName) {
            case 'ping':
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 4,
                        data: {
                            content: 'Pong! 🏓'
                        }
                    })
                };
            case 'get-dictionary': {
                    const messageBody = {
                        applicationId: interaction.application_id,
                        token: interaction.token,
                        userId: user.id,
                        timestamp: new Date().toISOString()
                    };

                    // awaitしない（fire-and-forget）
                    // callbackWaitsForEmptyEventLoopにより、Lambdaはこのpromiseが
                    // 完了するまで凍結しないため、SQS送信は確実に完了する
                    sqs.send(new SendMessageCommand({
                        QueueUrl: process.env.DICTIONARY_QUEUE_URL,
                        MessageBody: JSON.stringify(messageBody)
                    })).then(() => {
                        console.log('Dictionary processing queued for user:', user.id);
                    }).catch((error) => {
                        console.error('Failed to queue dictionary processing:', error);
                    });

                    // SQS完了を待たず即座にtype 5を返す
                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 5 // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
                        })
                    };
                }

            case 'purge-queue':
                try {
                    // SQSキューをパージ
                    await sqs.send(new PurgeQueueCommand({
                        QueueUrl: process.env.DICTIONARY_QUEUE_URL
                    }));

                    console.log('SQS queue purged successfully');

                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 4,
                            data: {
                                content: '✅ SQSキューのメッセージを削除しました'
                            }
                        })
                    };
                } catch (error) {
                    console.error('Error purging SQS queue:', error);
                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 4,
                            data: {
                                content: '❌ SQSキューの削除に失敗しました: ' + error.message
                            }
                        })
                    };
                }

            case 'remove-guild-command':
                try {
                    const applicationId = process.env.DISCORD_APPLICATION_ID;
                    const botToken = process.env.DISCORD_BOT_TOKEN;
                    const guildId = process.env.DISCORD_GUILD_ID;

                    if (!applicationId || !botToken || !guildId) {
                        return {
                            statusCode: 200,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 4,
                                data: {
                                    content: '❌ 環境変数が設定されていません'
                                }
                            })
                        };
                    }

                    // ギルドコマンドを全て削除（空の配列をPUTする）
                    const fetch = require('node-fetch');
                    const response = await fetch(
                        `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
                        {
                            method: 'PUT',
                            headers: {
                                'Authorization': `Bot ${botToken}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify([])
                        }
                    );

                    if (response.ok) {
                        console.log('Successfully removed guild commands');
                        return {
                            statusCode: 200,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 4,
                                data: {
                                    content: '✅ ギルドコマンドを削除しました'
                                }
                            })
                        };
                    } else {
                        const errorText = await response.text();
                        console.error('Failed to remove guild commands:', response.status, errorText);
                        return {
                            statusCode: 200,
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                type: 4,
                                data: {
                                    content: '❌ ギルドコマンドの削除に失敗しました: ' + response.status
                                }
                            })
                        };
                    }
                } catch (error) {
                    console.error('Error removing guild commands:', error);
                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 4,
                            data: {
                                content: '❌ ギルドコマンドの削除中にエラーが発生しました: ' + error.message
                            }
                        })
                    };
                }

            default:
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 4,
                        data: {
                            content: 'Unknown command'
                        }
                    })
                };
        }
    }

    return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Unknown interaction type' })
    };
};


function verifySignature(signature, timestamp, body) {
    const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

    if (!PUBLIC_KEY || !signature || !timestamp) {
        return false;
    }

    try {
        return nacl.sign.detached.verify(
            Buffer.from(timestamp + body),
            Buffer.from(signature, 'hex'),
            Buffer.from(PUBLIC_KEY, 'hex')
        );
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}