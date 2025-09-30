const nacl = require('tweetnacl');
const AWS = require('aws-sdk');
const sqs = new AWS.SQS();

exports.handler = async (event) => {
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
            case 'get-dictionary':
                try {
                    // SQSメッセージを送信して非同期処理を開始
                    const messageBody = {
                        applicationId: interaction.application_id,
                        token: interaction.token,
                        userId: user.id,
                        timestamp: new Date().toISOString()
                    };

                    await sqs.sendMessage({
                        QueueUrl: process.env.DICTIONARY_QUEUE_URL,
                        MessageBody: JSON.stringify(messageBody)
                    }).promise();

                    console.log('Dictionary processing queued for user:', user.id);

                    // 即座に処理開始の応答を返す
                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 5 // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
                        })
                    };
                } catch (error) {
                    console.error('Error in get-dictionary command:', error);
                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 4,
                            data: {
                                content: 'An error occurred while processing the command'
                            }
                        })
                    };
                }

            case 'purge-queue':
                try {
                    // SQSキューをパージ
                    await sqs.purgeQueue({
                        QueueUrl: process.env.DICTIONARY_QUEUE_URL
                    }).promise();

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