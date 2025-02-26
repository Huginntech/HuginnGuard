# Huginn Guard

Huginn Guard is a Telegram bot developed to help secure your staked assets from compromised wallets. If an undelegate transaction occurs without your knowledge, the bot will automatically notify you so that you can take prompt action. Additionally, if your validator becomes jailed, you will receive an immediate alert. With Huginn Guard, you can monitor your wallet balances, delegation details, and critical staking events all from a single interface.

## Features

- **Asset Protection:** Get notified immediately if an undelegate (unstake) transaction occurs without your initiation.
- **Validator Alerts:** Receive alerts if any of your validators get jailed.
- **Wallet Monitoring:** Easily check your wallet balances and delegation details via Telegram.
- **User-Friendly Interface:** Add and remove wallet addresses with simple commands.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (version 12 or higher recommended)
- npm (or yarn)
- A Telegram Bot Token (create one using [BotFather](https://t.me/BotFather))
- *(Optional)* SSH keys or a Personal Access Token for GitHub (if you plan to contribute)

### Steps

#### 1. Clone the Repository

Open your terminal and run:

```bash
git clone https://github.com/Huginntech/HuginnGuard.git
cd HuginnGuard

npm install

Run the Bot
node index.js

