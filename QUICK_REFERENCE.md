# x402 MCP Server Quick Reference

## 30-Second Overview

**What**: MCP server with Solana USDC micropayments
**How**: Payment signature as tool parameter
**Why**: Enable pay-per-use AI agent tools

## Installation

```bash
npm install
cp .env.example .env
# Edit .env with your wallet address
npm run build
npm start
```

## Core Concept

```typescript
// AI agent calls tool WITHOUT payment
{ "market": "NBA-LAL-vs-GSW", "timeframe": "24h" }
↓
// Server returns PAYMENT_REQUIRED
{ "error": "PAYMENT_REQUIRED", "payment": { "amount": 0.05, ... } }
↓
// Agent creates USDC payment, gets signature
signature = "5KxR7...9mJp"
↓
// Agent retries WITH payment signature
{ "market": "NBA-LAL-vs-GSW", "timeframe": "24h", "x402_payment_signature": signature }
↓
// Server verifies & returns result
{ "success": true, "payment": { "verified": true }, "result": {...} }
```

## File Structure

```
src/
├── config/payment.config.ts      # Networks, wallets, RPCs
├── services/payment.service.ts   # Core payment verification
├── cache/payment-cache.ts        # Redis + in-memory
├── errors/payment-errors.ts      # Error types
├── monitoring/payment-monitor.ts # Metrics & alerts
├── handlers/betting.handler.ts   # Tool logic
└── server.ts                     # MCP server
```

## Key Components

### PaymentService

```typescript
import { PaymentService } from './services/payment.service';

const service = new PaymentService();

// Get payment requirement
const req = service.getPaymentRequirement('analyzeMarket', params);
// → { amount: 0.05, recipient: "8x4e...", ... }

// Verify payment
const result = await service.verifyPayment(signature, 0.05, 'analyzeMarket');
// → { valid: true, cached: false }

// Health check
const health = await service.healthCheck();
```

### Tool Handler Pattern

```typescript
async handleToolCall(toolName: string, args: any) {
  const signature = args.x402_payment_signature;
  const paymentReq = this.paymentService.getPaymentRequirement(toolName, args);

  if (!signature) {
    throw createPaymentRequiredError(toolName, paymentReq);
  }

  await this.paymentService.verifyPayment(signature, paymentReq.amount, toolName);

  return await this.executeTool(toolName, args);
}
```

## Environment Variables

| Variable | Required | Example |
|----------|----------|---------|
| `SOLANA_NETWORK` | Yes | `devnet` or `mainnet` |
| `RECIPIENT_WALLET_DEVNET` | Yes | `8x4eB...Abc2` |
| `RECIPIENT_WALLET_MAINNET` | If mainnet | `9y5fC...Def3` |
| `REDIS_URL` | No | `redis://localhost:6379` |

## Pricing Examples

### Fixed

```typescript
'analyzeMarket': 0.05 USDC  // Always $0.05
'getOdds': 0.02 USDC        // Always $0.02
```

### Dynamic

```typescript
'executeBet': 0.10 + (amount * 0.02)  // $0.10 + 2% of bet
// Bet $100 → $0.10 + $2.00 = $2.10
```

## Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `PAYMENT_REQUIRED` | No signature provided | Create payment, retry with signature |
| `INVALID_SIGNATURE` | Bad signature format | Check signature is base58, 87-88 chars |
| `TRANSACTION_NOT_FOUND` | Tx not on-chain | Wait for confirmation, check network |
| `INSUFFICIENT_AMOUNT` | Payment too low | Send correct amount |
| `WRONG_RECIPIENT` | Wrong destination | Send to correct recipient |
| `REPLAY_ATTACK` | Signature reused | Create new payment |
| `EXPIRED_PAYMENT` | Tx too old (>5 min) | Create fresh payment |

## Common Tasks

### Add New Tool

```typescript
// 1. Define tool in server.ts
{
  name: 'myNewTool',
  description: 'PAYMENT REQUIRED: $0.10 USDC',
  inputSchema: {
    properties: {
      param1: { type: 'string' },
      x402_payment_signature: { type: 'string' }
    }
  }
}

// 2. Add pricing in payment.service.ts
calculatePrice(toolName: string, params: any): number {
  if (toolName === 'myNewTool') return 0.10;
  // ...
}

// 3. Implement in betting.handler.ts
private async myNewTool(args: any) {
  // Your logic here
  return { result: 'success' };
}
```

### Testing Payment Flow

```bash
# 1. Run server
npm start

# 2. Call tool without payment
# Returns PAYMENT_REQUIRED with recipient address

# 3. Create USDC transfer to recipient
# Using Solana CLI or web3.js

# 4. Get transaction signature
# e.g., "5KxR7...9mJp"

# 5. Retry with signature
# Include x402_payment_signature parameter
```

### Check Metrics

```typescript
// Call healthCheck tool (no payment required)
{
  "status": "healthy",
  "payment": {
    "metrics": {
      "totalVerifications": 1523,
      "successRate": 0.978,
      "cacheHitRate": 0.586,
      "totalAmount": 156.34
    }
  }
}
```

## USDC Addresses

- **Devnet**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **Mainnet**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

## RPC Endpoints

### Free

- Devnet: `https://api.devnet.solana.com`
- Mainnet: `https://api.mainnet-beta.solana.com`

### Premium (Recommended)

- Helius: `https://rpc.helius.xyz/?api-key=XXX`
- QuickNode: `https://your-endpoint.quiknode.pro/XXX`
- Alchemy: `https://solana-mainnet.g.alchemy.com/v2/XXX`

## Performance Targets

| Metric | Target | Impact |
|--------|--------|--------|
| Cache hit rate | 60%+ | 60% RPC cost reduction |
| Verification time | < 2s | Good UX |
| Success rate | > 95% | Reliability |
| RPC error rate | < 5% | Stability |

## Security Checklist

- [ ] Different wallets for devnet/mainnet
- [ ] Redis authentication enabled
- [ ] Redis TLS enabled
- [ ] Transaction age limit (5 min)
- [ ] Signature format validation
- [ ] Amount exact matching
- [ ] Recipient verification
- [ ] USDC mint verification
- [ ] Replay attack prevention
- [ ] Rate limiting (app level)

## Troubleshooting

### Payment not found
```bash
# Check network
echo $SOLANA_NETWORK  # Should be devnet or mainnet

# Check transaction on explorer
https://explorer.solana.com/tx/{signature}?cluster=devnet

# Wait longer (5-10 seconds)
# Devnet can be slower than mainnet
```

### Wrong amount error
```bash
# Check calculation
# For executeBet: 0.10 + (bet_amount * 0.02)
# Example: bet $100 → 0.10 + 2.00 = 2.10 USDC

# USDC has 6 decimals
# Send: amount * 1_000_000
# Example: 0.05 USDC = 50_000 smallest units
```

### Cache issues
```bash
# Check Redis connection
redis-cli ping  # Should return PONG

# Or use in-memory cache
REDIS_URL=  # Leave empty in .env

# Clear cache
redis-cli FLUSHDB
```

## Monitoring Commands

```bash
# Check server health
# Call healthCheck tool

# View logs
tail -f logs/server.log

# Redis stats
redis-cli INFO stats

# Check payment cache
redis-cli KEYS "x402:payment:*" | wc -l
```

## Development vs Production

### Development
```env
SOLANA_NETWORK=devnet
REDIS_URL=  # In-memory
SOLANA_RPC_DEVNET=https://api.devnet.solana.com
```

### Production
```env
SOLANA_NETWORK=mainnet
REDIS_URL=rediss://redis-cluster:6379
SOLANA_RPC_MAINNET=https://premium-rpc.helius.com
HELIUS_API_KEY=your_key
MONITORING_ENABLED=true
```

## Client Example (TypeScript)

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';

const client = new Client(/* config */);

// 1. Call without payment
const result1 = await client.callTool('analyzeMarket', {
  market: 'NBA-LAL-vs-GSW',
  timeframe: '24h'
});
// → PAYMENT_REQUIRED error

// 2. Create payment
const signature = await createUSDCPayment(result1.payment);

// 3. Retry with payment
const result2 = await client.callTool('analyzeMarket', {
  market: 'NBA-LAL-vs-GSW',
  timeframe: '24h',
  x402_payment_signature: signature
});
// → Success with analysis result
```

## Cost Estimate

### RPC Costs (1000 verifications/day)

Without cache: 3000 calls/day × $0.001 = **$90/month**
With 60% cache: 1200 calls/day × $0.001 = **$36/month**

### Redis Costs

- Development: $0 (in-memory)
- Small production: $5-15/month
- Large production: $50-125/month

### Total

- **Low volume** (100/day): ~$15/month
- **Medium volume** (1000/day): ~$51/month
- **High volume** (10000/day): ~$410/month

## Resources

- Full docs: [README.md](./README.md)
- Implementation: [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)
- Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Design: [PAYMENT_DESIGN.md](./PAYMENT_DESIGN.md)
- Client examples: [CLIENT_EXAMPLE.md](./CLIENT_EXAMPLE.md)

## Support

- GitHub Issues: https://github.com/your-org/betting-analytics-mcp-server/issues
- MCP Discord: https://discord.gg/mcp
- Solana Discord: https://discord.gg/solana
