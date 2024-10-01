// lib/call.js

const path = require('path');
const allowedContracts = require('./allowedContracts');
const supportedChains = require('./supportedChains');
const { askYesNoQuestion } = require('./helpers');

module.exports = async function callCommand(contractName, options) {
  const { method, params, chain, env } = options;

  console.log(`Calling contract '${contractName}' on chain '${chain}' (${env} environment)`);
  console.log(`Method: ${method}`);
  console.log(`Parameters: ${params}`);
  await askYesNoQuestion('Do you want to continue?');

  if (!allowedContracts.includes(contractName)) {
    console.error(`Invalid contract name '${contractName}'. Allowed contracts are: ${allowedContracts.join(', ')}`);
    process.exit(1);
  }

  let parsedParams;
  try {
    parsedParams = JSON.parse(params);
  } catch (error) {
    console.error('Invalid JSON format for --params');
    process.exit(1);
  }

  if (chain.toLowerCase() === 'evm') {
    if (!subChain) {
      console.error('EVM chain requires --sub-chain option.');
      process.exit(1);
    }
    if (!supportedChains.evm.includes(subChain)) {
      console.error(`Invalid sub-chain '${subChain}'. Supported EVM sub-chains are: ${supportedChains.evm.join(', ')}`);
      process.exit(1);
    }
  } else if (!supportedChains.hasOwnProperty(chain.toLowerCase())) {
    console.error(`Unsupported chain '${chain}'. Supported chains are: ${Object.keys(supportedChains).join(', ')}`);
    process.exit(1);
  }

  let chainModulePath;
  if (chain.toLowerCase() === 'evm') {
    chainModulePath = path.join(__dirname, 'chains', 'evm.js');
  } else {
    chainModulePath = path.join(__dirname, 'chains', `${chain.toLowerCase()}.js`);
  }

  let chainModule;
  try {
    chainModule = require(chainModulePath);
  } catch (error) {
    console.error(`Unsupported chain '${chain}'. Ensure there is a module at ${chainModulePath}`);
    process.exit(1);
  }

  try {
    await chainModule.callContractMethod(contractName, method, parsedParams, env, options);
  } catch (error) {
    console.error(`Error calling contract method: ${error.message}`);
    process.exit(1);
  }
};
