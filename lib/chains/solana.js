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

const { Account, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
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


        // Get the contract address
        let contractAddress;

        // const contractConfig = chainConfig[contractName];
        // if (!contractConfig) {
        //     throw new Error(`Contract '${contractName}' configuration not found for Solana.`);
        // }
        // contractAddress = contractConfig.contractAddress;
        // if (!contractAddress) {
        //     throw new Error(`Contract address for '${contractName}' not set in configuration.`);
        // }

        // Load sender's keypair (handle securely)
        const senderKeypair = await loadSenderKeypair(sender);
        const senderPublicKey = senderKeypair.publicKey.toBase58();

        console.log(`Using sender address: ${senderPublicKey}`);


        //Handle the method call
        switch (contractName) {
            case 'asset-manager':
                await handleAssetManagerMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            case 'balanced-dollar':
                await handleBalancedDollarMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            case 'xcall':
                await handleXCallMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            case 'centralized':
                await handleCentralizedConnectionMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            case 'cluster':
                await handleClusterConnectionMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            case 'xcall-manager':
                await handleXCallManagerMethods(method, params, connection, senderKeypair, chainConfig);
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
            const [configPda, authorityPda] = await Promise.all([
                calculatePdAs('config'),
                calculatePdAs('dapp_authority'),
            ]);
            const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
            // Initialize program
            const program = await initializeProgram(mockProgramId, createProvider());

            // Create instruction for initialization
            const initializeIx = await program.methods
                .initialize(xcallProgramId)
                .accountsStrict({
                    authority: authorityPda,
                    sender: senderKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                    config: configPda
                })
                .signers([senderKeypair.payer])
                .instruction();

            // Send transaction
            await sendTransaction(initializeIx);
            break;

        case 'add_connection':
            // Logic for adding a connection (currently commented out)
            
            // Calculate PDAs for connection
            const [configPdaConnection, authorityPdaConnection, connectionPda] = await Promise.all([
                calculatePdAs('config'),
                calculatePdAs('dapp_authority'),
                calculatePdAs('connections', '0x2.icon'),
            ]);

            // Initialize program for adding connection
            const programAddConnection = await initializeProgram(mockProgramId, createProvider());

            // Example parameters for addConnection
            const connectionId = "0x2.icon"; // This could be dynamic depending on your use case
            const connectionAddress = "Hch96XZHaSEqaX5LBiMQ9dXVJXCSexJFpMMX5s6mS7ad"; // Example address
            const connectionHash = "cxcfdc270edd2a1f10036fa12a2ab1da4fb1262963"; // Example hash

            // Create instruction for adding connection
            const addConnectionIx = await programAddConnection.methods
                .addConnection(connectionId, connectionAddress, connectionHash)
                .accountsStrict({
                    config: configPdaConnection,
                    authority: authorityPdaConnection,
                    connectionAccount: connectionPda,
                    sender: senderKeypair.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([senderKeypair.payer])
                .instruction();

            // Send transaction
            await sendTransaction(addConnectionIx);
            
            break;

        case 'send_message':
            console.log("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
            // Calculate PDAs for send_message
            const [configPdaSend, authorityPdaSend, connectionPdaSend] = await Promise.all([
                calculatePdAs('config'),
                calculatePdAs('dapp_authority'),
                calculatePdAs('connections', '0x2.icon'),
            ]);

            // Prepare message data buffers
            const messageData = params.data ? Buffer.from(params.data, 'hex') : Buffer.alloc(0);
            const rollbackData = params.rollback ? Buffer.from(params.rollback, 'hex') : Buffer.alloc(0);

            // Initialize program for sending message
            const programSendMessage = await initializeProgram(mockProgramId, createProvider());

            // Retrieve XCall and connection accounts
            const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
            const xcallAccounts = await getXCallAccounts(xcallProgramId, createProvider());
            const connectionAccounts = await getConnectionAccounts("0x2.icon", xcallManagerId, createProvider(), "Hch96XZHaSEqaX5LBiMQ9dXVJXCSexJFpMMX5s6mS7ad");

            console.log(programSendMessage)
            // Create instruction for sending message
            const sendMessageIx = await programSendMessage.methods
                .sendCallMessage("0x2.icon/hxea3635f7495653d8596a7f23a78514b6ad1470e8", messageData,2, rollbackData).accountsStrict({
                    sender: senderKeypair.publicKey,
                    config: configPdaSend,
                    authority: authorityPdaSend,
                    connectionsAccount: connectionPdaSend,
                    systemProgram: SystemProgram.programId
                })
                // .remainingAccounts([
                //     ...xcallAccounts,
                //     ...connectionAccounts
                // ])
                .signers([senderKeypair.payer])
                .instruction();

            // const initializeIx = await programSendMessage.methods
            //     .sendCallMessage(
            //         "0x2.icon/hxea3635f7495653d8596a7f23a78514b6ad1470e8",
            //         messageData,
            //         rollbackData,
            //         ["Hch96XZHaSEqaX5LBiMQ9dXVJXCSexJFpMMX5s6mS7ad"],
            //         ["cxcfdc270edd2a1f10036fa12a2ab1da4fb1262963"],
            //         xcallProgramId
            //     )
            //     .accountsStrict({
            //         authority: authorityPdaSend,
            //         sender: senderKeypair.publicKey,
            //         systemProgram: SystemProgram.programId,
            //     })
            //     .signers([senderKeypair.payer])
            //     .instruction();
            // console.log(sendMessageIx)
            // Send transaction
            await sendTransaction(sendMessageIx);
            break;

        default:
            throw new Error(`Method '${method}' is not supported for mock.`);
    }
}


async function handleAssetManagerMethods(method, params, connection, senderKeypair, chainConfig) {
    switch (method) {
        case 'initialize':
            await initializeAssetManager(params, connection, senderKeypair, chainConfig);
            break;
        case 'deposit_token':
            await depositToken(params, connection, senderKeypair, chainConfig);
            break;
        case 'deposit_native':
            await depositNative(params, connection, senderKeypair, chainConfig);
            break;
        case 'configure_rate_limit':
            await configureRateLimit(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_admin':
            const assetManagerId = new PublicKey(params.asset_manager) || new PublicKey(chainConfig['asset-manager'].contractAddress);
            await setAdmin(params, connection, senderKeypair, assetManagerId);
            break;
        case 'set_token_creation_fee':
            await setAssetTokenCreationFee(params, connection, senderKeypair, chainConfig);
            break;
        case 'execute_call':
            await executeCallA(params, connection, senderKeypair, chainConfig);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for asset-manager.`);
    }
}
async function handleCentralizedConnectionMethods(method, params, connection, senderKeypair, chainConfig) {
    switch (method) {
        case 'initialize':
            await initializeCentralizedConnection(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_admin':
            const centralizedConnectionId = params.centralized
            await setAdminX(params, connection, senderKeypair, centralizedConnectionId);
            break;
        case 'set_relayer':
            centralizedConnectionId = params.centralized
            await setRelayer(params, connection, senderKeypair, centralizedConnectionId);
            break;
        case 'add_validators':
            await addValidators(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_network_fees':
            await setNetworkFees(params, connection, senderKeypair, chainConfig);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for asset-manager.`);
    }
}
async function handleClusterConnectionMethods(method, params, connection, senderKeypair, chainConfig) {
    switch (method) {
        case 'initialize':
            await initializeCentralizedConnection(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_admin':
            const centralizedConnectionId = params.centralized
            await setAdminX(params, connection, senderKeypair, centralizedConnectionId);
            break;
        case 'set_relayer':
            await setRelayer(params, connection, senderKeypair, params.centralized);
            break;
        case 'add_validators':
            await addValidators(params, connection, senderKeypair, params.centralized);
            break;
        case 'set_network_fees':
            await setNetworkFees(params, connection, senderKeypair, chainConfig);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for asset-manager.`);
    }
}
async function setRelayer(params, connection, senderKeypair, programId) {

    programId = new PublicKey(programId)
    const newRelayer = new PublicKey(params.new_relayer)

    const statePda = await calculatePdaSync(['config'], programId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(programId, provider());

    let setAdmin = await program.methods
        .setRelayer(newRelayer)
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


async function addValidators(params, connection, senderKeypair, programId) {

    programId = new PublicKey(programId)
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
    // const xcall = new PublicKey("BknkMw3sonNXVTW2mzuhKEJmmt4PSVei1HbQiDuWVny4");
    // // const fee = new anchor.BN(params.fee);

    
    // const receipt = await calculatePdaSync(['receipt', "test", uint128ToArray(81)], programId);
    // const setAdmin = await program.methods
    //     .recvMessage("test",new anchor.BN(81),Buffer.from([]),new anchor.BN(81),Buffer.from([]))
    //     .accountsStrict({
    //         relayer: senderKeypair.publicKey,
    //         config: statePda,
    //         receipt: receipt,
    //         authority: new PublicKey("DPHSFegSN7zYyTWBfe4jEQMus8zSSJsp3EMM4BBKtowx"),
    //         systemProgram: SystemProgram.programId
    //     }).remainingAccounts(
    //         [
    //             {
    //                 pubkey: new PublicKey("G3ayUCKbjspps1sesmdRzX1ijeGSPXwoPo5kuUozA5Jq"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             },
    //             {
    //                 pubkey: new PublicKey("A4bvJe76KqdZiVUS8R5Q7nibD1gDRhtBVqduiKjUZGoS"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             },
    //             {
    //                 pubkey: new PublicKey("BknkMw3sonNXVTW2mzuhKEJmmt4PSVei1HbQiDuWVny4"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             },
    //             {
    //                 pubkey: new PublicKey("BknkMw3sonNXVTW2mzuhKEJmmt4PSVei1HbQiDuWVny4"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             },
    //             {
    //                 pubkey: new PublicKey("A4bvJe76KqdZiVUS8R5Q7nibD1gDRhtBVqduiKjUZGoS"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             },
    //             {
    //                 pubkey: new PublicKey("BX2xKmyvuErmbdvxuEgGz5LxsJyt6EcrbjJVwa8fPZfx"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             },
    //             {
    //                 pubkey: new PublicKey("BknkMw3sonNXVTW2mzuhKEJmmt4PSVei1HbQiDuWVny4"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             },
    //             {
    //                 pubkey: new PublicKey("BknkMw3sonNXVTW2mzuhKEJmmt4PSVei1HbQiDuWVny4"),
    //                 isWritable: true,
    //                 isSigner: false,
    //             }
    //         ]
    //     )
    //     .signers([senderKeypair.payer]).instruction();


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


async function initializeAssetManager(params, connection, senderKeypair, chainConfig) {
    const assetManagerId = new PublicKey(params.asset_manager);
    const xcall_program = new PublicKey(params.xcall);
    const icon_asset_manager = params.icon_asset_manager;
    const xcall_manager = new PublicKey(params.xcall_manager);

    const xcall_manager_state = await calculatePdaSync(['state'], xcall_manager);

    const statePda = await calculatePdaSync(['state'], assetManagerId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(assetManagerId, provider());

    let configureIx = await program.methods
        .initialize(xcall_program, icon_asset_manager, xcall_manager, xcall_manager_state)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
            systemProgram: SystemProgram.programId,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed Initializing Asset Manager: ${error.message}`);
        throw error;
    }
}
async function getBnusdTokenAuthority(params, connection, senderKeypair, chainConfig) {
    const balancedDollarId = new PublicKey(params.balanced_dollar);

    const bnusdAuthority = await calculatePdaSync(['bnusd_authority'], balancedDollarId);

    logger.info(`BNUSD Authority: ${bnusdAuthority.toBase58()}`);
}
async function initializeBalancedDollar(params, connection, senderKeypair, chainConfig) {
    const balancedDollarId = new PublicKey(params.balanced_dollar);
    const xcall_program = new PublicKey(params.xcall);
    const icon_balanced_dollar = params.icon_bnusd;
    const bnusd_token = new PublicKey(params.bnusd_token);
    const xcall_manager = new PublicKey(params.xcall_manager);

    const xcall_manager_state = await calculatePdaSync(['state'], xcall_manager);

    const statePda = await calculatePdaSync(['state'], balancedDollarId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(balancedDollarId, provider());

    let configureIx = await program.methods
        .initialize(xcall_program, icon_balanced_dollar, xcall_manager, bnusd_token, xcall_manager_state)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
            systemProgram: SystemProgram.programId,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed Initializing Asset Manager: ${error.message}`);
        throw error;
    }
}
async function initializeXcallManager(params, connection, senderKeypair, chainConfig) {
    const xcallManagerId = new PublicKey(params.xcall_manager);
    const xcall_program = new PublicKey(params.xcall);
    const icon_governance = params.icon_governance;
    const sources = params.sources;
    const destinations = params.destinations;

    const statePda = await calculatePdaSync(['state'], xcallManagerId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcallManagerId, provider());

    let configureIx = await program.methods
        .initialize(xcall_program, icon_governance, sources, destinations)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
            systemProgram: SystemProgram.programId,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed Initializing Xcall Manager: ${error.message}`);
        throw error;
    }
}
async function initializeCentralizedConnection(params, connection, senderKeypair, chainConfig) {
    const centralizedId = new PublicKey(params.centralized);
    const xcall_program = new PublicKey(params.xcall);
    const admin = new PublicKey(params.admin);

    const statePda = await calculatePdaSync(['config'], centralizedId);
    const authorityPda = await calculatePdaSync(['connection_authority'], centralizedId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(centralizedId, provider());

    let configureIx = await program.methods
        .initialize(xcall_program, admin)
        .accountsStrict({
            signer: senderKeypair.publicKey,
            config: statePda,
            systemProgram: SystemProgram.programId,
            authority: authorityPda
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed Initializing Centralized Connection ${centralizedId.publicKey}: ${error.message}`);
        throw error;
    }
}

async function initializeXcall(params, connection, senderKeypair, chainConfig) {
    const xcallId = new PublicKey(params.xcall);
    const network_id = params.nid;

    const statePda = await calculatePdaSync(['config'], xcallId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcallId, provider());

    let configureIx = await program.methods
        .initialize(network_id)
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
        logger.error(`Failed Initializing XCall ${xcallId.publicKey}: ${error.message}`);
        throw error;
    }
}
async function handleBalancedDollarMethods(method, params, connection, senderKeypair, chainConfig) {
    switch (method) {
        case 'initialize':
            await initializeBalancedDollar(params, connection, senderKeypair, chainConfig);
            break;
        case 'get_bnusd_token_authority':
            await getBnusdTokenAuthority(params, connection, senderKeypair, chainConfig);
            break;
        case 'cross_transfer':
            await crossTransfer(params, connection, senderKeypair, chainConfig);
            break;
        case 'execute_call':
            await executeCall(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_admin':
            const balancedDollarId = new PublicKey(params.balanced_dollar) || new PublicKey(chainConfig['balanced-dollar'].contractAddress);
            await setAdmin(params, connection, senderKeypair, balancedDollarId);
            break;
        case 'set_token_creation_fee':
            await setTokenCreationFee(params, connection, senderKeypair, chainConfig);
            break;

        default:
            throw new Error(`Method '${method}' is not supported for balanced-dollar.`);
    }
}

async function setTokenCreationFee(params, connection, senderKeypair, chainConfig) {
    const balancedDollarId = new PublicKey(chainConfig['balanced-dollar'].contractAddress);
    const fee = new anchor.BN(params.fee);

    const statePda = await calculatePdaSync(['state'], balancedDollarId);
    const tokenCreationPda = await calculatePdaSync(['token_creation'], balancedDollarId);

    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(balancedDollarId, provider());

    let configureIx = await program.methods
        .setTokenCreationFee(fee)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
            tokenAccountCreationPda: tokenCreationPda,
            systemProgram: SystemProgram.programId,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to set Token Creation Fee: ${error.message}`);
        throw error;
    }
}

async function setAssetTokenCreationFee(params, connection, senderKeypair, chainConfig) {
    const balancedDollarId = new PublicKey(chainConfig['asset-manager'].contractAddress);
    const fee = new anchor.BN(params.fee);
    const token = new PublicKey(params.token);

    const statePda = await calculatePdaSync(['state'], balancedDollarId);
    const tokenCreationPda = await calculatePdaSync(['token_creation',token], balancedDollarId);

    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(balancedDollarId, provider());

    let configureIx = await program.methods
        .setTokenAccountCreationFee(token,fee)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
            tokenAccountCreationPda: tokenCreationPda,
            systemProgram: SystemProgram.programId,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to set Token Creation Fee: ${error.message}`);
        throw error;
    }
}


async function handleXCallMethods(method, params, connection, senderKeypair, chainConfig) {
    switch (method) {
        case 'initialize':
            await initializeXcall(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_protocol_fee':
            await setProtocolFee(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_fee_handler':
            await setFeeHandler(params, connection, senderKeypair, chainConfig);
            break;
        case 'send_call':
            await sendCall(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_admin':
            const xcall = new PublicKey(params.xcall) || new PublicKey(chainConfig['xcall'].contractAddress);
            await setAdminX(params, connection, senderKeypair, xcall);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for xcall.`);
    }
}

async function setProtocolFee(params, connection, senderKeypair, chainConfig) {
    const xcall = new PublicKey(chainConfig['xcall'].contractAddress);
    // // const fee = new anchor.BN(params.fee);

    const statePda = await calculatePdaSync(['config'], xcall);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcall, provider());

    let configureIx = await program.methods
        .getProtocolFee()
        .accountsStrict({
            config: statePda,
        }).simulate();

    console.log(configureIx);

    // const tx = new Transaction();
    // tx.add(configureIx);
    // try {
    //     const txSignature = await provider().sendAndConfirm(tx);
    //     logger.info(`Tx signature: ${txSignature}`);
    // } catch (error) {
    //     console.log(error);
    //     logger.error(`Failed to set Protocol Fee: ${error.message}`);
    //     throw error;
    // }
}

async function setFeeHandler(params, connection, senderKeypair, chainConfig) {
    const xcall = new PublicKey(params.xcall) || new PublicKey(chainConfig['xcall'].contractAddress);
    const feeHandler = new PublicKey(params.fee_handler);

    const statePda = await calculatePdaSync(['config'], xcall);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcall, provider());

    let configureIx = await program.methods
        .setProtocolFeeHandler(feeHandler)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            config: statePda,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to set Protocol Fee Handler: ${error.message}`);
        throw error;
    }
}

async function handleXCallManagerMethods(method, params, connection, senderKeypair, chainConfig) {
    switch (method) {
        case 'initialize':
            await initializeXcallManager(params, connection, senderKeypair, chainConfig);
            break;
        case 'whitelist_action':
            await whitelistAction(params, connection, senderKeypair, chainConfig);
            break;
        case 'remove_action':
            await removeAction(params, connection, senderKeypair, chainConfig);
            break;
        case 'get_whitelisted_actions':
            await getWhitelistedActions(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_protocols':
            await setProtocols(params, connection, senderKeypair, chainConfig);
            break;
        case 'set_admin':
            const xcallManagerId = new PublicKey(params.xcall_manager) || new PublicKey(chainConfig['xcall-manager'].contractAddress);
            await setAdmin(params, connection, senderKeypair, xcallManagerId);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for xcall-manager.`);
    }
}

async function whitelistAction(params, connection, senderKeypair, chainConfig) {
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const action = Buffer.from(params.action);

    const statePda = await calculatePdaSync(['state'], xcallManagerId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcallManagerId, provider());

    let configureIx = await program.methods
        .whitelistAction(action)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to configure rate limit: ${error.message}`);
        throw error;
    }
}

async function removeAction(params, connection, senderKeypair, chainConfig) {
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const action = Buffer.from(params.action);

    const statePda = await calculatePdaSync(['state'], xcallManagerId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcallManagerId, provider());

    let configureIx = await program.methods
        .removeAction(action)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to configure rate limit: ${error.message}`);
        throw error;
    }
}


async function getWhitelistedActions(params, connection, senderKeypair, chainConfig) {
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    const whitelistedActions = await fetchWhitelistedActions(xcallManagerId, provider());

    logger.info("Whitelisted actions:", whitelistedActions);
}


async function configureRateLimit(params, connection, senderKeypair, chainConfig) {
    const assetManagerId = params.asset_manager ? new PublicKey(params.asset_manager) : new PublicKey(chainConfig['asset-manager'].contractAddress);
    const assetToken = params.asset_token ? new PublicKey(params.asset_token) : SystemProgram.programId;
    const period = new anchor.BN(params.period);
    const percentage = new anchor.BN(params.percentage);

    const statePda = await calculatePdaSync(['state'], assetManagerId);
    const token_state = await calculatePdaSync(['token_state', assetToken], assetManagerId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(assetManagerId, provider());

    // let configureIx = await program.methods
    //     .configureRateLimit(assetToken, period, percentage)
    //     .accountsStrict({
    //         admin: senderKeypair.publicKey,
    //         state: statePda,
    //         tokenState: token_state,
    //         systemProgram: SystemProgram.programId,
    //     }).signers([senderKeypair.payer]).instruction();

        let configureIx = await program.methods
        .getWithdrawLimit()
        .accountsStrict({
            tokenState: token_state,
            vaultTokenAccount: null
        }).simulate();

        
        console.log(configureIx);

    // const tx = new Transaction();
    // tx.add(configureIx);
    // try {
    //     const txSignature = await provider().sendAndConfirm(tx);
    //     logger.info(`Tx signature: ${txSignature}`);
    // } catch (error) {
    //     console.log(error);
    //     logger.error(`Failed to configure rate limit: ${error.message}`);
    //     throw error;
    // }
}

async function setAdmin(params, connection, senderKeypair, programId) {
    const newAdmin = new PublicKey(params.new_admin)

    const statePda = await calculatePdaSync(['state'], programId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(programId, provider());

    let setAdmin = await program.methods
        .setAdmin(newAdmin)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
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

// Implementing depositNative
async function depositNative(params, connection, senderKeypair, chainConfig) {
    const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const assetManagerId = new PublicKey(chainConfig['asset-manager'].contractAddress);

    const amount = new anchor.BN(params.amount);
    const to = params.to
    const data = Buffer.from("C9855F73776170F80000", 'hex')
    const toNid = params.to.split('/')[0]

    const asset_manager = await initializeProgram(assetManagerId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    console.log(`Executing 'depositNative' on 'asset-manager' contract.`);

    const vaultNativePda = await calculatePdaSync(['vault_native'], assetManagerId);
    const statePda = await calculatePdaSync(['state'], assetManagerId);
    const xcallManagerStatePda = await calculatePdaSync(['state'], xcallManagerId);
    const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);
    const xcallAuthorityPda = await calculatePdaSync(['dapp_authority'], assetManagerId);

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
    });

    let tx = new Transaction().add(computeBudgetIx);

    let xcallAccounts = await getXCallAccounts(xcallProgramId, provider());
    let connectionAccounts = await getConnectionAccounts(toNid, xcallManagerId, provider());
    console.log("XCALL CONFIG",xcallConfigPda);
    console.log("Data",data);
    const depositTokenIx = await asset_manager.methods
        .depositNative(amount, to, data)
        .accounts({
            from: null,
            fromAuthority: senderKeypair.publicKey,
            vaultTokenAccount: null,
            valultAuthority: null, // Ensure this PDA is correct
            vaultNativeAccount: vaultNativePda,
            state: statePda,
            xcallManagerState: xcallManagerStatePda,
            xcallConfig: xcallConfigPda,
            xcall: xcallProgramId,
            xcallManager: xcallManagerId,
            tokenProgram: null,
            systemProgram: SystemProgram.programId,
            xcallAuthority: xcallAuthorityPda,
        })

        .remainingAccounts([
            ...xcallAccounts,
            ...connectionAccounts
        ])
        .signers([senderKeypair.payer]).instruction();


        // const depositTokenIx = await asset_manager.methods
        // .getWithdrawLimit(amount, to, data)
        // .accounts({
        //     from: null,
        //     fromAuthority: senderKeypair.publicKey,
        //     vaultTokenAccount: null,
        //     valultAuthority: null, // Ensure this PDA is correct
        //     vaultNativeAccount: vaultNativePda,
        //     state: statePda,
        //     xcallManagerState: xcallManagerStatePda,
        //     xcallConfig: xcallConfigPda,
        //     xcall: xcallProgramId,
        //     xcallManager: xcallManagerId,
        //     tokenProgram: null,
        //     systemProgram: SystemProgram.programId,
        //     xcallAuthority: xcallAuthorityPda,
        // })

        // .remainingAccounts([
        //     ...xcallAccounts,
        //     ...connectionAccounts
        // ])
        // .signers([senderKeypair.payer]).instruction();
        

    tx.add(depositTokenIx);

    // try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Transaction Signature: ${txSignature}`);
    // } catch (error) {
    //     logger.error(`Error sending deposit transaction: ${error.message}`);
    //     throw error;
    // }
}

async function depositToken(params, connection, senderKeypair, chainConfig) {
    // const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    // const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    // const assetManagerId = new PublicKey(chainConfig['asset-manager'].contractAddress);
    // const assetToken = new PublicKey(params.asset_token);

    // const amount = new anchor.BN(params.amount);
    // const to = params.to
    // const data = Buffer.from(params.data, 'hex')
    // const toNid = params.to.split('/')[0]

    // const asset_manager = await initializeProgram(assetManagerId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    async function createTokenAccount() {
        let tokenAccount = await getOrCreateAssociatedTokenAccount(
            provider().connection,
            senderKeypair,
            new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"),
            new PublicKey("D5VTeg8EiSc6wPWs5RU3jEqDNR7nmqiraWUNEMCv3ZBA"),
            true
        );
        return tokenAccount
    }

    console.log(`Executing 'depositToken' on 'asset-manager' contract.`);

    // const vaultPda = await calculatePdaSync(['vault', assetToken], assetManagerId);
    // const statePda = await calculatePdaSync(['state'], assetManagerId);
    // const xcallManagerStatePda = await calculatePdaSync(['state'], xcallManagerId);
    // const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);
    // const xcallAuthorityPda = await calculatePdaSync(['dapp_authority'], assetManagerId);

    // const depositorTokenAccount = await createTokenAccount(senderKeypair.publicKey);
    const vaultTokenAccount = await createTokenAccount();

    // const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    //     units: 1000000,
    // });

    // let tx = new Transaction().add(computeBudgetIx);

    // let xcallAccounts = await getXCallAccounts(xcallProgramId, provider());
    // let connectionAccounts = await getConnectionAccounts(toNid, xcallManagerId, provider());

    // const depositTokenIx = await asset_manager.methods
    //     .depositToken(amount, to, data)
    //     .accounts({
    //         from: depositorTokenAccount.address,
    //         fromAuthority: senderKeypair.publicKey,
    //         vaultTokenAccount: vaultTokenAccount.address,
    //         valultAuthority: vaultPda, // Ensure this PDA is correct
    //         vaultNativeAccount: null,
    //         state: statePda,
    //         xcallManagerState: xcallManagerStatePda,
    //         xcallConfig: xcallConfigPda,
    //         xcall: xcallProgramId,
    //         xcallManager: xcallManagerId,
    //         tokenProgram: TOKEN_PROGRAM_ID,
    //         systemProgram: SystemProgram.programId,
    //         xcallAuthority: xcallAuthorityPda,
            
    //     })

    //     .remainingAccounts([
    //         ...xcallAccounts,
    //         ...connectionAccounts
    //     ])
    //     .signers([senderKeypair.payer]).instruction();


    // tx.add(depositTokenIx);

    // try {
    //     const txSignature = await provider().sendAndConfirm(tx);
    //     logger.info(`Transaction Signature: ${txSignature}`);
    // } catch (error) {
    //     logger.error(`Error sending deposit transaction: ${error.message}`);
    //     throw error;
    // }
}

async function crossTransfer(params, connection, senderKeypair, chainConfig) {
    const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const balancedDollarId = new PublicKey(chainConfig['balanced-dollar'].contractAddress);

    const mintToken = await fetchMintToken(balancedDollarId, provider());

    console.log(`Mint Token: ${mintToken}`);

    const amount = new anchor.BN(params.amount);
    const to = params.to
    const data = params.data ? Buffer.from(params.data, 'hex') : Buffer.alloc(0)
    const toNid = params.to.split('/')[0]

    const balanced_dollar = await initializeProgram(balancedDollarId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    (async function createTokenAccount(wallet) {
        let tokenAccount = await getOrCreateAssociatedTokenAccount(
            provider().connection,
            senderKeypair,
            new PublicKey("5N43m6JGxrZ6fW7MrwdbjgY93yjCj7krkcaTA7oRknj6"),
            new PublicKey("D5VTeg8EiSc6wPWs5RU3jEqDNR7nmqiraWUNEMCv3ZBA"),
            true
        );
        return tokenAccount
    })

    console.log(`Executing 'crossTransfer' on 'balanced-dollar' contract.`);

    const statePda = await calculatePdaSync(['state'], balancedDollarId);
    const xcallManagerStatePda = await calculatePdaSync(['state'], xcallManagerId);
    const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);
    const xcallAuthorityPda = await calculatePdaSync(['dapp_authority'], balancedDollarId);

    const associatedTokenAcc = await createTokenAccount(senderKeypair.publicKey);
    console.log(`Associated Token Account: ${associatedTokenAcc.address.toBase58()}`);

    console.log(`Associated Token Account: ${associatedTokenAcc.address.toBase58()}`);

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
    });

    let tx = new Transaction().add(computeBudgetIx);

    let xcallAccounts = await getXCallAccounts(xcallProgramId, provider());
    let connectionAccounts = await getConnectionAccounts(toNid, xcallManagerId, provider());

    const crossTransferTx = await balanced_dollar.methods
        .crossTransfer(to, amount, data)
        .accounts({
            from: associatedTokenAcc.address,
            mint: mintToken,
            fromAuthority: senderKeypair.publicKey,
            state: statePda,
            xcallManagerState: xcallManagerStatePda,
            xcallConfig: xcallConfigPda,
            xcall: xcallProgramId,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            xcallAuthority: xcallAuthorityPda,
        })

        .remainingAccounts([
            ...xcallAccounts,
            ...connectionAccounts
        ])
        .signers([senderKeypair.payer]).instruction();

    // tx.add(crossTransferTx);

    // try {
    //     const txSignature = await provider().sendAndConfirm(tx);
    //     logger.info(`Transaction Signature: ${txSignature}`);
    // } catch (error) {
    //     logger.error(`Error sending cross transfer transaction: ${error.message}`);
    //     throw error;
    // }
}

async function sendCall(params, connection, senderKeypair, chainConfig) {
    const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    let xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);

    const to = params.to
    const envelope = Buffer.from(hexToUint8Array(params.envelope))
    const toNid = params.to.split('/')[0]
    const connectionp = params.connection

    const xcall_program = await initializeProgram(xcallProgramId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    console.log(`Send Call`);

    const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);


    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
    });

    let tx = new Transaction().add(computeBudgetIx);
    let xcallAccounts = await getXCallAccounts(xcallProgramId, provider());
    let connectionAccounts = await getConnectionAccounts(toNid, xcallManagerId, provider(), connectionp);
    const crossTransferTx = await xcall_program.methods
        .sendCall(envelope, [to])
        .accounts({
            signer: senderKeypair.publicKey,
            config: xcallConfigPda,
            feeHandler: xcallAccounts[3].pubkey,
            rollbackAccount: null,
            instructionSysvar: new PublicKey("Sysvar1nstructions1111111111111111111111111"),
            systemProgram: SystemProgram.programId,
        })

        .remainingAccounts([
            ...connectionAccounts
        ])
        .signers([senderKeypair.payer]).instruction();

    tx.add(crossTransferTx);

    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Transaction Signature: ${txSignature}`);
    } catch (error) {
        logger.error(`Error sending cross transfer transaction: ${error.message}`);
        throw error;
    }
}
function extractSecondDataFromBuffer(buffer) {
    const dataStr = buffer.toString('utf-8');
    const parts = dataStr.split(/[\u0000-\u001F\uFFFD\s]+/); 
    return parts
}

async function executeCall(params, connection, senderKeypair, chainConfig) {
    const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const balancedDollarId = new PublicKey(chainConfig['balanced-dollar'].contractAddress);    

    const mintToken = await fetchMintToken(balancedDollarId, provider());
    const data = Buffer.from(hexToUint8Array(params.data))
    const reqId = new anchor.BN(params.req_id)

    let data_parts = extractSecondDataFromBuffer(data)
    console.log(data_parts)
    const toNid = data_parts[2].split('/')[0]
    const associatedTokenAcc = new PublicKey(data_parts[3].split('/')[1])

    const xcall = await initializeProgram(xcallProgramId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    const xcallManagerStatePda = await calculatePdaSync(['state'], xcallManagerId);
    const balancedDollarStatePda = await calculatePdaSync(['state'], balancedDollarId);
    const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);
    const proxyRequestPda = await calculatePdaSync(['proxy', uint128ToArray(params.req_id)], xcallProgramId);
    const bnusd_authority = await calculatePdaSync(['bnusd_authority'], balancedDollarId);

    const xcallConfig = await fetchXcallConfig(xcallProgramId, provider());

    const connectionAccounts = await getConnectionAccounts(toNid, xcallManagerId, provider());

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
    });

    let remainingAccounts = [
        ...connectionAccounts, ...[
        {
            pubkey: balancedDollarStatePda,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: associatedTokenAcc,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: mintToken,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: bnusd_authority,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: xcallManagerId,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: xcallProgramId,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: xcallManagerStatePda,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: balancedDollarId,
            isSigner: false,
            isWritable: true,
        },
        ]
    ]
    let tx = new Transaction().add(computeBudgetIx);

    console.log(`Executing 'executeCall' on 'xcall' contract.`);
    const executeCallTx = await xcall.methods
        .executeCall(reqId, data)
        .accounts({
            signer: senderKeypair.publicKey,
            config: xcallConfigPda,
            admin: xcallConfig.admin,
            proxyRequest: proxyRequestPda,
            systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([senderKeypair.payer]).instruction();

    tx.add(executeCallTx);

    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Transaction Signature: ${txSignature}`);
    } catch (error) {
        logger.error(`Error sending transaction: ${error.message}`);
        throw error;
    }
}

async function executeCallA(params, connection, senderKeypair, chainConfig) {
    const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const assetManagerId = new PublicKey(chainConfig['asset-manager'].contractAddress);    

    const data = Buffer.from(hexToUint8Array(params.data))
    const reqId = new anchor.BN(params.req_id)

    let data_parts = extractSecondDataFromBuffer(data)
    console.log(data_parts)
    const toNid = "0x1.icon"
    const mintToken = new PublicKey(data_parts[3])
    const to_native = new PublicKey("4u62r6nHHQKvG23j4zPjvwpQZB2sczf4LrKCMSyezpGU")
    const associatedTokenAcc = await createTokenAccount(to_native, mintToken, connection, senderKeypair.payer);

    const xcall = await initializeProgram(xcallProgramId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    const xcallManagerStatePda = await calculatePdaSync(['state'], xcallManagerId);
    const assetManagerStatePda = await calculatePdaSync(['state'], assetManagerId);
    const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);
    const proxyRequestPda = await calculatePdaSync(['proxy', "0x1.icon",uint128ToArray(14494),new PublicKey("FMPY4m3kZNvFyoAtc87dCPkPrfJuLFpWyS8sbsWFkGC9")], xcallProgramId);
    const bnusd_authority = await calculatePdaSync(['bnusd_authority'], assetManagerId);
    const tokenStatePda = await calculatePdaSync(['token_state', mintToken], assetManagerId);
    const vaultNativePda = await calculatePdaSync(['vault_native'], assetManagerId);
    const vaultAuthorityPda = await calculatePdaSync(['vault', mintToken], assetManagerId);
    const tokenCreationPda = await calculatePdaSync(['token_creation', mintToken], assetManagerId);
    console.log(`Vault Authority PDA: ${vaultAuthorityPda}`);
    const vaultTokenAccount = (await createTokenAccount(vaultAuthorityPda, mintToken, connection, senderKeypair.payer)).address;
    console.log(`Vault Token Account: ${vaultTokenAccount.address}`);
    const xcallConfig = await fetchXcallConfig(xcallProgramId, provider());

    const connectionAccounts = await getConnectionAccounts(toNid, xcallManagerId, provider());
    console.log(connectionAccounts)
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
    });

    let remainingAccounts = [
        ...connectionAccounts, ...[
        {
            pubkey: associatedTokenAcc.address,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: to_native,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: assetManagerStatePda,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: tokenStatePda,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: vaultTokenAccount,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: vaultNativePda,
            isSigner: false,
            isWritable: false,
        },
         {
            pubkey: mintToken,
            isSigner: false,
            isWritable: true,
        },
         {
            pubkey: vaultAuthorityPda,
            isSigner: false,
            isWritable: true,
        },
            {
            pubkey: TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: true,
        },
         {
            pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: xcallManagerId,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: xcallManagerStatePda,
            isSigner: false,
            isWritable: false,
        },
        {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: associatedTokenAcc.address,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: tokenCreationPda,
            isSigner: false,
            isWritable: true,
        },
        {
            pubkey: tokenCreationPda,
            isSigner: false,
            isWritable: true,
        },
        ]
    ]
    let tx = new Transaction().add(computeBudgetIx);

    console.log(`Executing 'executeCall' on 'xcall' contract.`);
    const executeCallTx = await xcall.methods
        .executeCall(reqId, "0x1.icon", new anchor.BN(14494), new PublicKey("FMPY4m3kZNvFyoAtc87dCPkPrfJuLFpWyS8sbsWFkGC9"), data)
        .accounts({
            signer: senderKeypair.publicKey,
            config: xcallConfigPda,
            admin: xcallConfig.admin,
            proxyRequest: proxyRequestPda,
            systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([senderKeypair.payer]).instruction();

    tx.add(executeCallTx);

    console.log(executeCallTx)

    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Transaction Signature: ${txSignature}`);
    } catch (error) {
        logger.error(`Error sending transaction: ${error.message}`);
        throw error;
    }
}

async function setProtocols(params, connection, senderKeypair, chainConfig) {
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const sources = params.sources;
    const destinations = params.destinations;
    const statePda = await calculatePdaSync(['state'], xcallManagerId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcallManagerId, provider());

    let configureIx = await program.methods
        .setProtocols(sources, destinations)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to configure rate limit: ${error.message}`);
        throw error;
    }
}

async function setNetworkFees(params, connection, senderKeypair, chainConfig) {
    const centralizedId = new PublicKey(params.centralized);
    const nid = params.nid;
    const messageFee = new anchor.BN(params.message_fee);
    const responseFee = new anchor.BN(params.response_fee);

    const statePda = await calculatePdaSync(['config'], centralizedId);
    const networkFeePda = await calculatePdaSync(['fee', nid], centralizedId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(centralizedId, provider());

    let configureIx = await program.methods
        .setFee(nid, messageFee, responseFee)
        .accountsStrict({
            config: statePda,
            networkFee: networkFeePda,
            relayer: senderKeypair.publicKey,
            systemProgram: SystemProgram.programId
        }).signers([senderKeypair.payer]).instruction();

    const tx = new Transaction();
    tx.add(configureIx);
    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Tx signature: ${txSignature}`);
    } catch (error) {
        console.log(error);
        logger.error(`Failed to set Network Fees: ${error.message}`);
        throw error;
    }
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
const { create } = require('domain');

async function signMessage() {
    let keypair = await loadSenderKeypair();
    const message = Buffer.from("Test message");
    const signature = nacl.sign.detached(message, keypair.secretKey);
    console.log("Signed message:", signature.toString('hex'));
    console.log("Public Key:", keypair.publicKey);

    const isValid = nacl.sign.detached.verify(message, signature, keypair.publicKey.toBytes());
    console.log("Signature is valid:", isValid);
}

async function abc(balancedDollarId) {
    balancedDollarId = new PublicKey(balancedDollarId);
    const bnusdAuthority = await calculatePdaSync(['bnusd_authority'], balancedDollarId);

    logger.info(`BNUSD Authority: ${bnusdAuthority.toBase58()}`);
}

module.exports = {
    callContractMethod: module.exports.callContractMethod,
    depositNative,
    deposit: depositToken,
};

// Function to initialize connection and check account type
// async function getAccountType(publicKeyString) {
//   // Replace with your RPC URL (mainnet-beta used here)
//   const RPC_URL = "https://api.mainnet-beta.solana.com";

//     const connection = new Connection(RPC_URL);
//     const publicKey = new PublicKey(publicKeyString);
//     const accountInfo = await connection.getAccountInfo(publicKey);

//     if (!accountInfo) {
//       console.log(`Account ${publicKeyString} does not exist.`);
//       return;
//     }

//     if (accountInfo.owner.equals(TOKEN_PROGRAM_ID)) {      
      
//       // The authority address is stored in the `owner` field of the token account info
//       const authorityAddress = tokenAccountInfo.owner.toString();
      
//       console.log(`Token account authority address: ${authorityAddress}`);

//       return authorityAddress;
//     } else {
//       console.log(`${publicKeyString} is a System (Wallet) Account or another program-owned account.`);
//     }
 
// }

// getAccountType('8zFK97i84ujjt1oBexHkT82ykuLhywD2k3cL6Tk6T6wU')

// console.log(calculatePdaSync(['proxy', '0x2.icon', uint128ToArray(new BN(1)), new PublicKey('Hch96XZHaSEqaX5LBiMQ9dXVJXCSexJFpMMX5s6mS7ad')], new PublicKey('BknkMw3sonNXVTW2mzuhKEJmmt4PSVei1HbQiDuWVny4')))

