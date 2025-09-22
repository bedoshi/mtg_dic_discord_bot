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

// 処理済みメッセージIDを保存するセット（Lambda実行中のみ）
const processedMessageIds = new Set();

exports.handler = async (event) => {
    console.log('Dictionary handler event received:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const messageId = record.messageId;
            const receiveCount = parseInt(record.attributes.ApproximateReceiveCount || '1');

            // 重複チェック
            if (processedMessageIds.has(messageId)) {
                console.log(`Skipping duplicate message ID: ${messageId}`);
                continue;
            }

            // 受信回数が多い場合は警告
            if (receiveCount > 1) {
                console.log(`Message ${messageId} has been received ${receiveCount} times`);
            }

            // メッセージIDを処理済みとして記録
            processedMessageIds.add(messageId);

            const message = JSON.parse(record.body);
            const { applicationId, token, userId, timestamp } = message;

            // ユーザー+タイムスタンプでの重複チェック
            const requestKey = `${userId}-${timestamp}`;
            if (processedMessageIds.has(requestKey)) {
                console.log(`Skipping duplicate request for user ${userId} at ${timestamp}`);
                continue;
            }

            // リクエストキーも処理済みとして記録
            processedMessageIds.add(requestKey);

            console.log('Processing dictionary request for user:', userId, 'messageId:', messageId, 'timestamp:', timestamp);

            // ZIPファイルをダウンロードして解凍
            const dicJpEnFile = await downloadAndExtractDictionary();

            // dic_jp.txtファイルを作成
            const dicJpFile = await createDicJpFile(dicJpEnFile);

            // dic_en.txtファイルを作成
            const dicEnFile = await createDicEnFile(dicJpEnFile);

            const dicJpStats = fs.statSync(dicJpFile);
            const dicEnStats = fs.statSync(dicEnFile);

            console.log('Dictionary processing completed:', {
                originalFile: dicJpEnFile,
                dicJpFile: dicJpFile,
                dicEnFile: dicEnFile,
                dicJpSize: dicJpStats.size,
                dicEnSize: dicEnStats.size
            });

            // ファイルサイズをチェックして分割送信
            const originalStats = fs.statSync(dicJpEnFile);

            // 最初のメッセージで情報を送信
            await sendFollowupMessage(applicationId, token,
                `辞書ファイルを取得しました！\n・dic_jp_en.txt: ${Math.round(originalStats.size / 1024)} KB\n・dic_jp.txt: ${Math.round(dicJpStats.size / 1024)} KB\n・dic_en.txt: ${Math.round(dicEnStats.size / 1024)} KB`);

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
            if (dicJpStats.size <= discordMaxSize) {
                filesToSend.push({ path: dicJpFile, name: 'dic_jp.txt' });
            } else {
                console.log(`dic_jp.txt is too large: ${dicJpStats.size} bytes`);
                await sendFollowupMessage(applicationId, token,
                    `⚠️ dic_jp.txt (${Math.round(dicJpStats.size / 1024 / 1024)}MB) は25MB制限を超えているため送信できません`);
            }

            // dic_en.txt をチェック
            if (dicEnStats.size <= discordMaxSize) {
                filesToSend.push({ path: dicEnFile, name: 'dic_en.txt' });
            } else {
                console.log(`dic_en.txt is too large: ${dicEnStats.size} bytes`);
                await sendFollowupMessage(applicationId, token,
                    `⚠️ dic_en.txt (${Math.round(dicEnStats.size / 1024 / 1024)}MB) は25MB制限を超えているため送信できません`);
            }

            // 送信可能なファイルがある場合のみ送信
            if (filesToSend.length > 0) {
                await sendFilesSeparately(applicationId, token, filesToSend);
            }

            // 一時ファイルを削除
            fs.unlinkSync(dicJpEnFile);
            fs.unlinkSync(dicJpFile);
            fs.unlinkSync(dicEnFile);
            const zipPath = '/tmp/dictionary.zip';
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
            }

            console.log(`Successfully completed dictionary processing for user ${userId}, messageId: ${messageId}`);

        } catch (error) {
            console.error('Error processing dictionary request:', error);
            console.error('Failed messageId:', record.messageId);

            const message = JSON.parse(record.body);
            const { applicationId, token, userId } = message;

            // エラーの種類に応じたメッセージを送信
            let errorMessage = 'Error fetching dictionary data. Please try again later.';

            if (error.message && error.message.includes('Runtime.OutOfMemory')) {
                errorMessage = '⚠️ メモリ不足が発生しました。辞書ファイルが大きすぎるため、処理を完了できませんでした。しばらく後に再試行してください。';
            } else if (error.message && error.message.includes('ENOENT')) {
                errorMessage = '📁 辞書ファイルが見つかりません。ダウンロードに失敗した可能性があります。';
            } else if (error.message && error.message.includes('timeout')) {
                errorMessage = '⏱️ 処理がタイムアウトしました。辞書ファイルが大きいため時間がかかっています。';
            } else if (error.code === 'EMFILE' || error.code === 'ENFILE') {
                errorMessage = '🔧 システムリソースが不足しています。しばらく後に再試行してください。';
            }

            await sendFollowupMessage(applicationId, token, errorMessage);
            console.log(`Error message sent to user ${userId} for messageId: ${record.messageId}`);
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
        console.log('Processing dictionary file with proper Shift-JIS handling...');

        const originalStats = fs.statSync(originalFile);
        console.log(`Original file size: ${originalStats.size} bytes`);

        // ファイル全体をバイナリで読み込み
        const buffer = fs.readFileSync(originalFile);
        console.log(`Original buffer size: ${buffer.length} bytes`);

        // Shift-JISバイナリデータをデコード
        let content;
        if (iconv) {
            content = iconv.decode(buffer, 'shift_jis');
            console.log('Using iconv-lite for Shift-JIS conversion');
        } else {
            // フォールバック: UTF-8として読み込み
            content = buffer.toString('utf8');
            console.log('Using UTF-8 fallback for encoding');
        }
        console.log(`Content length: ${content.length} characters`);

        // 各行を処理（チャンクで分割してメモリ使用量を抑制）
        const lines = content.split('\n');
        const outputStream = fs.createWriteStream(outputFile);

        let processedLines = 0;
        const chunkSize = 1000; // 1000行ずつ処理

        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);

            const processedChunk = chunk.map(line => {
                if (iconv) {
                    // 正しい日本語文字を使用
                    let processed = line.replace(/《/g, ''); // 《を削除
                    processed = processed.replace(/\/.*》/g, ''); // /から》まで削除
                    return processed;
                } else {
                    // UTF-8フォールバック
                    let processed = line.replace(/《/g, ''); // 《を削除
                    processed = processed.replace(/\/.*》/g, ''); // /から》まで削除
                    return processed;
                }
            });

            // チャンクを書き込み
            const chunkContent = processedChunk.join('\n') + (i + chunkSize < lines.length ? '\n' : '');
            const outputBuffer = iconv ? iconv.encode(chunkContent, 'shift_jis') : Buffer.from(chunkContent, 'utf8');
            outputStream.write(outputBuffer);

            processedLines += chunk.length;

            // 進捗ログ
            if (processedLines % 10000 === 0 || i + chunkSize >= lines.length) {
                console.log(`Processed ${processedLines} lines`);
            }

            // メモリを解放
            if (i % 10000 === 0 && global.gc) {
                global.gc();
            }
        }

        outputStream.end();

        // ストリーム終了を待機
        await new Promise((resolve, reject) => {
            outputStream.on('finish', resolve);
            outputStream.on('error', reject);
        });

        const processedStats = fs.statSync(outputFile);
        console.log(`Processed file size: ${processedStats.size} bytes`);
        console.log(`Size change: ${processedStats.size - originalStats.size} bytes`);
        console.log(`Total lines processed: ${processedLines}`);

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

async function createDicEnFile(originalFile) {
    const outputFile = '/tmp/dic_en.txt';

    try {
        console.log('Processing dictionary file for English with proper Shift-JIS handling...');

        const originalStats = fs.statSync(originalFile);
        console.log(`Original file size: ${originalStats.size} bytes`);

        // ファイル全体をバイナリで読み込み
        const buffer = fs.readFileSync(originalFile);
        console.log(`Original buffer size: ${buffer.length} bytes`);

        // Shift-JISバイナリデータをデコード
        let content;
        if (iconv) {
            content = iconv.decode(buffer, 'shift_jis');
            console.log('Using iconv-lite for Shift-JIS conversion');
        } else {
            // フォールバック: UTF-8として読み込み
            content = buffer.toString('utf8');
            console.log('Using UTF-8 fallback for encoding');
        }
        console.log(`Content length: ${content.length} characters`);

        // 各行を処理（チャンクで分割してメモリ使用量を抑制）
        const lines = content.split('\n');
        const outputStream = fs.createWriteStream(outputFile);

        let processedLines = 0;
        const chunkSize = 1000; // 1000行ずつ処理

        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);

            const processedChunk = chunk.map(line => {
                if (iconv) {
                    // 正しい日本語文字を使用
                    let processed = line.replace(/《.*\//g, ''); // 《から/まで削除
                    processed = processed.replace(/》/g, ''); // 》を削除
                    return processed;
                } else {
                    // UTF-8フォールバック
                    let processed = line.replace(/《.*\//g, ''); // 《から/まで削除
                    processed = processed.replace(/》/g, ''); // 》を削除
                    return processed;
                }
            });

            // チャンクを書き込み
            const chunkContent = processedChunk.join('\n') + (i + chunkSize < lines.length ? '\n' : '');
            const outputBuffer = iconv ? iconv.encode(chunkContent, 'shift_jis') : Buffer.from(chunkContent, 'utf8');
            outputStream.write(outputBuffer);

            processedLines += chunk.length;

            // 進捗ログ
            if (processedLines % 10000 === 0 || i + chunkSize >= lines.length) {
                console.log(`Processed ${processedLines} lines`);
            }

            // メモリを解放
            if (i % 10000 === 0 && global.gc) {
                global.gc();
            }
        }

        outputStream.end();

        // ストリーム終了を待機
        await new Promise((resolve, reject) => {
            outputStream.on('finish', resolve);
            outputStream.on('error', reject);
        });

        const processedStats = fs.statSync(outputFile);
        console.log(`Processed file size: ${processedStats.size} bytes`);
        console.log(`Size change: ${processedStats.size - originalStats.size} bytes`);
        console.log(`Total lines processed: ${processedLines}`);

        console.log('Dictionary processing for English completed');
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