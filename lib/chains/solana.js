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
        const { sender } = options;

        // Load configurations
        const config = loadConfig();
        const chainConfig = config.solana;
        if (!chainConfig) {
            throw new Error('Solana configuration not found. Please set it using the "config" command.');
        }

        const networkId = chainConfig['network-id'] || (env === 'mainnet' ? 'mainnet-beta' : 'testnet');
        const networkUrl = getNetworkUrl(networkId);
        if (!networkUrl) {
            throw new Error(`Unknown network ID '${networkId}'`);
        }

        const connection = new Connection(networkUrl, 'confirmed');


        // Get the contract address
        let contractAddress;

        const contractConfig = chainConfig[contractName];
        if (!contractConfig) {
            throw new Error(`Contract '${contractName}' configuration not found for Solana.`);
        }
        contractAddress = contractConfig.contractAddress;
        if (!contractAddress) {
            throw new Error(`Contract address for '${contractName}' not set in configuration.`);
        }

        // Load sender's keypair (handle securely)
        const senderKeypair = await loadSenderKeypair(sender);
        const senderPublicKey = senderKeypair.publicKey.toBase58();

        console.log(`Using sender address: ${senderPublicKey}`);


        // Handle the method call
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
            case 'centralized-connection':
                await handleCentralizedConnectionMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            case 'xcall-manager':
                await handleXCallManagerMethods(method, params, connection, senderKeypair, chainConfig);
                break;
            default:
                throw new Error(`Contract '${contractName}' is not supported.`);
        }
    },
};

const {
    calculatePdaSync,
    initializeProgram,
    fetchMintToken,
    getConnectionAccounts,
    getXCallAccounts,
    fetchWhitelistedActions,
    logger
} = helpers;

function getNetworkUrl(networkId) {
    const networkMap = {
        'mainnet-beta': clusterApiUrl('mainnet-beta'),
        'testnet': clusterApiUrl('testnet'),
        'devnet': clusterApiUrl('devnet'),
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
            const assetManagerId = new PublicKey(chainConfig['asset-manager'].contractAddress);
            await setAdmin(params, connection, senderKeypair, assetManagerId);
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
        case 'set_network_fees':
            await setNetworkFees(params, connection, senderKeypair, chainConfig);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for asset-manager.`);
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
        .initialize(xcall_program, icon_asset_manager, admin, xcall_manager_state)
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
    const centralizedId = new PublicKey(params.centralized);
    const network_id = new PublicKey(params.nid);

    const statePda = await calculatePdaSync(['config'], centralizedId);
    const authorityPda = await calculatePdaSync(['connection_authority'], centralizedId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(centralizedId, provider());

    let configureIx = await program.methods
        .initialize(xcall_program, icon_asset_manager, network_id, xcall_manager_state)
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
        logger.error(`Failed Initializing Centralized Connection ${centralizedId.publicKey}: ${error.message}`);
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
        case 'set_admin':
            const balancedDollarId = new PublicKey(chainConfig['balanced-dollar'].contractAddress);
            await setAdmin(params, connection, senderKeypair, balancedDollarId);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for balanced-dollar.`);
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
        case 'set_admin':
            const xcall = new PublicKey(chainConfig['xcall'].contractAddress) || new PublicKey(params.xcall);
            await setAdminX(params, connection, senderKeypair, xcall);
            break;
        default:
            throw new Error(`Method '${method}' is not supported for xcall.`);
    }
}

async function setProtocolFee(params, connection, senderKeypair, chainConfig) {
    const xcall = new PublicKey(chainConfig['xcall'].contractAddress) || new PublicKey(params.xcall);
    const fee = new anchor.BN(params.fee);

    const statePda = await calculatePdaSync(['config'], xcall);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(xcall, provider());

    let configureIx = await program.methods
        .setProtocolFee(fee)
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
        logger.error(`Failed to set Protocol Fee: ${error.message}`);
        throw error;
    }
}

async function setFeeHandler(params, connection, senderKeypair, chainConfig) {
    const xcall = new PublicKey(chainConfig['xcall'].contractAddress) || new PublicKey(params.xcall);
    const feeHandler = new PublicKey(params.feeHandler);

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
            const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
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
    const assetManagerId = new PublicKey(chainConfig['asset-manager'].contractAddress);
    const assetToken = params.asset_token ? new PublicKey(params.asset_token) : SystemProgram.programId;
    const period = new anchor.BN(params.period);
    const percentage = new anchor.BN(params.percentage);

    const statePda = await calculatePdaSync(['state'], assetManagerId);
    const token_state = await calculatePdaSync(['token_state', assetToken], assetManagerId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(assetManagerId, provider());

    let configureIx = await program.methods
        .configureRateLimit(assetToken, period, percentage)
        .accountsStrict({
            admin: senderKeypair.publicKey,
            state: statePda,
            tokenState: token_state,
            systemProgram: SystemProgram.programId,
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

async function setAdmin(params, connection, senderKeypair, programId) {
    programId = new PublicKey(programId)
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
    const data = Buffer.from(params.data, 'hex')
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

    tx.add(depositTokenIx);

    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Transaction Signature: ${txSignature}`);
    } catch (error) {
        logger.error(`Error sending deposit transaction: ${error.message}`);
        throw error;
    }
}

async function depositToken(params, connection, senderKeypair, chainConfig) {
    const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const assetManagerId = new PublicKey(chainConfig['asset-manager'].contractAddress);
    const assetToken = new PublicKey(params.asset_token);

    const amount = new anchor.BN(params.amount, 10, 'le');
    const to = params.to
    const data = Buffer.from(params.data, 'hex')
    const toNid = params.to.split('/')[0]

    const asset_manager = await initializeProgram(assetManagerId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    async function createTokenAccount(wallet) {
        let tokenAccount = await getOrCreateAssociatedTokenAccount(
            provider().connection,
            senderKeypair,
            assetToken,
            wallet,
            true
        );
        return tokenAccount
    }

    console.log(`Executing 'depositToken' on 'asset-manager' contract.`);

    const vaultPda = await calculatePdaSync(['vault', assetToken], assetManagerId);
    const statePda = await calculatePdaSync(['state'], assetManagerId);
    const xcallManagerStatePda = await calculatePdaSync(['state'], xcallManagerId);
    const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);
    const xcallAuthorityPda = await calculatePdaSync(['dapp_authority'], assetManagerId);

    const depositorTokenAccount = await createTokenAccount(senderKeypair.publicKey);
    const vaultTokenAccount = await createTokenAccount(vaultPda);

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1000000,
    });

    let tx = new Transaction().add(computeBudgetIx);

    let xcallAccounts = await getXCallAccounts(xcallProgramId, provider());
    let connectionAccounts = await getConnectionAccounts(toNid, xcallManagerId, provider());

    const depositTokenIx = await asset_manager.methods
        .depositToken(amount, to, data)
        .accounts({
            from: depositorTokenAccount.address,
            fromAuthority: senderKeypair.publicKey,
            vaultTokenAccount: vaultTokenAccount.address,
            valultAuthority: vaultPda, // Ensure this PDA is correct
            vaultNativeAccount: null,
            state: statePda,
            xcallManagerState: xcallManagerStatePda,
            xcallConfig: xcallConfigPda,
            xcall: xcallProgramId,
            xcallManager: xcallManagerId,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            xcallAuthority: xcallAuthorityPda,
        })

        .remainingAccounts([
            ...xcallAccounts,
            ...connectionAccounts
        ])
        .signers([senderKeypair.payer]).instruction();

    tx.add(depositTokenIx);

    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Transaction Signature: ${txSignature}`);
    } catch (error) {
        logger.error(`Error sending deposit transaction: ${error.message}`);
        throw error;
    }
}

async function crossTransfer(params, connection, senderKeypair, chainConfig) {
    const xcallProgramId = new PublicKey(chainConfig['xcall'].contractAddress);
    const xcallManagerId = new PublicKey(chainConfig['xcall-manager'].contractAddress);
    const balancedDollarId = new PublicKey(chainConfig['balanced-dollar'].contractAddress);

    const mintToken = await fetchMintToken(balancedDollarId, provider());

    const amount = new anchor.BN(params.amount);
    const to = params.to
    const data = params.data ? Buffer.from(params.data, 'hex') : Buffer.alloc(0)
    const toNid = params.to.split('/')[0]

    const balanced_dollar = await initializeProgram(balancedDollarId, provider());
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }

    async function createTokenAccount(wallet) {
        let tokenAccount = await getOrCreateAssociatedTokenAccount(
            provider().connection,
            senderKeypair,
            mintToken,
            wallet,
            true
        );
        return tokenAccount
    }

    console.log(`Executing 'crossTransfer' on 'balanced-dollar' contract.`);

    const statePda = await calculatePdaSync(['state'], balancedDollarId);
    const xcallManagerStatePda = await calculatePdaSync(['state'], xcallManagerId);
    const xcallConfigPda = await calculatePdaSync(['config'], xcallProgramId);
    const xcallAuthorityPda = await calculatePdaSync(['dapp_authority'], balancedDollarId);

    const associatedTokenAcc = await createTokenAccount(senderKeypair.publicKey);

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

    tx.add(crossTransferTx);

    try {
        const txSignature = await provider().sendAndConfirm(tx);
        logger.info(`Transaction Signature: ${txSignature}`);
    } catch (error) {
        logger.error(`Error sending cross transfer transaction: ${error.message}`);
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
    const networkFeePda = await calculatePdaSync(['network_fee', nid], centralizedId);
    function provider() {
        return new anchor.AnchorProvider(connection, new anchor.Wallet(senderKeypair), {});
    }
    const program = await initializeProgram(centralizedId, provider());

    let configureIx = await program.methods
        .setFee(nid, messageFee, responseFee)
        .accountsStrict({
            config: statePda,
            networkFee: networkFeePda,
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

module.exports = {
    callContractMethod: module.exports.callContractMethod,
    depositNative,
    deposit: depositToken,
    // Export other methods if necessary
};