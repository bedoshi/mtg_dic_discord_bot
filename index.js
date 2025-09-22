const nacl = require('tweetnacl');

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