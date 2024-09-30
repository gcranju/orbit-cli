// lib/configCommands.js

const { loadConfig, saveConfig, CONFIG_PATH } = require('./config');

// lib/configCommands.js

function setConfigCommand(keyValue) {
    const [keyPath, value] = keyValue.split('=');
    if (!keyPath || value === undefined) {
      console.error('Invalid format. Use --set key.nestedKey=value');
      process.exit(1);
    }
  
    const keys = keyPath.split('.');
    const config = loadConfig();
    let current = config;
  
    // Traverse the keys to set the value
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key]) {
        current[key] = {};
      }
      current = current[key];
    }
  
    const finalKey = keys[keys.length - 1];
    current[finalKey] = value;
    saveConfig(config);
    console.log(`Configuration saved: ${keyPath} = ${value}`);
  }
  

function viewConfigCommand() {
  const config = loadConfig();
  console.log('Current configurations:', config);
  console.log(`Configuration file location: ${CONFIG_PATH}`);
}

module.exports = {
  setConfigCommand,
  viewConfigCommand,
};
