const https = require('https');
const fs = require('fs');

/**
 * Downloads a file from the given URL to the specified file path
 * @param {string} url - The URL to download from
 * @param {string} filePath - The local file path to save to
 * @returns {Promise<string>} - Resolves with the file path on success
 */
function downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(filePath);

        const timeout = setTimeout(() => {
            file.destroy();
            reject(new Error('Download timeout after 300 seconds'));
        }, 300000); // 5分タイムアウト

        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                clearTimeout(timeout);
                reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                clearTimeout(timeout);
                file.close();
                resolve(filePath);
            });

            file.on('error', (error) => {
                clearTimeout(timeout);
                fs.unlink(filePath, () => {}); // 失敗時にファイルを削除
                reject(error);
            });
        }).on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

module.exports = {
    downloadFile
};