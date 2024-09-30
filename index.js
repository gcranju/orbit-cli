// index.js

const { Command } = require('commander');
const callCommand = require('./lib/call');
const { setConfigCommand, viewConfigCommand } = require('./lib/configCommands');
const program = new Command();

program
  .name('orbit')
  .description('A CLI tool to call contract methods across multiple blockchains.')
  .version('1.0.0');

// index.js

program
  .command('call <contract_name>')
  .description('Call a method on a smart contract.')
  .requiredOption('-m, --method <method_name>', 'Method name to invoke')
  .requiredOption('-p, --params <params>', 'Method parameters in JSON format')
  .requiredOption('-c, --chain <chain>', 'Blockchain to interact with')
  .option('-s, --sender <keypair_file_path>', 'Path to the sender\'s Solana keypair file')
  .option('-e, --env <environment>', 'Environment (mainnet/testnet)', 'testnet')
  .option('--sub-chain <sub_chain>', 'Sub-chain for EVM chains (e.g., avalanche, polygon)')
  .action(callCommand);

program
  .command('config')
  .description('Configure the CLI tool')
  .option('-s, --set <key=value>', 'Set a configuration value')
  .option('-v, --view', 'View current configurations')
  .action((options) => {
    if (options.set) {
      setConfigCommand(options.set);
    } else if (options.view) {
      viewConfigCommand();
    } else {
      console.log('Please specify an option. Use --help for more information.');
    }
  });

program.parse(process.argv);
