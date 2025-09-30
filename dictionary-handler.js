
// Import our modular logic
const { downloadAndExtractDictionary, createDicJpFile, createDicEnFile } = require('./src/dictionaryProcessor');
const { sendFollowupMessage, sendFilesSeparately } = require('./src/discordUtils');
const {
    isMessageProcessed,
    markMessageAsProcessed,
    generateErrorMessage,
    checkFileSizesAndPrepareFiles,
    cleanupTempFiles
} = require('./src/messageProcessor');

exports.handler = async (event) => {
    console.log('Dictionary handler event received:', JSON.stringify(event, null, 2));

    for (const record of event.Records) {
        try {
            const messageId = record.messageId;
            const receiveCount = parseInt(record.attributes.ApproximateReceiveCount || '1');

            // 重複チェック
            if (isMessageProcessed(messageId)) {
                console.log(`Skipping duplicate message ID: ${messageId}`);
                continue;
            }

            // 受信回数が多い場合は警告
            if (receiveCount > 1) {
                console.log(`Message ${messageId} has been received ${receiveCount} times`);
            }

            // メッセージIDを処理済みとして記録
            markMessageAsProcessed(messageId);

            const message = JSON.parse(record.body);
            const { applicationId, token, userId, timestamp } = message;

            // ユーザー+タイムスタンプでの重複チェック
            const requestKey = `${userId}-${timestamp}`;
            if (isMessageProcessed(requestKey)) {
                console.log(`Skipping duplicate request for user ${userId} at ${timestamp}`);
                continue;
            }

            // リクエストキーも処理済みとして記録
            markMessageAsProcessed(requestKey);

            console.log('Processing dictionary request for user:', userId, 'messageId:', messageId, 'timestamp:', timestamp);

            // ZIPファイルをダウンロードして解凍
            const dicJpEnFile = await downloadAndExtractDictionary();

            // dic_jp.txtファイルを作成
            const dicJpFile = await createDicJpFile(dicJpEnFile);

            // dic_en.txtファイルを作成
            const dicEnFile = await createDicEnFile(dicJpEnFile);

            console.log('Dictionary processing completed:', {
                originalFile: dicJpEnFile,
                dicJpFile: dicJpFile,
                dicEnFile: dicEnFile
            });

            // ファイルサイズをチェックして準備
            const { filesToSend, originalStats, dicJpStats, dicEnStats } = checkFileSizesAndPrepareFiles(dicJpEnFile, dicJpFile, dicEnFile);

            // 最初のメッセージで情報を送信
            await sendFollowupMessage(applicationId, token,
                `辞書ファイルを取得しました！\n・dic_jp_en.txt: ${Math.round(originalStats.size / 1024)} KB\n・dic_jp.txt: ${Math.round(dicJpStats.size / 1024)} KB\n・dic_en.txt: ${Math.round(dicEnStats.size / 1024)} KB`);

            // サイズ制限を超えたファイルについて警告メッセージを送信
            const discordMaxSize = 25 * 1024 * 1024;
            if (originalStats.size > discordMaxSize) {
                console.log(`dic_jp_en.txt is too large: ${originalStats.size} bytes`);
                await sendFollowupMessage(applicationId, token,
                    `⚠️ dic_jp_en.txt (${Math.round(originalStats.size / 1024 / 1024)}MB) は25MB制限を超えているため送信できません`);
            }
            if (dicJpStats.size > discordMaxSize) {
                console.log(`dic_jp.txt is too large: ${dicJpStats.size} bytes`);
                await sendFollowupMessage(applicationId, token,
                    `⚠️ dic_jp.txt (${Math.round(dicJpStats.size / 1024 / 1024)}MB) は25MB制限を超えているため送信できません`);
            }
            if (dicEnStats.size > discordMaxSize) {
                console.log(`dic_en.txt is too large: ${dicEnStats.size} bytes`);
                await sendFollowupMessage(applicationId, token,
                    `⚠️ dic_en.txt (${Math.round(dicEnStats.size / 1024 / 1024)}MB) は25MB制限を超えているため送信できません`);
            }

            // 送信可能なファイルがある場合のみ送信
            if (filesToSend.length > 0) {
                await sendFilesSeparately(applicationId, token, filesToSend);
            }

            // 一時ファイルを削除
            cleanupTempFiles([dicJpEnFile, dicJpFile, dicEnFile, '/tmp/dictionary.zip']);

            console.log(`Successfully completed dictionary processing for user ${userId}, messageId: ${messageId}`);

        } catch (error) {
            console.error('Error processing dictionary request:', error);
            console.error('Failed messageId:', record.messageId);

            const message = JSON.parse(record.body);
            const { applicationId, token, userId } = message;

            // エラーの種類に応じたメッセージを送信
            const errorMessage = generateErrorMessage(error);
            await sendFollowupMessage(applicationId, token, errorMessage);
            console.log(`Error message sent to user ${userId} for messageId: ${record.messageId}`);
        }
    }

    return { statusCode: 200, body: 'Processing completed' };
};