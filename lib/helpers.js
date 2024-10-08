// lib/helpers.js

const { PublicKey, Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const borsh = require('borsh');
const anchor = require('@coral-xyz/anchor');
const winston = require('winston');
const readline = require('readline');

// Create an interface for reading input and writing output
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
function askYesNoQuestion(question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        const normalizedAnswer = answer.trim().toLowerCase();
  
        if (normalizedAnswer === 'yes' || normalizedAnswer === 'y') {
          resolve(true);
        } else if (normalizedAnswer === 'no' || normalizedAnswer === 'n') {
          resolve(false);
          process.exit(1);
        } else {
          console.log("Please answer with 'yes' or 'no'.\n");
          // Ask the question again recursively for invalid input
          resolve(askYesNoQuestion(question));
        }
      });
    });
  }

// Create a new winston logger instance
const logger = winston.createLogger({
    level: 'info', // Set the logging level
    format: winston.format.combine(
        winston.format.timestamp(), // Add timestamp to each log entry
        winston.format.json()       // Format logs as JSON
    ),
    transports: [
        // Console transport: logs to the console
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),  // Colorize output for better readability in console
                winston.format.simple()     // Simple format with level and message
            ),
        }),
        // File transport: logs to a file
        new winston.transports.File({
            filename: 'application.log', // File name for the log file
            format: winston.format.combine(
                winston.format.timestamp(), // Include timestamp in file logs
                winston.format.json()       // Log as JSON in the file
            )
        })
    ],
});

/**
 * Converts a number to a 128-bit unsigned integer array (Big Endian).
 * @param {BigInt | string | number} num
 * @returns {Uint8Array}
 */
function uint128ToArray(num) {
    if (typeof num === 'string' || typeof num === 'number') {
        num = BigInt(num);
    } else if (!(num instanceof BigInt)) {
        throw new Error('Input must be a BigInt or convertible to a BigInt.');
    }

    let buffer = new ArrayBuffer(16);
    let view = new DataView(buffer);

    view.setBigUint64(0, num >> BigInt(64), false);
    view.setBigUint64(8, num & BigInt('0xFFFFFFFFFFFFFFFF'), false);

    return new Uint8Array(buffer);
}

/**
 * Calculates the Program Derived Address (PDA) based on seed and program ID.
 * @param {string} seed
 * @param {PublicKey} programId
 * @returns {PublicKey}
 */

async function findPda(seeds, programId) {
    // Convert all seeds to buffers
    const buffers = seeds.map(seed => {
        if (typeof seed === 'string') {
            return Buffer.from(seed);
        } else if (Buffer.isBuffer(seed)) {
            return seed;
        } else if (seed instanceof PublicKey) {
            return seed.toBuffer();
        } else if (typeof seed === 'number') {
            return Buffer.from([seed]);
        } else {
            return seed;
        }
    });

    // Find the PDA
    const [pda, bump] = PublicKey.findProgramAddressSync(buffers, programId);

    return pda
}

/**
 * Initializes the Anchor program.
 * @param {PublicKey} programId
 * @param {AnchorProvider} provider
 * @returns {Program}
 */
async function initializeProgram(programId, provider) {
    const idl = await anchor.Program.fetchIdl(programId, provider);
    if (!idl) {
        throw new Error('Failed to fetch IDL for the program.');
    }
    const program = new anchor.Program(idl, provider);
    return program;
}

/**
 * Fetch xcall-config
 * @returns {Object}
 * @throws {Error}
 */
async function fetchXcallConfig(programId, provider) {
    try {
        const xcall_program = await initializeProgram(programId, provider);
        const xcall_state = await findPda(['config'], programId);
        const config = await xcall_program.account.config.fetch(xcall_state);
        return config
    } catch (error) {
        console.error('Error fetching xcall-config:', error.message);
        throw error;
    }
}

async function fetchMintToken(programId, provider) {
    try {
        const program = await initializeProgram(programId, provider);
        const state = await findPda(['state'], programId);
        const config = await program.account.state.fetch(state);
        return config.bnUsdToken
    } catch (error) {
        console.error('Error fetching mintToken:', error.message);
        throw error;
    }
}
//'{"amount":1000,"to":"0x2.icon/hxea3635f7495653d8596a7f23a78514b6ad1470e8","data":"0x","asset_token": "GjrMm15xQah6X4Af5toAwow9SwULmUTCKAHrXtuMoSm3"}'
/**
 * Loads the sender's keypair from a file path or default location.
 * @param {string} senderPath - Path to the keypair file.
 * @returns {Keypair}
 */
function loadSenderKeypair(senderPath) {
    let keypairPath;

    if (senderPath) {
        keypairPath = path.resolve(senderPath);
        if (!fs.existsSync(keypairPath)) {
            throw new Error(`Sender keypair file not found at path: ${keypairPath}`);
        }
    } else {
        keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
        if (!fs.existsSync(keypairPath)) {
            throw new Error(
                `Default Solana keypair file not found at path: ${keypairPath}. Please provide a keypair file using the --sender option.`
            );
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

/**
 * Fetches centralized contracts from the xcall-manager contract.
 * @param {Connection} connection
 * @param {PublicKey} xcallManagerId
 * @returns {Array<string>}
 */
async function fetchCentralizedContracts(xcallManagerId, provider) {
    try {
        const program = await initializeProgram(xcallManagerId, provider);
        const xcall_manager_state = await findPda(['state'], xcallManagerId);
        const config = await program.account.xmState.fetch(xcall_manager_state);
        console.log(config)
        return config.sources
    } catch (error) {
        console.error('Error fetching centralized contracts:', error.message);
        throw error;
    }
}

async function fetchWhitelistedActions(xcallManagerId, provider) {
    try {
        const program = await initializeProgram(xcallManagerId, provider);
        const xcall_manager_state = await findPda(['state'], xcallManagerId);
        const config = await program.account.xmState.fetch(xcall_manager_state);
        console.log(config.whitelistedActions)
        return config.whitelistedActions
    } catch (error) {
        console.error('Error fetching centralized contracts:', error.message);
        throw error;
    }
}

async function getXCallAccounts(xcallProgramId, provider){
    const xcallConfigPda = await findPda(['config'], xcallProgramId);
    const xcallConfigAccount = await fetchXcallConfig(xcallProgramId, provider);
    const rollbackPda = await findPda(['rollback', uint128ToArray(xcallConfigAccount.sequenceNo.toNumber() + 1)], xcallProgramId);

    let xcallAccounts = [{
        pubkey: xcallConfigPda,
        isSigner: false,
        isWritable: true,
    },
    {
        pubkey: rollbackPda,
        isSigner: false,
        isWritable: true,
    },
    {
        pubkey: new PublicKey("Sysvar1nstructions1111111111111111111111111"),
        isSigner: false,
        isWritable: false,
    },
    {
        pubkey: new PublicKey(xcallConfigAccount.feeHandler),
        isSigner: false,
        isWritable: true,
    }]

    return xcallAccounts
}

async function getConnectionAccounts(nid,xcallManagerId, provider){
    // Fetch centralized contracts from xcall-manager
    const centralizedContracts = await fetchCentralizedContracts(xcallManagerId, provider);    

    let connectionAccounts = await Promise.all(
        centralizedContracts.map(async (contractPubkeyStr) => [
            {
                pubkey: new PublicKey(contractPubkeyStr),
                isSigner: false,
                isWritable: true,
            },
            ...[
                {
                    pubkey: await findPda(['config'], new PublicKey(contractPubkeyStr)),
                    isSigner: false,
                    isWritable: true,
                },
                {
                    pubkey: await findPda(['fee', nid], new PublicKey(contractPubkeyStr)),
                    isSigner: false,
                    isWritable: true,
                }
            ]
        ])
    );
    connectionAccounts = [].concat(...connectionAccounts);

    return connectionAccounts
}

module.exports = {
    uint128ToArray,
    calculatePdaSync: findPda,
    initializeProgram,
    loadSenderKeypair,
    fetchCentralizedContracts,
    fetchXcallConfig,
    getConnectionAccounts,
    getXCallAccounts,
    fetchMintToken,
    fetchWhitelistedActions,
    askYesNoQuestion,
    rl,
    logger
};
