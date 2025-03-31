// lib/chains/solana.js

const { loadConfig } = require('../config');
const {
    Connection,
    PublicKey,
    clusterApiUrl,
    Keypair,
    Transaction,
    SystemProgram,
    ComputeBudgetProgram
} = require('@solana/web3.js');

const { Account, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');
const helpers = require('../helpers');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { config } = require('process');

module.exports = {
    callContractMethod: async function (contractName, method, params, env, options) {
        const { sender, url } = options;

        // Load configurations
        const config = loadConfig();

        let chainConfig;
        if(env === 'mainnet'){
            chainConfig = config.solana || {};
        } else {
            chainConfig = config["solana-test"] || {};
        }
         
        console.log(chainConfig);
        if (!chainConfig) {
            throw new Error('Solana configuration not found. Please set it using the "config" command.');
        }

        const networkId = chainConfig['network-id'] || (env === 'mainnet' ? 'mainnet-beta' : 'testnet');
        const networkUrl = url ||getNetworkUrl(networkId);
        if (!networkUrl) {
            throw new Error(`Unknown network ID '${networkId}'`);
        }

        const connection = new Connection(networkUrl, 'confirmed');
        
        // Load sender's keypair (handle securely)
        const senderKeypair = await loadSenderKeypair(sender);
        const senderPublicKey = senderKeypair.publicKey.toBase58();

        console.log(`Using sender address: ${senderPublicKey}`);


        //Handle the method call
        switch (contractName) {
            case 'connection':
                await handleConnectionMethod(method, params, connection, senderKeypair, chainConfig);
                break;
            case 'mock':
                await handleMockMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            default:
                throw new Error(`Contract '${contractName}' is not supported.`);
        }
        process.exit(0);
    },
};

const {
    calculatePdaSync,
    initializeProgram,
    fetchMintToken,
    getConnectionAccounts,
    getXCallAccounts,
    fetchWhitelistedActions,
    uint128ToArray,
    fetchXcallConfig,
    hexToUint8Array,
    logger
} = helpers;

function getNetworkUrl(networkId) {
    const networkMap = {
        'solana': clusterApiUrl('mainnet-beta'),
        'solana-test': 'https://api.devnet.solana.com', // Adjust this URL if needed
    };
    return networkMap[networkId];
}

async function loadSenderKeypair(senderPath) {
    let keypairPath;

    if (senderPath) {
        keypairPath = path.resolve(senderPath);
        if (!fs.existsSync(keypairPath)) {
            throw new Error(`Sender keypair file not found at path: ${keypairPath}`);
        }
    } else {
        keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
        if (!fs.existsSync(keypairPath)) {
            throw new Error(`Default Solana keypair file not found at path: ${keypairPath}. Please provide a keypair file using the --sender option.`);
        }
    }

    try {
        const secretKeyString = fs.readFileSync(keypairPath, 'utf-8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
        return Keypair.fromSecretKey(secretKey);
    } catch (error) {
        throw new Error(`Failed to load keypair from path '${keypairPath}': ${error.message}`);
    }
}

async function handleMockMethods(method, params, connection, senderKeypair, chainConfig) {
    const mockProgramId = new PublicKey(params.mock);
    let connectionId = new PublicKey(params.connection);
    let connectionConfig = await calculatePdaSync(['config'], connectionId);

    // Helper function to create provider
    const createProvider = () => new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});

    // Helper function to send a transaction
    const sendTransaction = async (instruction) => {
        const tx = new Transaction();
        tx.add(instruction);
        try {
            const txSignature = await createProvider().sendAndConfirm(tx);
            logger.info(`Transaction signature: ${txSignature}`);
        } catch (error) {
            logger.error(`Transaction failed: ${error.message}`);
            throw error;
        }
    };

    // Helper function to calculate PDAs
    const calculatePdAs = async (...seeds) => calculatePdaSync(seeds, mockProgramId);

    switch (method) {
        case 'initialize':
            // Calculate PDAs for initialization
            const [configPda] = await Promise.all([
                calculatePdAs('state')
            ]);
            // Initialize program
            const program = await initializeProgram(mockProgramId, createProvider());

            // Create instruction for initialization
            const initializeIx = await program.methods
                .initialize(connectionId)
                .accountsStrict({
                    sender: senderKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                    config: configPda
                })
                .signers([senderKeypair.payer])
                .instruction();

            // Send transaction
            await sendTransaction(initializeIx);
            break;

        case 'send_message':
            // Calculate PDAs for send_message
            const [configPdaSend] = await Promise.all([
                calculatePdAs('state')
            ]);


            connectionId = new PublicKey(params.connection);
            connectionConfig = await calculatePdaSync(['config'], connectionId);


            // Prepare message data buffers
            const messageDatas = params.data ? Buffer.from(params.data, 'hex') : Buffer.alloc(0);
            const dstChainIdj = params.dstChainId;
            const dstAddressg = params.dstAddress? Buffer.from(params.dstAddress, 'hex') : Buffer.alloc(0);

            // Initialize program for sending message
            const mockProgram = await initializeProgram(mockProgramId, createProvider());
            const conectionProgram = await initializeProgram(connectionId, createProvider());
            const listenerMyEvent = conectionProgram.addEventListener('sendMessage', (event, slot) => {
                console.log(`slot ${slot} event connSn ${event.connSn} dstChainId ${event.dstChainId} dstAddress ${event.dstAddress} payload ${event.payload} srcChainId ${event.srcChainId} srcAddress ${event.srcAddress}`);
              });
            // Retrieve XCall and connection accounts
            console.log(mockProgram)
            // Create instruction for sending message
            const sendMessageIxh = await mockProgram.methods
                .sendMessage(new anchor.BN(dstChainIdj), dstAddressg, messageDatas).accountsStrict({
                    sender: senderKeypair.publicKey,
                    config: configPdaSend,
                    systemProgram: SystemProgram.programId,
                    connection: connectionId,
                    connectionConfig: connectionConfig
                })
                .signers([senderKeypair.payer])
                .instruction();

            await sendTransaction(sendMessageIxh);
            await new Promise((resolve) => setTimeout(resolve, 5000));
            conectionProgram.removeEventListener(listenerMyEvent);
            break;

        case 'receive_message':

            connectionId = new PublicKey(params.connection);
            connectionConfig = await calculatePdaSync(['config'], connectionId);

            let mockConfig = await calculatePdaSync(['state'], mockProgramId);

            // Prepare message data buffers
            const messageData = params.data ? Buffer.from(params.data, 'hex') : Buffer.alloc(0);
            const srcChainId = params.dstChainId;
            const srcAddress = params.dstAddress? Buffer.from(params.dstAddress, 'hex') : Buffer.alloc(0);

            let receiptPDA = await calculatePdaSync(['receipt',2,2], connectionId);

            // Initialize program for sending message
            const programSendMessage = await initializeProgram(mockProgramId, createProvider());

            // Create instruction for sending message
            const sendMessageIx = await programSendMessage.methods
                .recvMessage(new anchor.BN(srcChainId), srcAddress, new anchor.BN(2), messageData, []).accountsStrict({
                    signer: senderKeypair.publicKey,
                    config: mockConfig,
                    systemProgram: SystemProgram.programId,
                    connection: connectionId,
                    connectionConfig: connectionConfig
                })
                .remainingAccounts([
                    {
                        pubkey: receiptPDA,
                        isWritable: true,
                        isSigner: false
                    }
                ])
                .signers([senderKeypair.payer])
                .instruction();

            await sendTransaction(sendMessageIx);
            break;

        default:
            throw new Error(`Method '${method}' is not supported for mock.`);
    }
}


async function handleConnectionMethod(method, params, connection, senderKeypair, chainConfig) {
    switch (method) {
        case 'initialize':
            await initializeConnection(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_admin':
            const centralizedConnectionId = params.centralized
            await setAdminX(params, connection, senderKeypair, centralizedConnectionId);
            break;
        case 'add_validators':
            await addValidators(params, connection, senderKeypair, chainConfig);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for asset-manager.`);
    }
}

async function addValidators(params, connection, senderKeypair, chainConfig) {

    programId = new PublicKey(params.connection)
    const validators = params.validators
    const threshold = params.threshold

    const statePda = await calculatePdaSync(['config'], programId);

    let validatorsPubKeys = validators
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(programId, provider());

    let setAdmin = await program.methods
        .updateValidators(validators, threshold)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            config: statePda,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(setAdmin);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to configure rate limit: ${error.message}`);
        throw error;
    }
    
}

async function initializeConnection(params, connection, senderKeypair, chainConfig) {
    const connectionId = new PublicKey(params.connection);
    const admin = new PublicKey(params.admin);
    const chain_id = params.chain_id;

    const statePda = await calculatePdaSync(['config'], connectionId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(connectionId, provider());

    let configureIx = await program.methods
        .initialize(new anchor.BN(chain_id))
        .accountsStrict({
            signer: senderKeypair.publicKey,
            config: statePda,
            systemProgram: SystemProgram.programId,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed Initializing Centralized Connection ${connectionId.publicKey}: ${error.message}`);
        throw error;
    }
}


async function setAdminX(params, connection, senderKeypair, programId) {
    programId = new PublicKey(programId)
    const newAdmin = new PublicKey(params.new_admin)

    const statePda = await calculatePdaSync(['config'], programId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(programId, provider());

    let setAdmin = await program.methods
        .setAdmin(newAdmin)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            config: statePda,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(setAdmin);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to configure rate limit: ${error.message}`);
        throw error;
    }
}


function extractSecondDataFromBuffer(buffer) {
    const dataStr = buffer.toString('utf-8');
    const parts = dataStr.split(/[\u0000-\u001F\uFFFD\s]+/); 
    return parts
}



async function convert(hexSeed) {
    const seed = Uint8Array.from(Buffer.from(hexSeed, 'hex'));
    // Ensure the seed is exactly 32 bytes
    if (seed.length !== 32) {
        throw new Error('Seed must be exactly 32 bytes.');
    }

    const keypair = solanaWeb3.Keypair.fromSeed(seed);

    console.log("Public Key:", keypair.publicKey.toBase58());
    console.log("Secret Key:", Buffer.from(keypair.secretKey).toString('hex'));
}
/**
 * Creates or fetches the associated token account for a given wallet.
 * @param {PublicKey} wallet
 * @param {PublicKey} mint
 * @param {Connection} connection
 * @param {Keypair} payer
 * @returns {Promise<Account>}
 */
async function createTokenAccount(wallet, mint, connection, payer) {
    return await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        wallet,
        true
    );
}

/**
 * Mints tokens to a specified receiver.
 * @param {PublicKey} receiver
 * @param {number} amount
 * @param {Connection} connection
 * @param {Keypair} payer
 */
async function mintTokens(receiver, amount, connection, payer) {
    await mintTo(
        connection,
        payer,
        new PublicKey(configs.asset_token),
        receiver,
        payer,
        amount,
        [],
        TOKEN_PROGRAM_ID
    );
}
const nacl = require('tweetnacl');

async function signMessage() {
    let keypair = await loadSenderKeypair();
    const message = Buffer.from("Test message");
    const signature = nacl.sign.detached(message, keypair.secretKey);
    console.log("Signed message:", signature.toString('hex'));
    console.log("Public Key:", keypair.publicKey);

    const isValid = nacl.sign.detached.verify(message, signature, keypair.publicKey.toBytes());
    console.log("Signature is valid:", isValid);
}