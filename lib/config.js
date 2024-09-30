// lib/config.js

const os = require('os');
const path = require('path');
const fs = require('fs');
const solanaWeb3 = require('@solana/web3.js');

const CONFIG_DIR = path.join(os.homedir(), '.orbit');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

// Load configurations from the config file
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    const configData = fs.readFileSync(CONFIG_PATH, 'utf-8');
    try {
      return JSON.parse(configData);
    } catch (error) {
      console.error('Error parsing config file:', error.message);
      return {};
    }
  } else {
    return {};
  }
}

// Save configurations to the config file
function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

async function convert(hexSeed) {
  const seed = Uint8Array.from(Buffer.from(hexSeed, 'hex'));
  // Ensure the seed is exactly 32 bytes
  if (seed.length !== 32) {
      throw new Error('Seed must be exactly 32 bytes.');
  }
  const keypair = solanaWeb3.Keypair.fromSeed(seed);
  console.log("Public Key:", keypair.publicKey.toBase58());
}

module.exports = {
  loadConfig,
  saveConfig,
  CONFIG_PATH,
};
