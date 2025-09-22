const { Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');

async function createWallet(orgName) {
    console.log(`Creating wallet for ${orgName}...`);
    try {
        const orgPath = path.resolve(
            __dirname,
            '..', // Go up one level from log-server to fabric-dev
            'fabric-samples',
            'test-network',
            'organizations',
            'peerOrganizations',
            orgName
        );
        const mspPath = path.join(orgPath, 'users', `Admin@${orgName}`, 'msp');
        
        // Corrected certificate path to use the standard 'cert.pem' filename
        const certPath = path.join(mspPath, 'signcerts', `cert.pem`);

        const keyPath = path.join(mspPath, 'keystore');
        
        // Read certificate and private key
        const cert = fs.readFileSync(certPath).toString();
        const keyFile = fs.readdirSync(keyPath)[0]; // Assuming only one key file
        const key = fs.readFileSync(path.join(keyPath, keyFile)).toString();

        const walletPath = path.join(__dirname, 'wallet', orgName);
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        const identity = {
            credentials: {
                certificate: cert,
                privateKey: key,
            },
            mspId: orgName === 'org1.example.com' ? 'Org1MSP' : 'Org2MSP',
            type: 'X.509',
        };

        await wallet.put('admin', identity);
        console.log(`Successfully created wallet for ${orgName} with admin identity.`);
    } catch (error) {
        console.error(`Error creating wallet for ${orgName}:`, error);
    }
}

async function main() {
    // Remove existing wallet directories to ensure a clean setup
    const walletDir = path.join(__dirname, 'wallet');
    if (fs.existsSync(walletDir)) {
        console.log("Removing old wallets...");
        fs.rmSync(walletDir, { recursive: true, force: true });
    }

    await createWallet('org1.example.com');
    await createWallet('org2.example.com');
}

main();
