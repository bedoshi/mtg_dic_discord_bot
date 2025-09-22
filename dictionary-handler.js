const https = require('https');
const AWS = require('aws-sdk');
const StreamZip = require('node-stream-zip');
const fs = require('fs');
const path = require('path');

const DIC_URL = 'https://whisper.wisdom-guild.net/apps/autodic/d/JT/MS/JE/DICALL_JT_MS_JE_2.txt';

exports.handler = async (event) => {
    console.log('Dictionary handler event received:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.body);
            const { applicationId, token, userId } = message;

            console.log('Processing dictionary request for user:', userId);

            // ZIPファイルをダウンロードして解凍
            const extractedFile = await downloadAndExtractDictionary();
            const fileStats = fs.statSync(extractedFile);

            console.log('Dictionary extraction completed:', {
                file: extractedFile,
                size: fileStats.size
            });

            // Discord Webhookでファイルを添付して送信
            await sendFileToDiscord(applicationId, token, extractedFile,
                `辞書ファイル (${Math.round(fileStats.size / 1024)} KB) を取得しました！`);

            // 一時ファイルを削除
            fs.unlinkSync(extractedFile);
            const zipPath = '/tmp/dictionary.zip';
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
            }

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

function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve(filePath);
            });

            file.on('error', (error) => {
                fs.unlink(filePath, () => {}); // 失敗時にファイルを削除
                reject(error);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

async function downloadAndExtractDictionary() {
    const zipPath = '/tmp/dictionary.zip';
    const extractedPath = '/tmp/dic_jp_en.txt'; // 出力ファイル名を指定

    try {
        // ZIPファイルをダウンロード（URLは.txtだが実際はZIP）
        console.log('Downloading ZIP file...');
        await downloadFile(DIC_URL, zipPath);

        // ZIPファイルを解凍
        console.log('Extracting ZIP file...');
        const zip = new StreamZip.async({ file: zipPath });

        // ZIP内のファイル一覧を取得
        const entries = await zip.entries();
        const fileNames = Object.keys(entries);

        console.log('Files in ZIP:', fileNames);

        // 最初のファイルを抽出
        if (fileNames.length === 0) {
            throw new Error('No files found in ZIP archive');
        }

        const targetFile = fileNames[0]; // 最初のファイルを使用
        console.log('Extracting file:', targetFile, 'as dic_jp_en.txt');

        await zip.extract(targetFile, extractedPath);
        await zip.close();

        return extractedPath;
    } catch (error) {
        // エラー時にファイルをクリーンアップ
        [zipPath, extractedPath].forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        });
        throw error;
    }
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

function sendFileToDiscord(applicationId, token, filePath, content) {
    return new Promise((resolve, reject) => {
        const fileName = path.basename(filePath);
        const fileContent = fs.readFileSync(filePath);

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
        formData += `Content-Disposition: form-data; name="files[0]"; filename="${fileName}"\r\n`;
        formData += 'Content-Type: text/plain\r\n\r\n';

        // 終了境界
        const endBoundary = `\r\n--${boundary}--\r\n`;

        // リクエストボディを構築
        const formDataBuffer = Buffer.from(formData, 'utf8');
        const endBoundaryBuffer = Buffer.from(endBoundary, 'utf8');
        const requestBody = Buffer.concat([formDataBuffer, fileContent, endBoundaryBuffer]);

        const options = {
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10/webhooks/${applicationId}/${token}/messages/@original`,
            method: 'PATCH',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': requestBody.length
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
        req.write(requestBody);
        req.end();
    });
}