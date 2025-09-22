const https = require('https');
const AWS = require('aws-sdk');

const DIC_URL = 'https://whisper.wisdom-guild.net/apps/autodic/d/JT/MS/JE/DICALL_JT_MS_JE_2.txt';

exports.handler = async (event) => {
    console.log('Dictionary handler event received:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.body);
            const { applicationId, token, userId } = message;

            console.log('Processing dictionary request for user:', userId);

            // 辞書データを取得
            const response = await fetchDictionaryWithTimeout(60000);
            const contentType = response.contentType || 'unknown';
            const dataSize = response.data ? response.data.length : 0;

            console.log('Dictionary fetch completed:', { contentType, dataSize });

            // Discord Webhookでフォローアップメッセージを送信
            await sendFollowupMessage(applicationId, token,
                `Dictionary fetch completed!\nContent-Type: ${contentType}\nSize: ${dataSize} characters`);

        } catch (error) {
            console.error('Error processing dictionary request:', error);

            const message = JSON.parse(record.body);
            const { applicationId, token } = message;

            await sendFollowupMessage(applicationId, token,
                'Error fetching dictionary data. Please try again later.');
        }
    }

    return { statusCode: 200, body: 'Processing completed' };
};

function fetchDictionary() {
    return new Promise((resolve, reject) => {
        https.get(DIC_URL, (response) => {
            let data = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                resolve({
                    data: data,
                    contentType: response.headers['content-type']
                });
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

function fetchDictionaryWithTimeout(timeout) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error('Timeout'));
        }, timeout);

        fetchDictionary()
            .then(result => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

function sendFollowupMessage(applicationId, token, content) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ content });

        const options = {
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(responseData);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}