const fs = require('fs');

// 処理済みメッセージIDを保存するセット（Lambda実行中のみ）
const processedMessageIds = new Set();

/**
 * Checks if a message ID has already been processed
 * @param {string} messageId - The message ID to check
 * @returns {boolean} - True if already processed
 */
function isMessageProcessed(messageId) {
    return processedMessageIds.has(messageId);
}

/**
 * Marks a message ID as processed
 * @param {string} messageId - The message ID to mark as processed
 */
function markMessageAsProcessed(messageId) {
    processedMessageIds.add(messageId);
}

/**
 * Generates an error message based on the error type
 * @param {Error} error - The error object
 * @returns {string} - Localized error message
 */
function generateErrorMessage(error) {
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

    return errorMessage;
}

/**
 * Checks file sizes and determines which files can be sent via Discord
 * @param {string} dicJpEnFile - Path to JP-EN dictionary file
 * @param {string} dicJpFile - Path to JP dictionary file
 * @param {string} dicEnFile - Path to EN dictionary file
 * @returns {Array<{path: string, name: string}>} - Array of files that can be sent
 */
function checkFileSizesAndPrepareFiles(dicJpEnFile, dicJpFile, dicEnFile) {
    const discordMaxSize = 25 * 1024 * 1024; // 25MB Discord制限
    const filesToSend = [];

    // Get file stats
    const originalStats = fs.statSync(dicJpEnFile);
    const dicJpStats = fs.statSync(dicJpFile);
    const dicEnStats = fs.statSync(dicEnFile);

    // Check each file
    if (originalStats.size <= discordMaxSize) {
        filesToSend.push({ path: dicJpEnFile, name: 'dic_jp_en.txt' });
    }

    if (dicJpStats.size <= discordMaxSize) {
        filesToSend.push({ path: dicJpFile, name: 'dic_jp.txt' });
    }

    if (dicEnStats.size <= discordMaxSize) {
        filesToSend.push({ path: dicEnFile, name: 'dic_en.txt' });
    }

    return { filesToSend, originalStats, dicJpStats, dicEnStats };
}

/**
 * Cleans up temporary files
 * @param {Array<string>} filePaths - Array of file paths to delete
 */
function cleanupTempFiles(filePaths) {
    filePaths.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });
}

module.exports = {
    isMessageProcessed,
    markMessageAsProcessed,
    generateErrorMessage,
    checkFileSizesAndPrepareFiles,
    cleanupTempFiles
};