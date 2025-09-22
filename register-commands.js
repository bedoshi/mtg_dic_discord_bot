const fetch = require('node-fetch');

const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

const commands = [
    {
        name: 'ping',
        description: 'Ping the bot'
    },
    {
        name: 'hello',
        description: 'Say hello to a user'
    }
];

async function registerCommands() {
    if (!APPLICATION_ID || !BOT_TOKEN) {
        console.error('Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN environment variables');
        process.exit(1);
    }

    try {
        const response = await fetch(
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

        if (response.ok) {
            console.log('Successfully registered commands');
            const data = await response.json();
            console.log(JSON.stringify(data, null, 2));
        } else {
            console.error('Failed to register commands');
            console.error(response.status, response.statusText);
            const errorData = await response.text();
            console.error(errorData);
        }
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

registerCommands();