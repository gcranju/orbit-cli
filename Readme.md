# Orbit CLI

## Installation

To install the Orbit CLI tool, follow these steps:

```bash
# Clone the repository
git clone https://github.com/gcranju/orbit-cli
cd orbit-cli

# Checkout the main branch
git checkout main

# Install dependencies
npm install

# Link the package globally
npm link
```
## Usage

After installation, you can use the `orbit` command followed by various subcommands and options.

### Call Command

The `call` command allows you to invoke methods on smart contracts across different blockchains.

**Syntax:**

```bash
orbit call <contract_name> -m <method_name> -p <params> -c <chain> -e <mainnet/testnet> [options]
```

## Options

### `call` Command Options

When using the `call` command, you can specify various options to tailor the behavior of the CLI tool. Below are the available options:

- `-m, --method <method_name>`: **(Required)**  
  Specifies the name of the method to invoke on the smart contract. This should correspond to a valid method defined within the contract.

- `-p, --params <params>`: **(Required)**  
  Provides the parameters for the method in JSON format. Ensure that the JSON structure matches the expected input of the contract method.

- `-c, --chain <chain>`: **(Required)**  
  Defines the blockchain network you wish to interact with. Examples include `solana`, `ethereum`, `avalanche`, `polygon`, etc.

- `-s, --sender <keypair_file_path>`:  
  Path to the sender's Solana keypair file. This file contains the necessary credentials to authorize the transaction on the Solana blockchain.

- `-u, --url <url>`:  
  URL of the target blockchain node. This is the endpoint that the CLI will communicate with to perform the contract call.

- `-e, --env <environment>`:  
  Specifies the environment to use. Accepted values are `mainnet` or `testnet`. Defaults to `testnet` if not provided.

- `--sub-chain <sub_chain>`:  
  Indicates the sub-chain for EVM-compatible chains. Examples include `avalanche`, `polygon`, etc. This option is useful when interacting with specific layers or sidechains within a broader blockchain ecosystem.

### `config` Command Options

The `config` command allows you to set or view configurations for the CLI tool. Below are the available options:

- `-s, --set <key=value>`: **(Set)**  
  Sets a configuration value. Replace `<key=value>` with the desired configuration key and its corresponding value. For example:
  
  ```bash
  orbit config --set solana.xcall.contractAddress=3LWnGCRFuS4TJ5WeDKeWdoSRptB2tzeEFhSBFFu4ogMo
  ```

### Configuration File Structure

The configuration file is typically located at `~/.orbit/config.json`. Below is an example of how the `config.json` is structured:

```json
{
  "solana": {
    "xcall": {
      "contractAddress": "3LWnGCRFuS4TJ5WeDKeWdoSRptB2tzeEFhSBFFu4ogMo"
    },
    "xcall-manager": {
      "contractAddress": "Ganbqm2tJ8SuaN6kSRWsJhXGb7aLCvHLuCySxCfkXPVL"
    },
    "asset-manager": {
      "contractAddress": "4u979CPSHUeJQbCYUAvoki4CQHDiG1257vt2DaJULPV9"
    },
    "balanced-dollar": {
      "contractAddress": "3JfaNQh3zRyBQ3spQJJWKmgRcXuQrcNrpLH5pDvaX2gG"
    },
    "network-id": "solana"
  },
  "solana-test": {
    "xcall": {
      "contractAddress": "BknkMw3sonNXVTW2mzuhKEJmmt4PSVei1HbQiDuWVny4"
    },
    "xcall-manager": {
      "contractAddress": "4eAQxDi6UJokDysb9YMrXNJNcRChotpYory5M5ReD16i"
    },
    "asset-manager": {
      "contractAddress": "5G7Q2xM5qU4UWd3z4CW9YSEiVnfZmTUS1mbhSSZwTEJQ"
    },
    "balanced-dollar": {
      "contractAddress": "Ahs9cC6PMGhasB5zUboUVNBJxAStmX1aeENDiWLz2AXH"
    },
    "network-id": "solana-test"
  }
}
```

