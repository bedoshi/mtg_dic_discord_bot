require('dotenv').config();
const fetch = require('node-fetch');

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const commands = [
    {
        name: 'ping',
        description: 'Ping the bot'
    },
    {
        name: 'hello',
        description: 'Say hello to a user'
    },
    {
        name: 'get-dictionary',
        description: 'MTGの辞書データを取得します。'
    },
    {
        name: 'purge-queue',
        description: '不具合により処理がうまくいかないときに、処理待ちイベントを削除します。'
    }
];

async function registerCommands() {
    if (!APPLICATION_ID || !BOT_TOKEN) {
        console.error('Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN environment variables');
        process.exit(1);
    }

    try {
        // Register global commands
        console.log('Registering global commands...');
        const globalResponse = await fetch(
            `https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(commands)
            }
        );

        if (globalResponse.ok) {
            console.log('Successfully registered global commands');
            const globalData = await globalResponse.json();
            console.log('Global commands:', JSON.stringify(globalData, null, 2));
        } else {
            console.error('Failed to register global commands');
            console.error(globalResponse.status, globalResponse.statusText);
            const errorData = await globalResponse.text();
            console.error(errorData);
        }

        // Register guild commands if GUILD_ID is provided
        if (GUILD_ID) {
            console.log(`Registering guild commands for guild: ${GUILD_ID}...`);
            const guildResponse = await fetch(
                `https://discord.com/api/v10/applications/${APPLICATION_ID}/guilds/${GUILD_ID}/commands`,
                {
                    method: 'PUT',
                    headers: {
                        'Authorization': `Bot ${BOT_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(commands)
                }
            );

            if (guildResponse.ok) {
                console.log('Successfully registered guild commands');
                const guildData = await guildResponse.json();
                console.log('Guild commands:', JSON.stringify(guildData, null, 2));
            } else {
                console.error('Failed to register guild commands');
                console.error(guildResponse.status, guildResponse.statusText);
                const guildErrorData = await guildResponse.text();
                console.error(guildErrorData);
            }
        } else {
            console.log('DISCORD_GUILD_ID not provided, skipping guild commands registration');
        }
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

registerCommands();