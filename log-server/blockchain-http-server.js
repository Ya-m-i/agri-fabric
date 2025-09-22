const express = require('express');
const cors = require('cors');
const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3002;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage fallback
let claimsLogs = [];

const ORG1_NAME = 'org1.example.com';
const ORG2_NAME = 'org2.example.com';
const CHANNEL_NAME = 'mychannel';
const CONTRACT_NAME = 'logcc';

// Gateway and contract objects for each organization
const orgConnections = {};

// Function to initialize a specific organization's Fabric connection
async function initializeFabricForOrg(orgName) {
    try {
        const gateway = new Gateway();

        // Corrected path to point to the fabric-samples/test-network directory
        // __dirname is ~/fabric-dev/log-server
        // '..' goes up to ~/fabric-dev
        // 'fabric-samples' goes into fabric-samples
        // 'test-network' goes into test-network
        const ccpPath = path.resolve(
            __dirname,
            '..',
            'fabric-samples',
            'test-network',
            'organizations',
            'peerOrganizations',
            orgName,
            `connection-${orgName.split('.')[0]}.json` // Only use the 'org1' or 'org2' part
        );
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        // Load the wallet for the organization
        const walletPath = path.join(__dirname, 'wallet', orgName);
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        const identity = await wallet.get('admin');
        if (!identity) {
            throw new Error(`Admin identity not found in wallet for ${orgName}`);
        }

        // Connection options
        const connectionOptions = {
            wallet,
            identity: 'admin',
            discovery: {
                enabled: false,
                asLocalhost: true
            },
            eventHandlerOptions: {
                commitTimeout: 100,
            },
            queryHandlerOptions: {
                timeout: 60,
            }
        };

        // Connect
        await gateway.connect(ccp, connectionOptions);
        const network = await gateway.getNetwork(CHANNEL_NAME);
        const contract = network.getContract(CONTRACT_NAME);

        // Corrected template literal syntax
        console.log(`✅ Connected to Fabric for ${orgName}!`);
        return { gateway, contract };
    } catch (error) {
        console.error(`❌ Failed to connect to Fabric for ${orgName}:`, error.message);
        return { gateway: null, contract: null };
    }
}

// Updated initialization function to handle multiple organizations
async function initializeFabric() {
    orgConnections[ORG1_NAME] = await initializeFabricForOrg(ORG1_NAME);
    orgConnections[ORG2_NAME] = await initializeFabricForOrg(ORG2_NAME);
    
    // Check if at least one connection succeeded to decide on fallback
    const hasFabricConnection = Object.values(orgConnections).some(conn => conn.contract !== null);
    if (!hasFabricConnection) {
        console.log('⚠️ Falling back to in-memory storage due to Fabric connection failure');
    }
}

// Submit transaction for a specific org
async function submitTransaction(orgName, functionName, ...args) {
    const { contract } = orgConnections[orgName] || {};
    if (!contract) throw new Error(`Contract for ${orgName} not available`);
    return await contract.submitTransaction(functionName, ...args);
}

// Evaluate transaction for a specific org
async function evaluateTransaction(orgName, functionName, ...args) {
    const { contract } = orgConnections[orgName] || {};
    if (!contract) throw new Error(`Contract for ${orgName} not available`);
    return await contract.evaluateTransaction(functionName, ...args);
}

// Routes
app.get('/api/claims-logs/:org', async (req, res) => {
    try {
        const orgName = req.params.org;
        console.log(`📋 Fetching claims logs for ${orgName} from blockchain...`);

        if (orgConnections[orgName] && orgConnections[orgName].contract) {
            console.log(`🔍 Querying blockchain for all claim logs using ${orgName} credentials...`);
            const result = await evaluateTransaction(orgName, 'QueryAllClaimLogs');
            const logs = JSON.parse(result.toString());
            console.log(`✅ Retrieved ${logs.length} claim logs from blockchain via ${orgName}`);
            res.json(logs);
        } else {
            console.log('📋 Fetching claims logs from local storage...');
            res.json(claimsLogs);
        }
    } catch (error) {
        console.error('❌ Error fetching claims logs:', error);
        res.status(500).json({
            error: 'Failed to fetch claims logs',
            details: error.message
        });
    }
});

app.post('/api/claims-logs/:org', async (req, res) => {
    try {
        const orgName = req.params.org;
        const claimLog = req.body;
        console.log(`📝 Received claim log for ${orgName}:`, claimLog);

        if (!claimLog.claimId || !claimLog.farmerName || !claimLog.cropType || !claimLog.status) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['claimId', 'farmerName', 'cropType', 'status']
            });
        }

        if (orgConnections[orgName] && orgConnections[orgName].contract) {
            console.log(`📝 Adding claim log to blockchain using ${orgName} credentials...`);
            const result = await submitTransaction(
                orgName,
                'AddClaimLog',
                claimLog.claimId,
                claimLog.farmerName,
                claimLog.cropType,
                claimLog.timestamp || new Date().toISOString(),
                claimLog.status
            );
            const response = result.toString() ? JSON.parse(result.toString()) : {};
            console.log(`✅ Successfully added claim log to blockchain via ${orgName}`);
            res.json(response);
        } else {
            console.log('📝 Adding claim log to local storage...');
            claimLog.id = Date.now().toString();
            claimLog.timestamp = claimLog.timestamp || new Date().toISOString();
            claimLog.createdAt = claimLog.createdAt || new Date().toISOString();
            claimsLogs.push(claimLog);
            console.log('✅ Successfully added claim log to local storage');
            res.json(claimLog);
        }
    } catch (error) {
        console.error('❌ Error adding claim log:', error);
        res.status(500).json({
            error: 'Failed to add claim log',
            details: error.message
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        fabricConnectedOrg1: !!(orgConnections[ORG1_NAME] && orgConnections[ORG1_NAME].contract),
        fabricConnectedOrg2: !!(orgConnections[ORG2_NAME] && orgConnections[ORG2_NAME].contract),
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, async () => {
    console.log(`🚀 Blockchain HTTP Server running on port ${PORT}`);
    console.log('🔌 Initializing connections to Hyperledger Fabric...');
    await initializeFabric();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down server...');
    if (orgConnections[ORG1_NAME] && orgConnections[ORG1_NAME].gateway) {
        await orgConnections[ORG1_NAME].gateway.disconnect();
    }
    if (orgConnections[ORG2_NAME] && orgConnections[ORG2_NAME].gateway) {
        await orgConnections[ORG2_NAME].gateway.disconnect();
    }
    process.exit(0);
});
