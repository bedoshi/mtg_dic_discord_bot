const crypto = require('crypto');

exports.handler = async (event) => {
    console.log('Event received:', JSON.stringify(event, null, 2));

    const signature = event.headers['x-signature-ed25519'];
    const timestamp = event.headers['x-signature-timestamp'];
    const body = event.body;

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
                const user = interaction.member?.user || interaction.user;
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

function verifySignature(signature, timestamp, body) {
    const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;

    if (!PUBLIC_KEY || !signature || !timestamp) {
        return false;
    }

    try {
        const isVerified = crypto.verify(
            'ed25519',
            Buffer.from(timestamp + body),
            {
                key: Buffer.from(PUBLIC_KEY, 'hex'),
                format: 'der',
                type: 'spki'
            },
            Buffer.from(signature, 'hex')
        );

        return isVerified;
    } catch (error) {
        console.error('Signature verification failed:', error);
        return false;
    }
}