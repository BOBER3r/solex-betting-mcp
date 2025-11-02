# MCP Server Integration Guide - Sol Bets Backend

**For**: MCP Development Team
**Backend**: Sol Bets v3 API
**Payment Protocol**: x402 (Solana USDC micropayments)

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Backend API Reference](#backend-api-reference)
4. [x402 Payment Integration](#x402-payment-integration)
5. [MCP Tools to Implement](#mcp-tools-to-implement)
6. [Code Examples](#code-examples)
7. [Error Handling](#error-handling)
8. [Testing](#testing)
9. [Production Deployment](#production-deployment)

---

## Overview

### What You're Building

An MCP (Model Context Protocol) server that provides AI agents with tools to:
- Search and discover betting markets
- Analyze odds and statistics
- Calculate bet outcomes
- Track portfolio positions
- Place bets on prediction markets

### Payment Model

The backend uses **x402 protocol** for API monetization:
- AI agents pay **per API call** in USDC (on Solana)
- Payments are **automatic** and **transparent**
- No subscriptions, no upfront costs
- Sub-second payment confirmation (~400ms)

### Tech Stack Required

```json
{
  "dependencies": {
    "@x402-solana/client": "^0.1.0",
    "@solana/web3.js": "^1.95.0",
    "@modelcontextprotocol/sdk": "latest"
  }
}
```

---

## Quick Start

### 1. Install Dependencies

```bash
npm install @x402-solana/client @solana/web3.js
```

### 2. Initialize x402 Client

```typescript
import { X402Client } from '@x402-solana/client';

const x402Client = new X402Client({
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY, // Base58 encoded
  network: process.env.NETWORK || 'devnet',
});
```

### 3. Make Your First Request

```typescript
// x402 client handles 402 Payment Required automatically
const response = await x402Client.fetch(
  'https://api.solex.bet/api/markets?category=crypto'
);
const markets = await response.json();
```

**That's it!** The client automatically:
1. Receives `402 Payment Required` response
2. Creates USDC payment transaction
3. Waits for confirmation (~400ms)
4. Retries request with payment proof
5. Returns data

---

## Backend API Reference

### Base URL

- **Production**: `https://api.solex.bet`
- **Staging**: `https://staging-api.solex.bet`
- **Development**: `http://localhost:3000`

### Authentication

Most endpoints are `@Public()` and don't require JWT auth. The only authentication needed is x402 payment for premium endpoints.

---

## 📊 Available Endpoints

### **Markets** (Discovery & Search)

#### 🆓 FREE: Get Single Market
```http
GET /api/markets/:id
```
**Use Case**: Get basic market details for discovery
**Response**: Full market details including title, description, odds, status

#### 💰 PAID ($0.005): Search Markets
```http
GET /api/markets?search=bitcoin&category=crypto&status=active
```
**Use Case**: Search and filter markets
**Parameters**:
- `search` (optional): Search query
- `category` (optional): crypto, sports, politics, entertainment, other
- `status` (optional): active, resolved
- `onlyWhitelisted` (optional): true/false (official markets only)
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 20, max: 100)

**Response**:
```typescript
{
  markets: Array<{
    id: string;
    title: string;
    description: string;
    category: string;
    creatorAddress: string;
    totalVolumeSol: string;
    totalVolumeUsdc: string;
    yesPrice: number;  // 0-100
    noPrice: number;   // 0-100
    resolved: boolean;
    outcome: boolean | null;
    // ... more fields
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

#### 💰 PAID ($0.01): Get Trending Markets
```http
GET /api/markets/trending
```
**Use Case**: Discover hot markets with high volume
**Response**: Array of top 10 trending markets

#### 💰 PAID ($0.008): Get Market Statistics
```http
GET /api/markets/:id/stats
```
**Use Case**: Deep analytics on specific market
**Response**: Volume, bet count, unique bettors, distribution

#### 💰 PAID ($0.005): Get Current Odds
```http
GET /api/markets/:id/odds
```
**Use Case**: Real-time price for yes/no outcomes
**Response**: Current odds with liquidity depth

#### 💰 PAID ($0.003): Get Market Bets
```http
GET /api/markets/:id/bets?page=1&limit=20
```
**Use Case**: See all bets placed on market
**Response**: Paginated bet history

---

### **Betting** (Place Bets & Calculate)

#### 🆓 FREE: Place Bet
```http
POST /api/betting/place-bet
```
**Body**:
```typescript
{
  marketId: string;
  amount: string;        // In SOL or USDC (e.g., "1.5")
  betYes: boolean;
  betterAddress: string;
  mint: string;          // SOL or USDC mint address
}
```
**Use Case**: Execute bet transaction
**Response**: Transaction signature
**Note**: FREE because user already pays in their bet amount

#### 💰 PAID ($0.01): Calculate Odds
```http
POST /api/betting/calculate-odds
```
**Body**:
```typescript
{
  marketId: string;
  amount: string;
  betYes: boolean;
}
```
**Use Case**: Simulate bet to see outcome before placing
**Response**: Expected shares, price impact, fees

#### 🆓 FREE: Get User Bets
```http
GET /api/betting/user/:wallet/bets?page=1&limit=20
```
**Use Case**: View betting history for a wallet
**Response**: Paginated list of user's bets

#### 💰 PAID ($0.005): Get Position
```http
GET /api/betting/position/:marketId/:wallet
```
**Use Case**: Check user's position in specific market
**Response**: Shares held, average price, current value, PnL

---

### **Oracle** (Market Resolution Data)

#### 🆓 FREE: Register Oracle
```http
POST /api/oracle/register
```
**Body**:
```typescript
{
  address: string;
  name: string;
  description: string;
}
```
**Use Case**: Register as oracle to resolve markets
**Response**: Oracle details

#### 💰 PAID ($0.002): List All Oracles
```http
GET /api/oracle
```
**Use Case**: Discover available oracles
**Response**: Array of oracle details

#### 💰 PAID ($0.002): Get Oracle Details
```http
GET /api/oracle/:address
```
**Use Case**: Check oracle reputation and stats
**Response**: Oracle info, resolution history

#### 💰 PAID ($0.005): Get Oracle Stats
```http
GET /api/oracle/:address/stats
```
**Use Case**: Analyze oracle performance
**Response**: Total resolutions, accuracy, markets resolved

#### 💰 PAID ($0.02): Get Pending Resolutions
```http
GET /api/oracle/pending-resolutions
```
**Use Case**: Find markets needing oracle resolution
**Response**: Markets awaiting outcome
**Note**: Premium pricing - high-value data for oracle agents

---

### **Portfolio** (User Portfolio & Positions)

#### 🆓 FREE: Top Wallets Leaderboard
```http
GET /api/portfolio/top-wallets?limit=10&sortBy=volume
```
**Parameters**:
- `limit`: 1-100 (default: 10)
- `sortBy`: volume, pnl, winRate, fees

**Use Case**: Public leaderboard
**Response**: Top performers by metric

#### 💰 PAID ($0.01): Get Portfolio Stats
```http
GET /api/portfolio/:userAddress
```
**Use Case**: Comprehensive portfolio analysis
**Response**: Total positions, PnL, win rate, active markets

#### 🆓 FREE: Get User Fees Earned
```http
GET /api/portfolio/:userAddress/fees
```
**Use Case**: Check fees earned from created markets
**Response**: SOL/USDC fees, distributed vs pending

#### 🆓 FREE: Get Position Summary
```http
GET /api/portfolio/:userAddress/:marketId
```
**Use Case**: Specific market position
**Response**: Shares, cost basis, current value

#### 🆓 FREE: Claim Winnings
```http
POST /api/portfolio/claim
```
**Body**:
```typescript
{
  marketId: string;
  userAddress: string;
}
```
**Use Case**: Claim winnings from resolved market
**Response**: Transaction signature

---

### **Protocol** (Platform Statistics)

#### 💰 PAID ($0.015): Get Protocol Stats
```http
GET /api/protocol/stats
```
**Use Case**: Platform-wide analytics
**Response**: Total volume, fees, markets, TVL

#### 🆓 FREE: Get Fee Configuration
```http
GET /api/protocol/fees
```
**Use Case**: Check current fee structure
**Response**: Creator fee %, protocol fee %, oracle fee %

#### 🆓 FREE: Calculate Fees
```http
GET /api/protocol/fees/calculate?amount=10
```
**Use Case**: Estimate fees before betting
**Response**: Creator fee, protocol fee, net amount

---

### **Creators** (Market Creator Tools)

All creator endpoints are **FREE** to encourage market creation:

#### 🆓 FREE: Get Creator Stats
```http
GET /api/creators/:address/stats
```
**Response**: Total markets, volume, fees earned

#### 🆓 FREE: Get Creator Fees
```http
GET /api/creators/:address/fees
```
**Response**: Detailed fee breakdown by market

#### 🆓 FREE: Get Creator Markets
```http
GET /api/creators/:address/markets?status=active&page=1&limit=20
```
**Response**: Paginated markets created by address

---

## x402 Payment Integration

### How It Works

```
┌─────────────┐
│  MCP Server │
└──────┬──────┘
       │ 1. HTTP Request
       ▼
┌──────────────────┐
│  Sol Bets API    │
└──────┬───────────┘
       │ 2. Returns 402 Payment Required
       │    + Payment details (amount, wallet)
       ▼
┌──────────────────┐
│  x402 Client     │ ← Automatically handles this
└──────┬───────────┘
       │ 3. Creates USDC transaction on Solana
       │ 4. Waits for confirmation (~400ms)
       │ 5. Retries request with X-PAYMENT header
       ▼
┌──────────────────┐
│  Sol Bets API    │
└──────┬───────────┘
       │ 6. Verifies transaction on-chain
       │ 7. Returns requested data
       ▼
┌──────────────────┐
│  MCP Server      │
└──────────────────┘
```

### x402 Client Setup

```typescript
import { X402Client } from '@x402-solana/client';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Load wallet from environment
const walletPrivateKey = process.env.WALLET_PRIVATE_KEY; // Base58 string
const keypair = Keypair.fromSecretKey(bs58.decode(walletPrivateKey));

// Initialize client
const x402 = new X402Client({
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  walletPrivateKey: walletPrivateKey,
  network: process.env.NETWORK || 'devnet',
});

// Client is ready to use
const response = await x402.fetch('https://api.solex.bet/api/markets/trending');
const data = await response.json();
```

### Payment Costs

| Request Type | Avg Cost | Monthly (100 agents, 10 req/day) |
|--------------|----------|----------------------------------|
| Market search | $0.005 | $50 |
| Odds calculation | $0.01 | $100 |
| Position check | $0.005 | $50 |
| Protocol stats | $0.015 | $150 |
| **Total** | **~$0.035/day** | **~$350/month** |

**Note**: This is extremely cost-effective compared to traditional API subscriptions ($50-200/month regardless of usage).

---

## MCP Tools to Implement

### Recommended MCP Tool Structure

Create tools that map to backend endpoints. Here's the complete toolkit:

### 1. **search_markets**
```typescript
{
  name: 'search_markets',
  description: 'Search for betting markets by keyword, category, or status. Returns paginated results.',
  parameters: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: 'Search query (e.g., "bitcoin", "election")',
      },
      category: {
        type: 'string',
        enum: ['crypto', 'sports', 'politics', 'entertainment', 'other'],
        description: 'Market category filter',
      },
      status: {
        type: 'string',
        enum: ['active', 'resolved'],
        description: 'Market status filter',
      },
      onlyWhitelisted: {
        type: 'boolean',
        description: 'Only show official markets with whitelisted oracles',
      },
      limit: {
        type: 'number',
        description: 'Results per page (1-100)',
        default: 20,
      },
    },
  },
  handler: async (params) => {
    const queryString = new URLSearchParams(params).toString();
    const response = await x402.fetch(`${API_URL}/api/markets?${queryString}`);
    return await response.json();
  },
}
```
**Cost**: $0.005 per search

---

### 2. **get_trending_markets**
```typescript
{
  name: 'get_trending_markets',
  description: 'Get the top trending markets by volume. Great for discovering hot opportunities.',
  parameters: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const response = await x402.fetch(`${API_URL}/api/markets/trending`);
    return await response.json();
  },
}
```
**Cost**: $0.01 per request

---

### 3. **get_market_details**
```typescript
{
  name: 'get_market_details',
  description: 'Get detailed information about a specific market including title, description, creator, and current odds.',
  parameters: {
    type: 'object',
    properties: {
      marketId: {
        type: 'string',
        description: 'The market ID to fetch details for',
      },
    },
    required: ['marketId'],
  },
  handler: async ({ marketId }) => {
    const response = await x402.fetch(`${API_URL}/api/markets/${marketId}`);
    return await response.json();
  },
}
```
**Cost**: FREE

---

### 4. **get_market_odds**
```typescript
{
  name: 'get_market_odds',
  description: 'Get current yes/no odds for a market. Essential for bet analysis.',
  parameters: {
    type: 'object',
    properties: {
      marketId: {
        type: 'string',
        description: 'The market ID',
      },
    },
    required: ['marketId'],
  },
  handler: async ({ marketId }) => {
    const response = await x402.fetch(`${API_URL}/api/markets/${marketId}/odds`);
    return await response.json();
  },
}
```
**Cost**: $0.005 per request

---

### 5. **calculate_bet_outcome**
```typescript
{
  name: 'calculate_bet_outcome',
  description: 'Simulate a bet to see expected shares, price impact, and fees before placing. Critical for bet optimization.',
  parameters: {
    type: 'object',
    properties: {
      marketId: {
        type: 'string',
        description: 'The market ID',
      },
      amount: {
        type: 'string',
        description: 'Bet amount in SOL or USDC (e.g., "1.5")',
      },
      betYes: {
        type: 'boolean',
        description: 'true for YES bet, false for NO bet',
      },
    },
    required: ['marketId', 'amount', 'betYes'],
  },
  handler: async ({ marketId, amount, betYes }) => {
    const response = await x402.fetch(`${API_URL}/api/betting/calculate-odds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId, amount, betYes }),
    });
    return await response.json();
  },
}
```
**Cost**: $0.01 per calculation

---

### 6. **get_user_position**
```typescript
{
  name: 'get_user_position',
  description: 'Check user\'s position in a specific market including shares held, average price, and current P&L.',
  parameters: {
    type: 'object',
    properties: {
      marketId: {
        type: 'string',
        description: 'The market ID',
      },
      walletAddress: {
        type: 'string',
        description: 'User wallet address',
      },
    },
    required: ['marketId', 'walletAddress'],
  },
  handler: async ({ marketId, walletAddress }) => {
    const response = await x402.fetch(
      `${API_URL}/api/betting/position/${marketId}/${walletAddress}`
    );
    return await response.json();
  },
}
```
**Cost**: $0.005 per request

---

### 7. **get_portfolio_stats**
```typescript
{
  name: 'get_portfolio_stats',
  description: 'Get comprehensive portfolio statistics for a wallet including total positions, P&L, win rate, and active markets.',
  parameters: {
    type: 'object',
    properties: {
      walletAddress: {
        type: 'string',
        description: 'User wallet address',
      },
    },
    required: ['walletAddress'],
  },
  handler: async ({ walletAddress }) => {
    const response = await x402.fetch(`${API_URL}/api/portfolio/${walletAddress}`);
    return await response.json();
  },
}
```
**Cost**: $0.01 per request

---

### 8. **place_bet**
```typescript
{
  name: 'place_bet',
  description: 'Place a bet on a market. This executes the actual blockchain transaction.',
  parameters: {
    type: 'object',
    properties: {
      marketId: {
        type: 'string',
        description: 'The market ID',
      },
      amount: {
        type: 'string',
        description: 'Bet amount in SOL or USDC',
      },
      betYes: {
        type: 'boolean',
        description: 'true for YES bet, false for NO bet',
      },
      betterAddress: {
        type: 'string',
        description: 'The wallet placing the bet',
      },
      mint: {
        type: 'string',
        description: 'Token mint address (SOL or USDC)',
      },
    },
    required: ['marketId', 'amount', 'betYes', 'betterAddress', 'mint'],
  },
  handler: async (params) => {
    const response = await x402.fetch(`${API_URL}/api/betting/place-bet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await response.json();
  },
}
```
**Cost**: FREE (user pays in bet amount)

---

### 9. **get_protocol_stats**
```typescript
{
  name: 'get_protocol_stats',
  description: 'Get platform-wide statistics including total volume, fees collected, number of markets, and TVL.',
  parameters: {
    type: 'object',
    properties: {},
  },
  handler: async () => {
    const response = await x402.fetch(`${API_URL}/api/protocol/stats`);
    return await response.json();
  },
}
```
**Cost**: $0.015 per request

---

### 10. **get_leaderboard**
```typescript
{
  name: 'get_leaderboard',
  description: 'Get top performing wallets sorted by volume, P&L, win rate, or fees earned.',
  parameters: {
    type: 'object',
    properties: {
      sortBy: {
        type: 'string',
        enum: ['volume', 'pnl', 'winRate', 'fees'],
        description: 'Metric to sort by',
        default: 'volume',
      },
      limit: {
        type: 'number',
        description: 'Number of wallets to return (1-100)',
        default: 10,
      },
    },
  },
  handler: async ({ sortBy = 'volume', limit = 10 }) => {
    const response = await x402.fetch(
      `${API_URL}/api/portfolio/top-wallets?sortBy=${sortBy}&limit=${limit}`
    );
    return await response.json();
  },
}
```
**Cost**: FREE

---

## Code Examples

### Complete MCP Server Example

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { X402Client } from '@x402-solana/client';

const API_URL = process.env.API_URL || 'https://api.solex.bet';

// Initialize x402 client
const x402 = new X402Client({
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  network: process.env.NETWORK || 'devnet',
});

// Create MCP server
const server = new Server(
  {
    name: 'sol-bets-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tools
server.setRequestHandler('tools/list', async () => {
  return {
    tools: [
      {
        name: 'search_markets',
        description: 'Search for betting markets',
        inputSchema: {
          type: 'object',
          properties: {
            search: { type: 'string' },
            category: {
              type: 'string',
              enum: ['crypto', 'sports', 'politics', 'entertainment', 'other'],
            },
            limit: { type: 'number', default: 20 },
          },
        },
      },
      {
        name: 'get_trending_markets',
        description: 'Get trending markets by volume',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'calculate_bet_outcome',
        description: 'Simulate a bet to see expected outcome',
        inputSchema: {
          type: 'object',
          properties: {
            marketId: { type: 'string' },
            amount: { type: 'string' },
            betYes: { type: 'boolean' },
          },
          required: ['marketId', 'amount', 'betYes'],
        },
      },
      // ... add all other tools
    ],
  };
});

// Handle tool calls
server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'search_markets': {
        const queryString = new URLSearchParams(args).toString();
        const response = await x402.fetch(`${API_URL}/api/markets?${queryString}`);
        const data = await response.json();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'get_trending_markets': {
        const response = await x402.fetch(`${API_URL}/api/markets/trending`);
        const data = await response.json();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case 'calculate_bet_outcome': {
        const response = await x402.fetch(`${API_URL}/api/betting/calculate-odds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        const data = await response.json();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      // ... handle all other tools

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Sol Bets MCP Server running on stdio');
}

main().catch(console.error);
```

---

## Error Handling

### Common Errors

#### 402 Payment Required (Handled Automatically)
```json
{
  "statusCode": 402,
  "message": "Payment Required",
  "paymentDetails": {
    "amount": 0.005,
    "recipient": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "currency": "USDC"
  }
}
```
**Resolution**: x402 client handles this automatically. You don't need to do anything.

#### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Market not found"
}
```
**Resolution**: Verify the resource ID is correct.

#### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Invalid parameters",
  "errors": ["amount must be a positive number"]
}
```
**Resolution**: Check request parameters match the API schema.

### Recommended Error Handling Pattern

```typescript
async function callTool(name: string, args: any) {
  try {
    const response = await x402.fetch(endpoint, options);

    if (!response.ok) {
      const error = await response.json();
      return {
        content: [{
          type: 'text',
          text: `API Error: ${error.message}`,
        }],
        isError: true,
      };
    }

    const data = await response.json();
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2),
      }],
    };
  } catch (error) {
    // Network errors, payment failures, etc.
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`,
      }],
      isError: true,
    };
  }
}
```

---

## Testing

### 1. Get Devnet Wallet

```bash
# Generate new wallet
solana-keygen new --outfile ~/.config/solana/devnet-wallet.json

# Get the private key in base58
solana-keygen pubkey ~/.config/solana/devnet-wallet.json
```

### 2. Fund Wallet with Devnet SOL

```bash
solana airdrop 2 <YOUR_WALLET_ADDRESS> --url devnet
```

### 3. Get Devnet USDC

Visit: https://faucet.circle.com/

### 4. Test MCP Server

```bash
# Set environment variables
export WALLET_PRIVATE_KEY="<base58_private_key>"
export SOLANA_RPC_URL="https://api.devnet.solana.com"
export NETWORK="devnet"
export API_URL="https://staging-api.solex.bet"

# Run MCP server
node dist/index.js
```

### 5. Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Example Test Sequence

1. **Search markets**: `search_markets({ category: 'crypto', limit: 5 })`
2. **Get trending**: `get_trending_markets({})`
3. **Get market details**: `get_market_details({ marketId: '<id>' })`
4. **Calculate bet**: `calculate_bet_outcome({ marketId: '<id>', amount: '1', betYes: true })`
5. **Check position**: `get_user_position({ marketId: '<id>', walletAddress: '<wallet>' })`

---

## Production Deployment

### Environment Variables

```env
# Solana Configuration
WALLET_PRIVATE_KEY=<base58_private_key>
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # Use premium RPC (Helius, QuickNode)
NETWORK=mainnet-beta

# API Configuration
API_URL=https://api.solex.bet

# Optional: Monitoring
SENTRY_DSN=<your_sentry_dsn>
LOG_LEVEL=info
```

### Security Checklist

- [ ] **Never commit** wallet private keys to git
- [ ] Use environment variables for all secrets
- [ ] Use dedicated wallet for MCP server (not your personal wallet)
- [ ] Monitor wallet balance and set up alerts
- [ ] Use premium RPC endpoints for reliability
- [ ] Implement rate limiting on MCP tools
- [ ] Log all API calls for debugging
- [ ] Set up error monitoring (Sentry, etc.)

### Recommended Wallet Management

```typescript
// Use dedicated wallet for MCP payments
const MCP_WALLET = process.env.MCP_WALLET_PRIVATE_KEY;

// Monitor balance
async function checkBalance() {
  const connection = new Connection(process.env.SOLANA_RPC_URL);
  const keypair = Keypair.fromSecretKey(bs58.decode(MCP_WALLET));
  const balance = await connection.getBalance(keypair.publicKey);

  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.warn('⚠️  Wallet balance low! Please fund wallet.');
    // Send alert to team
  }
}

// Check every hour
setInterval(checkBalance, 60 * 60 * 1000);
```

### Premium RPC Providers

For production, use premium RPC:

- **Helius**: https://helius.dev (Recommended)
- **QuickNode**: https://quicknode.com
- **Alchemy**: https://alchemy.com

Benefits:
- Higher rate limits
- Better reliability
- Faster transaction confirmation
- Better support

---

## Summary

### What You Need to Do

1. **Install x402 client**: `npm install @x402-solana/client`
2. **Create MCP tools**: Implement 10 tools (see above)
3. **Initialize x402**: One-time setup with wallet
4. **Make requests**: Use `x402.fetch()` instead of `fetch()`
5. **Handle responses**: Parse JSON and return to AI agent

### What You DON'T Need to Do

- ❌ Handle 402 responses manually
- ❌ Create USDC transactions yourself
- ❌ Manage payment confirmations
- ❌ Implement retry logic
- ❌ Track transaction history

**x402 client does all of this automatically.**

### Cost per Agent

- **Light usage** (10 requests/day): ~$0.05/day = $1.50/month
- **Medium usage** (50 requests/day): ~$0.25/day = $7.50/month
- **Heavy usage** (200 requests/day): ~$1.00/day = $30/month

**Way cheaper than** traditional $50-200/month API subscriptions!

---

## Support

### Documentation
- **Backend API Docs**: See `X402_IMPLEMENTATION_GUIDE.md`
- **x402 Toolkit**: https://github.com/BOBER3r/solana-x402-devkit
- **MCP Protocol**: https://modelcontextprotocol.io

### Get Help

- **Questions**: Open issue in backend repo
- **Bugs**: Report x402 issues to toolkit repo
- **Slack**: [Your team Slack channel]

---

## Next Steps

1. **Read this guide** thoroughly
2. **Set up development environment** with devnet wallet
3. **Implement 2-3 core tools** (search, trending, calculate)
4. **Test with MCP Inspector**
5. **Add remaining tools**
6. **Production deployment**

**Estimated Timeline**: 2-4 hours for core implementation

---

**You're building the future of AI-to-API commerce!** 🚀

Any questions? Let's build this together.