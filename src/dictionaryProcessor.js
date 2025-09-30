const StreamZip = require('node-stream-zip');
const fs = require('fs');
const { downloadFile } = require('./fileUtils');

// iconv-liteがエラーの場合はfallbackとしてBuffer.from/toStringを使用
let iconv;
try {
    iconv = require('iconv-lite');
} catch (error) {
    console.log('iconv-lite not available, using fallback encoding');
    iconv = null;
}

const DIC_URL = 'https://whisper.wisdom-guild.net/apps/autodic/d/JT/MS/JE/DICALL_JT_MS_JE_2.txt';

/**
 * Downloads and extracts the dictionary ZIP file
 * @returns {Promise<string>} - Path to the extracted dictionary file
 */
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

        const entries = await zip.entries();
        const fileNames = Object.keys(entries);

        if (fileNames.length === 0) {
            throw new Error('No files found in ZIP archive');
        }

        const targetFile = fileNames[0]; // 最初のファイルを使用
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

/**
 * Creates a Japanese-only dictionary file by processing the original file
 * @param {string} originalFile - Path to the original dictionary file
 * @returns {Promise<string>} - Path to the created Japanese dictionary file
 */
async function createDicJpFile(originalFile) {
    const outputFile = '/tmp/dic_jp.txt';

    try {
        console.log('Processing dictionary file with proper Shift-JIS handling...');

        // ファイル全体をバイナリで読み込み
        const buffer = fs.readFileSync(originalFile);

        // Shift-JISバイナリデータをデコード
        let content;
        if (iconv) {
            content = iconv.decode(buffer, 'shift_jis');
        } else {
            // フォールバック: UTF-8として読み込み
            content = buffer.toString('utf8');
        };

        // 各行を処理（チャンクで分割してメモリ使用量を抑制）
        const lines = content.split('\n');
        const outputStream = fs.createWriteStream(outputFile);

        let processedLines = 0;
        const chunkSize = 1000; // 1000行ずつ処理

        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);

            const processedChunk = chunk.map(line => {
                // 正しい日本語文字を使用
                let processed = line.replace(/《/g, ''); // 《を削除
                processed = processed.replace(/\/.*》/g, ''); // /から》まで削除
                return processed;
            });

            // チャンクを書き込み
            const chunkContent = processedChunk.join('\n') + (i + chunkSize < lines.length ? '\n' : '');
            const outputBuffer = iconv ? iconv.encode(chunkContent, 'shift_jis') : Buffer.from(chunkContent, 'utf8');
            outputStream.write(outputBuffer);

            processedLines += chunk.length;

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

/**
 * Creates an English-only dictionary file by processing the original file
 * @param {string} originalFile - Path to the original dictionary file
 * @returns {Promise<string>} - Path to the created English dictionary file
 */
async function createDicEnFile(originalFile) {
    const outputFile = '/tmp/dic_en.txt';

    try {
        console.log('Processing dictionary file for English with proper Shift-JIS handling...');

        // ファイル全体をバイナリで読み込み
        const buffer = fs.readFileSync(originalFile);

        // Shift-JISバイナリデータをデコード
        let content;
        if (iconv) {
            content = iconv.decode(buffer, 'shift_jis');
        } else {
            // フォールバック: UTF-8として読み込み
            content = buffer.toString('utf8');
        };

        // 各行を処理（チャンクで分割してメモリ使用量を抑制）
        const lines = content.split('\n');
        const outputStream = fs.createWriteStream(outputFile);

        let processedLines = 0;
        const chunkSize = 1000; // 1000行ずつ処理

        for (let i = 0; i < lines.length; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize);

            const processedChunk = chunk.map(line => {
                // 正しい日本語文字を使用
                let processed = line.replace(/《.*\//g, ''); // 《から/まで削除
                processed = processed.replace(/》/g, ''); // 》を削除
                return processed;
            });

            // チャンクを書き込み
            const chunkContent = processedChunk.join('\n') + (i + chunkSize < lines.length ? '\n' : '');
            const outputBuffer = iconv ? iconv.encode(chunkContent, 'shift_jis') : Buffer.from(chunkContent, 'utf8');
            outputStream.write(outputBuffer);

            processedLines += chunk.length;

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

module.exports = {
    downloadAndExtractDictionary,
    createDicJpFile,
    createDicEnFile
};