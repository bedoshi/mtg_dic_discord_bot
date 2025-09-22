const nacl = require('tweetnacl');
const https = require('https');
const url = require('url');
const DIC_URL = 'https://whisper.wisdom-guild.net/apps/autodic/d/JT/MS/JE/DICALL_JT_MS_JE_2.txt'

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event, null, 2));

    const signature = event.headers['x-signature-ed25519'] || event.headers['X-Signature-Ed25519'];
    const timestamp = event.headers['x-signature-timestamp'] || event.headers['X-Signature-Timestamp'];
    const body = event.body;

    console.log('Headers:', JSON.stringify(event.headers, null, 2));
    console.log('Signature:', signature);
    console.log('Timestamp:', timestamp);

    if (!verifySignature(signature, timestamp, body)) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid signature' })
        };
    }

    const interaction = JSON.parse(body);

    if (interaction.type === 1) {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 1 })
        };
    }

    if (interaction.type === 2) {
        const commandName = interaction.data.name;
        const user = interaction.member?.user || interaction.user;
        switch (commandName) {
            case 'ping':
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 4,
                        data: {
                            content: 'Pong! 🏓'
                        }
                    })
                };

            case 'hello':
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 4,
                        data: {
                            content: `Hello, ${user.username}! 👋`
                        }
                    })
                };
            case 'get-dictionaly':
                try {
                    const response = await fetchDictionary();
                    const parsedUrl = url.parse(DIC_URL);
                    const extension = parsedUrl.pathname.split('.').pop();

                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 4,
                            data: {
                                content: `Dictionary file extension: .${extension}`
                            }
                        })
                    };
                } catch (error) {
                    console.error('Error fetching dictionary:', error);
                    return {
                        statusCode: 200,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            type: 4,
                            data: {
                                content: 'Error fetching dictionary file'
                            }
                        })
                    };
                }

            default:
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 4,
                        data: {
                            content: 'Unknown command'
                        }
                    })
                };
        }
    }

    return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Unknown interaction type' })
    };
};

function fetchDictionary() {
    return new Promise((resolve, reject) => {
        https.get(DIC_URL, (response) => {
            let data = '';

            response.on('data', chunk => {
                data += chunk;
            });

            response.on('end', () => {
                resolve(data);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

function verifySignature(signature, timestamp, body) {
    const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

    if (!PUBLIC_KEY || !signature || !timestamp) {
        return false;
    }

    try {
        return nacl.sign.detached.verify(
            Buffer.from(timestamp + body),
            Buffer.from(signature, 'hex'),
            Buffer.from(PUBLIC_KEY, 'hex')
        );
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}