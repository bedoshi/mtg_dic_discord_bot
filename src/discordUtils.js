const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Sends a followup message to Discord
 * @param {string} applicationId - Discord application ID
 * @param {string} token - Discord interaction token
 * @param {string} content - Message content to send
 * @returns {Promise<string>} - Response data from Discord
 */
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

/**
 * Sends a followup message with file attachment to Discord
 * @param {string} applicationId - Discord application ID
 * @param {string} token - Discord interaction token
 * @param {string} content - Message content to send
 * @param {string} filename - Path to file to attach
 * @returns {Promise<string>} - Response data from Discord
 */
function sendFollowupFileMessage(applicationId, token, content, filename) {
    return new Promise((resolve, reject) => {
        const fileContent = fs.readFileSync(filename);
        const basename = path.basename(filename);

        // multipart/form-data の境界文字列
        const boundary = '----formdata-discord-' + Math.random().toString(36);

        // フォームデータを構築
        let formData = '';

        // コンテンツ部分
        formData += `--${boundary}\r\n`;
        formData += 'Content-Disposition: form-data; name="content"\r\n\r\n';
        formData += content + '\r\n';

        // ファイル部分のヘッダー
        formData += `--${boundary}\r\n`;
        formData += `Content-Disposition: form-data; name="files[0]"; filename="${basename}"\r\n`;
        formData += 'Content-Type: text/plain\r\n\r\n';

        // 終了境界
        const endBoundary = `\r\n--${boundary}--\r\n`;

        // リクエストボディを構築
        const formDataBuffer = Buffer.from(formData, 'utf8');
        const endBoundaryBuffer = Buffer.from(endBoundary, 'utf8');
        const requestBody = Buffer.concat([formDataBuffer, fileContent, endBoundaryBuffer]);

        // タイムアウト設定
        const timeout = setTimeout(() => {
            req.destroy();
            reject(new Error('Discord upload timeout after 120 seconds'));
        }, 120000); // 2分タイムアウト

        const options = {
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10/webhooks/${applicationId}/${token}`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': requestBody.length
            },
            timeout: 120000 // 2分タイムアウト
        };

        const req = https.request(options, (res) => {
            clearTimeout(timeout);

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

        req.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        req.on('timeout', () => {
            clearTimeout(timeout);
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * Sends multiple files separately as Discord messages
 * @param {string} applicationId - Discord application ID
 * @param {string} token - Discord interaction token
 * @param {Array<{path: string, name: string}>} files - Array of file objects to send
 * @returns {Promise<void>}
 */
async function sendFilesSeparately(applicationId, token, files) {
    for (const file of files) {
        try {
            console.log(`Sending file: ${file.name}`);
            await sendFollowupFileMessage(applicationId, token, `📎 ${file.name}`, file.path);
            console.log(`Successfully sent: ${file.name}`);
        } catch (error) {
            console.error(`Failed to send file ${file.name}:`, error);
            // エラーが発生してもフォールバックメッセージを送信
            await sendFollowupMessage(applicationId, token,
                `❌ ${file.name} の送信に失敗しました: ${error.message}`);
        }
    }
}

module.exports = {
    sendFollowupMessage,
    sendFollowupFileMessage,
    sendFilesSeparately
};