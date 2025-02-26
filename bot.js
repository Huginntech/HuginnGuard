const { Tendermint37Client } = require("@cosmjs/tendermint-rpc");
const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const { Tx } = require("cosmjs-types/cosmos/tx/v1beta1/tx");

// Replace with your Telegram token
const TELEGRAM_TOKEN = 'YOUR_TELEGRAM_TOKEN_HERE';
const bot = new Telegraf(TELEGRAM_TOKEN);

// Wallet file path
const WALLET_FILE = 'wallet.json';

// Convert Uint8Array to hex string
function uint8ArrayToHex(uint8Array) {
  return Array.from(uint8Array)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

let userAddresses = new Map();

function loadWallets() {
  if (fs.existsSync(WALLET_FILE)) {
    const data = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    userAddresses = new Map(Object.entries(data).map(([chatId, addresses]) =>
      [chatId, addresses.map(({ cosmosAddress, notifiedHashes, notifiedJailed }) => ({
        cosmosAddress,
        notifiedHashes: new Set(notifiedHashes),
        notifiedJailed: new Set(notifiedJailed || [])
      }))]
    ));
  }
}

function saveWallets() {
  const dataToSave = {};
  userAddresses.forEach((addresses, chatId) => {
    dataToSave[chatId] = addresses.map(({ cosmosAddress, notifiedHashes, notifiedJailed }) => ({
      cosmosAddress,
      notifiedHashes: [...notifiedHashes],
      notifiedJailed: [...(notifiedJailed || new Set())]
    }));
  });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(dataToSave));
}

function isValidAddress(address) {
  return /^(cosmos1|celestia1|osmo1)[a-z0-9]{38}$/.test(address);
}

function getNetworkConfig(address) {
  if (address.startsWith('cosmos1')) {
    return {
      rest: 'http://127.0.0.1:1317',
      rpc: 'http://127.0.0.1:RPC_PORT', // Replace RPC_PORT with your port
      denom: 'uatom',
      bankPath: '/cosmos/bank/v1beta1/balances/',
      stakingPath: '/cosmos/staking/v1beta1',
      explorerValidatorURL: 'https://mintscan.io/cosmos/validators'
    };
  } else if (address.startsWith('celestia1')) {
    return {
      rest: 'http://127.0.0.1:12017',
      rpc: 'http://127.0.0.1:RPC_PORT', // Replace RPC_PORT with your port
      denom: 'utia',
      bankPath: '/cosmos/bank/v1beta1/balances/',
      stakingPath: '/cosmos/staking/v1beta1',
      explorerValidatorURL: 'https://mintscan.io/celestia/validators'
    };
  } else if (address.startsWith('osmo1')) {
    return {
      rest: 'http://127.0.0.1:12018',
      rpc: 'http://127.0.0.1:RPC_PORT', // Replace RPC_PORT with your port
      denom: 'uosmo',
      bankPath: '/cosmos/bank/v1beta1/balances/',
      stakingPath: '/cosmos/staking/v1beta1',
      explorerValidatorURL: 'https://mintscan.io/osmosis/validators'
    };
  }
  return null;
}

// /add command to add a wallet address
bot.command('add', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const walletAddress = ctx.message.text.split(' ')[1];

  if (!walletAddress || !isValidAddress(walletAddress)) {
    ctx.reply("Please enter a valid wallet address (starting with 'cosmos1', 'celestia1' or 'osmo1' and 39 characters long).");
    return;
  }

  const userAddressesData = userAddresses.get(chatId) || [];
  const alreadyAdded = userAddressesData.some(({ cosmosAddress: addr }) => addr === walletAddress);
  if (alreadyAdded) {
    ctx.reply(`The address '${walletAddress}' has already been added. Use /balance to check it.`);
    return;
  }

  userAddressesData.push({ cosmosAddress: walletAddress, notifiedHashes: new Set(), notifiedJailed: new Set() });
  userAddresses.set(chatId, userAddressesData);
  saveWallets();

  ctx.reply(`The address '${walletAddress}' has been successfully added. Unbond transactions and validator jail events will be monitored.`);
});

// Convert denom to a friendly name
function friendlyDenom(denom) {
  if (denom === "uatom") return "ATOM";
  if (denom === "utia") return "TIA";
  if (denom === "uosmo") return "OSMO";
  return denom;
}

async function getBalance(address) {
  const config = getNetworkConfig(address);
  if (!config) return { denom: '', amount: "0" };
  try {
    const response = await axios.get(`${config.rest}${config.bankPath}${address}`);
    const balances = response.data.balances || [];
    const tokenBalance = balances.find(balance => balance.denom === config.denom);
    return tokenBalance || { denom: config.denom, amount: "0" };
  } catch (error) {
    console.error(`Error retrieving balance for ${address}:`, error.message);
    return { denom: config.denom, amount: "0" };
  }
}

async function getValidators(address) {
  const config = getNetworkConfig(address);
  if (!config) return {};
  try {
    const response = await axios.get(`${config.rest}${config.stakingPath}/validators?pagination.limit=100000`);
    const validators = response.data.validators.reduce((acc, val) => {
      acc[val.operator_address] = {
        moniker: val.description.moniker,
        jailed: val.jailed
      };
      return acc;
    }, {});
    return validators;
  } catch (error) {
    console.error("Error retrieving validator information:", error.message);
    return {};
  }
}

async function getDelegations(address) {
  const config = getNetworkConfig(address);
  if (!config) return [];
  try {
    const response = await axios.get(`${config.rest}${config.stakingPath}/delegations/${address}`);
    return response.data.delegation_responses || [];
  } catch (error) {
    console.error(`Error retrieving delegations for ${address}:`, error.message);
    return [];
  }
}

// /balance command to show wallet balances and delegation info
bot.command('balance', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const userAddressesData = userAddresses.get(chatId);

  if (!userAddressesData || userAddressesData.length === 0) {
    ctx.reply("You do not have any registered wallet addresses.");
    return;
  }

  const uniqueAddresses = Array.from(new Set(userAddressesData.map(a => a.cosmosAddress)));

  const networks = {
    "Cosmos Hub": uniqueAddresses.filter(address => address.startsWith("cosmos1")),
    "Celestia": uniqueAddresses.filter(address => address.startsWith("celestia1")),
    "Osmosis": uniqueAddresses.filter(address => address.startsWith("osmo1"))
  };

  let responseMessage = "<b>Wallet & Delegation Overview</b>\n\n";

  for (const [network, addresses] of Object.entries(networks)) {
    if (addresses.length > 0) {
      responseMessage += `<b>${network}</b>\n`;
      for (const walletAddress of addresses) {
        const config = getNetworkConfig(walletAddress);
        const balance = await getBalance(walletAddress);
        const tokenAmount = (parseInt(balance.amount) / 1000000).toFixed(6);

        responseMessage += `?? <b>Address:</b> <code>${walletAddress}</code>\n`;
        responseMessage += `?? <b>Balance:</b> ${tokenAmount} ${friendlyDenom(config.denom)}\n`;

        const validators = await getValidators(walletAddress);
        const delegations = await getDelegations(walletAddress);
        if (delegations.length > 0) {
          responseMessage += `?? <b>Delegations:</b>\n`;
          delegations.forEach(delegation => {
            const validatorAddr = delegation.delegation.validator_address;
            const validatorInfo = validators[validatorAddr] || { moniker: "Unknown Validator" };
            const validatorLink = `${config.explorerValidatorURL}/${validatorAddr}`;
            const delegationAmount = (parseInt(delegation.balance.amount) / 1000000).toFixed(6);
            responseMessage += `  • <a href="${validatorLink}">${validatorInfo.moniker}</a>: ${delegationAmount} ${friendlyDenom(config.denom)}\n`;
          });
        } else {
          responseMessage += `?? <i>No Delegations Found</i>\n`;
        }
        responseMessage += `\n`;
      }
      responseMessage += "¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦¦\n\n";
    }
  }

  ctx.reply(responseMessage, { parse_mode: 'HTML' });
});

// /remove command to delete a registered wallet address
bot.command('remove', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const walletAddressToDelete = ctx.message.text.split(' ')[1];

  if (!walletAddressToDelete || !isValidAddress(walletAddressToDelete)) {
    ctx.reply("Please enter a valid wallet address to remove.");
    return;
  }

  const userAddressesData = userAddresses.get(chatId);
  if (!userAddressesData) {
    ctx.reply("You do not have any registered wallet addresses.");
    return;
  }

  const filteredAddresses = userAddressesData.filter(({ cosmosAddress }) => cosmosAddress !== walletAddressToDelete);
  if (filteredAddresses.length === userAddressesData.length) {
    ctx.reply("This address is not registered.");
    return;
  }

  userAddresses.set(chatId, filteredAddresses);
  saveWallets();
  ctx.reply(`The address '${walletAddressToDelete}' has been removed.`);
});

// /start command
bot.command('start', (ctx) => {
  ctx.reply("Huginn Guard monitors your wallet addresses on Cosmos, Celestia, and Osmosis networks and alerts you for significant events.\n\nType /menu to see available commands.");
});

// /menu command
bot.command('menu', (ctx) => {
  ctx.reply("<b>Menu</b>\n\n" +
    "/add - Add a new address\n" +
    "/remove - Remove a registered address\n" +
    "/balance - Check wallet balance\n" +
    "/start - Info about this bot", { parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: "Add Address", callback_data: 'add' }],
          [{ text: "Check Balance", callback_data: 'balance' }],
          [{ text: "Remove Address", callback_data: 'remove' }]
        ]
      }
    });
});

bot.on('callback_query', (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const chatId = ctx.callbackQuery.from.id.toString();

  switch (callbackData) {
    case 'add':
      ctx.telegram.sendMessage(chatId, "Please use the /add command to add an address. Example: /add cosmos1... or /add celestia1... or /add osmo1...");
      break;
    case 'balance':
      ctx.telegram.sendMessage(chatId, "/balance");
      break;
    case 'remove':
      ctx.telegram.sendMessage(chatId, "Please use the /remove command to delete an address. Example: /remove cosmos1... or /remove celestia1... or /remove osmo1...");
      break;
  }
});

function getUnbondQuery(address) {
  if (address.startsWith('cosmos1') || address.startsWith('celestia1') || address.startsWith('osmo1')) {
    return `message.sender='${address}' AND message.action='/cosmos.staking.v1beta1.MsgUndelegate'`;
  }
  return '';
}

async function checkUnbondTransactions() {
  const addressesByRPC = {};
  userAddresses.forEach((addresses, chatId) => {
    addresses.forEach(({ cosmosAddress }) => {
      const config = getNetworkConfig(cosmosAddress);
      if (!config) return;
      if (!addressesByRPC[config.rpc]) {
        addressesByRPC[config.rpc] = [];
      }
      addressesByRPC[config.rpc].push({ address: cosmosAddress, chatId });
    });
  });

  for (const rpc in addressesByRPC) {
    let client;
    try {
      client = await Tendermint37Client.connect(rpc);
    } catch (error) {
      console.error(`Failed to connect to RPC ${rpc}:`, error.message);
      continue;
    }
    for (const { address, chatId } of addressesByRPC[rpc]) {
      try {
        const balance = await getBalance(address);
        if (!balance || parseInt(balance.amount) <= 0) {
          console.log(`No balance for ${address}. Skipping unbond check.`);
          continue;
        }

        const query = getUnbondQuery(address);
        if (!query) continue;
        const request = { query };
        const response = await client.txSearch(request);
        if (!response || !response.txs) {
          console.log(`No unbond transactions for ${address}.`);
          continue;
        }

        const unbondTxHashes = response.txs
          .filter(tx => {
            const decodedTx = Tx.decode(tx.tx);
            return decodedTx.body && decodedTx.body.messages.some(msg => msg.typeUrl.includes('MsgUndelegate'));
          })
          .map(tx => uint8ArrayToHex(tx.hash));

        const userAddressesData = userAddresses.get(chatId) || [];
        const entry = userAddressesData.find(addr => addr.cosmosAddress === address);
        const notifiedHashes = entry ? entry.notifiedHashes : new Set();

        const newUnbondTxHashes = unbondTxHashes.filter(hash => !notifiedHashes.has(hash));

        if (newUnbondTxHashes.length > 0) {
          let explorerTxURL = "";
          if (address.startsWith("cosmos1")) {
            explorerTxURL = "https://mintscan.io/cosmos/tx/";
          } else if (address.startsWith("celestia1")) {
            explorerTxURL = "https://mintscan.io/celestia/tx/";
          } else if (address.startsWith("osmo1")) {
            explorerTxURL = "https://mintscan.io/osmosis/tx/";
          }
          const txLinks = newUnbondTxHashes
            .map(hash => `<a href="${explorerTxURL}${hash}">${hash}</a>`)
            .join(', ');
          
          const message = `?? Your wallet ${address} initiated an unbond (undelegate) transaction: ${txLinks}.\nIf this wasn't you, please contact support.`;
          bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
          newUnbondTxHashes.forEach(hash => notifiedHashes.add(hash));
          saveWallets();
        }
      } catch (error) {
        console.error(`Error processing ${address}:`, error.message);
      }
    }
  }
}

async function checkValidatorJailStatus() {
  for (const [chatId, addresses] of userAddresses.entries()) {
    for (const entry of addresses) {
      const walletAddress = entry.cosmosAddress;
      const config = getNetworkConfig(walletAddress);
      if (!config) continue;
      const delegations = await getDelegations(walletAddress);
      if (delegations.length === 0) continue;
      const validators = await getValidators(walletAddress);
      for (const delegation of delegations) {
        const validatorAddr = delegation.delegation.validator_address;
        const validatorInfo = validators[validatorAddr];
        if (validatorInfo && validatorInfo.jailed) {
          if (!entry.notifiedJailed.has(validatorAddr)) {
            const message = `?? Your wallet ${walletAddress} is delegating to validator ${validatorInfo.moniker} (${validatorAddr}), which is currently jailed.`;
            bot.telegram.sendMessage(chatId, message);
            entry.notifiedJailed.add(validatorAddr);
          }
        }
      }
    }
  }
  saveWallets();
}

setInterval(checkUnbondTransactions, 60000);
setInterval(checkValidatorJailStatus, 60000);

loadWallets();
bot.launch();
