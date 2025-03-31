const { Keypair, Connection, PublicKey } = require('@solana/web3.js');

// Establish a connection to the Solana blockchain
const connection = new Connection(
    "https://rpc.ankr.com/solana/98af665db4f1c6be2ed8ce7d8caed10aade053c5bd7880844d8806b0eada8317",
    'confirmed'
);

// Function to fetch and display account information
async function fetchAccountInfo() {
    try {

        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey;

        const accountInfo = await connection.getAccountInfo(new PublicKey("5Txq5UZvP3XxX8JDhAnaa5nmCuGcdEJLAzsVKTK1vniq"));

        if (accountInfo) {
            console.log("Account Info:", accountInfo);
        } else {
            console.log("Account does not exist or has not been created yet.");
        }

        console.log("Public Key:", publicKey.toBase58());
    } catch (error) {
        console.error("Error fetching account info:", error);
    }
}

// Execute the function
fetchAccountInfo();
