const https = require('https');
const AWS = require('aws-sdk');
const StreamZip = require('node-stream-zip');
const fs = require('fs');
const path = require('path');

// iconv-liteがエラーの場合はfallbackとしてBuffer.from/toStringを使用
let iconv;
try {
    iconv = require('iconv-lite');
} catch (error) {
    console.log('iconv-lite not available, using fallback encoding');
    iconv = null;
}

const DIC_URL = 'https://whisper.wisdom-guild.net/apps/autodic/d/JT/MS/JE/DICALL_JT_MS_JE_2.txt';

exports.handler = async (event) => {
    console.log('Dictionary handler event received:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const message = JSON.parse(record.body);
            const { applicationId, token, userId } = message;

            console.log('Processing dictionary request for user:', userId);

            // ZIPファイルをダウンロードして解凍
            const dicJpEnFile = await downloadAndExtractDictionary();

            // dic_jp.txtファイルを作成
            const dicJpFile = await createDicJpFile(dicJpEnFile);

            const fileStats = fs.statSync(dicJpFile);

            console.log('Dictionary processing completed:', {
                originalFile: dicJpEnFile,
                processedFile: dicJpFile,
                size: fileStats.size
            });

            // ファイルサイズをチェックして分割送信
            const originalStats = fs.statSync(dicJpEnFile);
            const maxSize = 8 * 1024 * 1024; // 8MB

            // 最初のメッセージで情報を送信
            await sendFollowupMessage(applicationId, token,
                `辞書ファイルを取得しました！\n・dic_jp_en.txt: ${Math.round(originalStats.size / 1024)} KB\n・dic_jp.txt: ${Math.round(fileStats.size / 1024)} KB`);

            // ファイルサイズをチェック
            const discordMaxSize = 25 * 1024 * 1024; // 25MB Discord制限
            const filesToSend = [];

            // dic_jp_en.txt をチェック
            if (originalStats.size <= discordMaxSize) {
                filesToSend.push({ path: dicJpEnFile, name: 'dic_jp_en.txt' });
            } else {
                console.log(`dic_jp_en.txt is too large: ${originalStats.size} bytes`);
                await sendFollowupMessage(applicationId, token,
                    `⚠️ dic_jp_en.txt (${Math.round(originalStats.size / 1024 / 1024)}MB) は25MB制限を超えているため送信できません`);
            }

            // dic_jp.txt をチェック
            if (fileStats.size <= discordMaxSize) {
                filesToSend.push({ path: dicJpFile, name: 'dic_jp.txt' });
            } else {
                console.log(`dic_jp.txt is too large: ${fileStats.size} bytes`);
                await sendFollowupMessage(applicationId, token,
                    `⚠️ dic_jp.txt (${Math.round(fileStats.size / 1024 / 1024)}MB) は25MB制限を超えているため送信できません`);
            }

            // 送信可能なファイルがある場合のみ送信
            if (filesToSend.length > 0) {
                await sendFilesSeparately(applicationId, token, filesToSend);
            }

            // 一時ファイルを削除
            fs.unlinkSync(dicJpEnFile);
            fs.unlinkSync(dicJpFile);
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

async function createDicJpFile(originalFile) {
    const outputFile = '/tmp/dic_jp.txt';

    try {
        console.log('Processing dictionary file...');

        const originalStats = fs.statSync(originalFile);
        console.log(`Original file size: ${originalStats.size} bytes`);

        // ファイルをShift-JIS（バイナリ）で読み込み
        const buffer = fs.readFileSync(originalFile);
        console.log(`Original buffer size: ${buffer.length} bytes`);

        // Shift-JISバイナリデータをデコード
        let content;
        if (iconv) {
            // iconv-liteを使用
            content = iconv.decode(buffer, 'shift_jis');
            console.log('Using iconv-lite for Shift-JIS conversion');
        } else {
            // フォールバック: latin1エンコーディングを使用
            content = buffer.toString('latin1');
            console.log('Using latin1 fallback for encoding');
        }
        console.log(`Content length: ${content.length} characters`);

        // 各行を処理
        const processedLines = content.split('\n').map(line => {
            if (iconv) {
                // 正しい日本語文字を使用
                let processed = line.replace(/《/g, ''); // 《を削除
                processed = processed.replace(/\/.*》/g, ''); // /から》まで削除
                return processed;
            } else {
                // latin1フォールバック: バイト列で処理
                let processed = line.replace(/ã/g, ''); // 《(0x81A1)を削除
                processed = processed.replace(/\/.*ä/g, ''); // /から》(0x81A2)まで削除
                return processed;
            }
        });

        const processedContent = processedLines.join('\n');
        console.log(`Processed content length: ${processedContent.length} characters`);

        // 処理済みの内容を書き込み
        if (iconv) {
            const outputBuffer = iconv.encode(processedContent, 'shift_jis');
            fs.writeFileSync(outputFile, outputBuffer);
        } else {
            fs.writeFileSync(outputFile, processedContent, 'latin1');
        }

        const processedStats = fs.statSync(outputFile);
        console.log(`Processed file size: ${processedStats.size} bytes`);
        console.log(`Size change: ${processedStats.size - originalStats.size} bytes`);

        console.log('Dictionary processing completed');
        return outputFile;

    } catch (error) {
        // エラー時にファイルをクリーンアップ
        if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
        }
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

function sendMultipleFilesToDiscord(applicationId, token, filePaths, content) {
    return new Promise((resolve, reject) => {
        // multipart/form-data の境界文字列
        const boundary = '----formdata-discord-' + Math.random().toString(36);

        // フォームデータを構築
        let formData = '';

        // コンテンツ部分
        formData += `--${boundary}\r\n`;
        formData += 'Content-Disposition: form-data; name="content"\r\n\r\n';
        formData += content + '\r\n';

        // リクエストボディを構築
        const formDataHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${content}\r\n`, 'utf8');
        const bufferParts = [formDataHeader];

        filePaths.forEach((filePath, index) => {
            const fileName = path.basename(filePath);
            const fileContent = fs.readFileSync(filePath);

            const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[${index}]"; filename="${fileName}"\r\nContent-Type: text/plain\r\n\r\n`, 'utf8');
            bufferParts.push(fileHeader);
            bufferParts.push(fileContent);
            bufferParts.push(Buffer.from('\r\n', 'utf8'));
        });

        bufferParts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
        const requestBody = Buffer.concat(bufferParts);

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

        const options = {
            hostname: 'discord.com',
            port: 443,
            path: `/api/v10/webhooks/${applicationId}/${token}`,
            method: 'POST',
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