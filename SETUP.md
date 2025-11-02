# Sol Bets MCP Server - Setup Guide

## Quick Start (5 minutes)

### 1. Install Dependencies

```bash
cd /Users/bober4ik/WebstormProjects/solana-x402/betting-analytics-mcp-server
npm install
```

### 2. Build the Project

```bash
npm run build
```

### 3. Create Wallet

You need a Solana wallet with USDC for x402 payments.

**Option A: Generate New Wallet**

```bash
# Generate keypair
solana-keygen new --outfile ~/.config/solana/mcp-wallet.json

# Get your public key
solana-keygen pubkey ~/.config/solana/mcp-wallet.json

# Get private key in base58 (needed for .env)
# The private key is in the JSON file as an array of numbers
# Convert it using: cat ~/.config/solana/mcp-wallet.json | jq -r '.'
```

**Option B: Use Existing Wallet**

Export your private key from Phantom or Solflare wallet.

### 4. Fund Wallet

**Devnet SOL** (for transaction fees):
```bash
solana airdrop 2 YOUR_WALLET_ADDRESS --url devnet
```

**Devnet USDC** (for x402 payments):
Visit: https://faucet.circle.com/

### 5. Configure Environment

```bash
cp .env.example .env
# Edit .env and add your WALLET_PRIVATE_KEY
```

### 6. Add to Claude Desktop

#### macOS

Edit: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sol-bets": {
      "command": "node",
      "args": [
        "/Users/bober4ik/WebstormProjects/solana-x402/betting-analytics-mcp-server/dist/index.js"
      ],
      "env": {
        "WALLET_PRIVATE_KEY": "YOUR_BASE58_PRIVATE_KEY_HERE",
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "NETWORK": "devnet",
        "API_URL": "https://staging-api.solex.bet"
      }
    }
  }
}
```

#### Windows

Edit: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sol-bets": {
      "command": "node",
      "args": [
        "C:\\path\\to\\betting-analytics-mcp-server\\dist\\index.js"
      ],
      "env": {
        "WALLET_PRIVATE_KEY": "YOUR_BASE58_PRIVATE_KEY_HERE",
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "NETWORK": "devnet",
        "API_URL": "https://staging-api.solex.bet"
      }
    }
  }
}
```

### 7. Restart Claude Desktop

Completely quit and reopen Claude Desktop app.

### 8. Test!

Open Claude Desktop and try:

```
Can you search for crypto betting markets on Sol Bets?
```

Claude should now have access to all 10 Sol Bets tools!

---

## Available Tools

Once configured, Claude can use these tools:

| Tool | Cost | Description |
|------|------|-------------|
| `search_markets` | $0.005 | Search markets by keyword, category, status |
| `get_trending_markets` | $0.01 | Get top trending markets by volume |
| `get_market_details` | FREE | Get detailed info about a specific market |
| `get_market_odds` | $0.005 | Get current yes/no odds |
| `calculate_bet_outcome` | $0.01 | Simulate a bet before placing |
| `get_user_position` | $0.005 | Check position in a market |
| `get_portfolio_stats` | $0.01 | Get comprehensive portfolio stats |
| `place_bet` | FREE | Execute a bet transaction |
| `get_protocol_stats` | $0.015 | Get platform-wide statistics |
| `get_leaderboard` | FREE | Get top performing wallets |

---

## Testing with MCP Inspector

Before adding to Claude Desktop, test with the inspector:

```bash
npm run inspector
```

This opens a web interface where you can test each tool.

---

## Production Deployment

### 1. Switch to Mainnet

Update `.env`:
```bash
NETWORK=mainnet-beta
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
API_URL=https://api.solex.bet
```

### 2. Use Premium RPC

Free RPC has rate limits. Use:
- **Helius**: https://helius.dev (recommended)
- **QuickNode**: https://quicknode.com
- **Alchemy**: https://alchemy.com

```bash
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

### 3. Secure Your Wallet

- Use a dedicated wallet for MCP (not your personal wallet)
- Monitor balance and set up alerts
- Keep private key in secure environment variables

### 4. Monitor Usage

Track costs:
- Light usage (10 calls/day): ~$1.50/month
- Medium usage (50 calls/day): ~$7.50/month
- Heavy usage (200 calls/day): ~$30/month

---

## Troubleshooting

### "WALLET_PRIVATE_KEY not set"

Make sure you've added the base58 private key to `.env` or Claude Desktop config.

### "Insufficient funds"

Your wallet needs:
- At least 0.1 SOL for transaction fees
- At least 1 USDC for x402 payments

Check balances:
```bash
solana balance YOUR_WALLET --url devnet
```

### "Payment verification failed"

Common causes:
- Wrong network (devnet vs mainnet mismatch)
- Transaction not confirmed yet (wait a few seconds)
- Insufficient USDC balance

### "Cannot connect to API"

- Check if API_URL is correct
- Try staging: `https://staging-api.solex.bet`
- Try production: `https://api.solex.bet`

### Claude Desktop doesn't see the tools

1. Check config file location (macOS vs Windows)
2. Verify JSON syntax is valid
3. Make sure path to dist/index.js is absolute
4. Completely quit and restart Claude Desktop
5. Check logs in Console.app (macOS) or Event Viewer (Windows)

---

## Cost Optimization

### Minimize API Calls

- Use FREE tools when possible (`get_market_details`, `get_leaderboard`)
- Cache results in your application
- Batch searches instead of individual calls

### Monitor Spending

```typescript
// Track spending over time
const dailySpend =
  (10 * 0.005) +  // 10 market searches
  (5 * 0.01) +    // 5 bet calculations
  (2 * 0.015);    // 2 protocol stat checks
// = $0.115/day = $3.45/month
```

---

## Security Best Practices

✅ **DO:**
- Use dedicated wallet for MCP payments
- Keep private keys in environment variables
- Use premium RPC for production
- Monitor wallet balance
- Set up spending alerts

❌ **DON'T:**
- Commit private keys to git
- Use your personal wallet
- Share private keys
- Use free RPC in production
- Ignore wallet balance warnings

---

## Support

- **Integration Guide**: See `MCP_TEAM_INTEGRATION_GUIDE.md`
- **x402 Toolkit**: https://github.com/BOBER3r/solana-x402-devkit
- **MCP Protocol**: https://modelcontextprotocol.io
- **Sol Bets API**: https://api.solex.bet

---

## Example Claude Prompts

Once configured, try these in Claude Desktop:

```
1. "Show me the top 5 trending crypto markets"

2. "Search for Bitcoin-related markets"

3. "Calculate the outcome if I bet 1 USDC on YES for market [id]"

4. "Show me the leaderboard of top traders"

5. "Get portfolio stats for wallet [address]"

6. "What are the current platform statistics?"
```

---

**You're now ready to use Sol Bets with Claude! 🚀**
