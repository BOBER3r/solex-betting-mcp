# x402 MCP Server Implementation Guide

This guide shows you how to implement the x402 micropayment system in your MCP server.

## Quick Start

### 1. Install Dependencies

```bash
npm install @solana/web3.js redis bottleneck
npm install @modelcontextprotocol/sdk
npm install --save-dev @types/node typescript
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key settings:
- `SOLANA_NETWORK`: Set to `devnet` for testing, `mainnet` for production
- `RECIPIENT_WALLET_DEVNET`: Your devnet wallet address for receiving payments
- `RECIPIENT_WALLET_MAINNET`: Your mainnet wallet address for receiving payments
- `REDIS_URL`: Leave empty for in-memory cache (dev), set for production

### 3. Project Structure

```
src/
├── config/
│   └── payment.config.ts        # Network and payment configuration
├── services/
│   ├── payment.service.ts       # Main payment verification service
│   └── rpc-manager.ts           # RPC connection management with failover
├── cache/
│   └── payment-cache.ts         # Payment cache (Redis + in-memory)
├── errors/
│   └── payment-errors.ts        # Payment error types and factories
├── monitoring/
│   └── payment-monitor.ts       # Metrics and alerting
├── handlers/
│   └── betting.handler.ts       # Tool handlers with payment logic
└── server.ts                    # MCP server entry point
```

## Payment Flow

### Step 1: AI Agent Calls Tool (No Payment)

```json
{
  "method": "tools/call",
  "params": {
    "name": "analyzeMarket",
    "arguments": {
      "market": "NBA-LAL-vs-GSW",
      "timeframe": "24h"
    }
  }
}
```

### Step 2: Server Returns Payment Required

```json
{
  "content": [{
    "type": "text",
    "text": {
      "error": "PAYMENT_REQUIRED",
      "message": "Payment of 0.05 USDC required for analyzeMarket",
      "payment": {
        "amount": 0.05,
        "recipient": "8x4e...Abc2",
        "usdcMint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        "network": "devnet",
        "description": "Payment for analyzeMarket"
      },
      "instructions": [
        "1. Create a USDC transfer transaction to the recipient wallet",
        "2. Sign and send the transaction to Solana",
        "3. Wait for confirmation",
        "4. Call this tool again with x402_payment_signature parameter"
      ]
    }
  }],
  "isError": true
}
```

### Step 3: AI Agent Creates Payment

The agent creates and sends a USDC transfer transaction:

```typescript
// Agent-side code (using @solana/web3.js)
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

const connection = new Connection('https://api.devnet.solana.com');
const usdcMint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const recipient = new PublicKey('8x4e...Abc2');

// Get token accounts
const senderTokenAccount = await getAssociatedTokenAddress(usdcMint, senderPublicKey);
const recipientTokenAccount = await getAssociatedTokenAddress(usdcMint, recipient);

// Create transfer instruction
const transferIx = createTransferInstruction(
  senderTokenAccount,
  recipientTokenAccount,
  senderPublicKey,
  0.05 * 1_000_000, // 0.05 USDC (6 decimals)
  [],
  TOKEN_PROGRAM_ID
);

// Send transaction
const tx = new Transaction().add(transferIx);
const signature = await sendAndConfirmTransaction(connection, tx, [senderKeypair]);
```

### Step 4: AI Agent Retries with Payment Signature

```json
{
  "method": "tools/call",
  "params": {
    "name": "analyzeMarket",
    "arguments": {
      "market": "NBA-LAL-vs-GSW",
      "timeframe": "24h",
      "x402_payment_signature": "5KxR7...9mJp"
    }
  }
}
```

### Step 5: Server Verifies and Executes

```json
{
  "content": [{
    "type": "text",
    "text": {
      "success": true,
      "payment": {
        "verified": true,
        "cached": false,
        "amount": 0.05,
        "signature": "5KxR7...9mJp"
      },
      "result": {
        "market": "NBA-LAL-vs-GSW",
        "timeframe": "24h",
        "trends": { ... },
        "statistics": { ... },
        "recommendations": { ... }
      }
    }
  }]
}
```

## Core Components

### PaymentService

Main service for payment verification:

```typescript
import { PaymentService } from './services/payment.service';

const paymentService = new PaymentService();
await paymentService.initialize();

// Verify payment
const result = await paymentService.verifyPayment(
  signature,
  expectedAmount,
  toolName,
  params
);

// Get payment requirements
const requirement = paymentService.getPaymentRequirement(toolName, params);

// Health check
const health = await paymentService.healthCheck();
```

### Tool Handler Pattern

```typescript
async handleToolCall(toolName: string, args: any) {
  // 1. Check for payment signature
  const paymentSignature = args.x402_payment_signature;

  // 2. Calculate required payment
  const paymentReq = this.paymentService.getPaymentRequirement(toolName, args);

  // 3. If no signature, return payment required error
  if (!paymentSignature) {
    throw createPaymentRequiredError(toolName, paymentReq);
  }

  // 4. Verify payment
  const verification = await this.paymentService.verifyPayment(
    paymentSignature,
    paymentReq.amount,
    toolName,
    args
  );

  // 5. Execute tool logic
  const result = await this.executeTool(toolName, args);

  return result;
}
```

## Dynamic Pricing

### Simple Fixed Price

```typescript
calculatePrice(toolName: string, params: any): number {
  switch (toolName) {
    case 'analyzeMarket':
      return 0.05; // $0.05 USDC
    case 'getOdds':
      return 0.02; // $0.02 USDC
    default:
      return 0.01;
  }
}
```

### Dynamic Price with Percentage

```typescript
calculatePrice(toolName: string, params: any): number {
  switch (toolName) {
    case 'executeBet': {
      const betAmount = params.amount || 0;
      const baseFee = 0.10; // $0.10 base
      const percentageFee = betAmount * 0.02; // 2% of bet
      return this.roundToMicroUSDC(baseFee + percentageFee);
    }
    default:
      return 0.01;
  }
}
```

## Error Handling

All payment errors are returned in MCP-compatible format:

```json
{
  "content": [{
    "type": "text",
    "text": {
      "error": "INSUFFICIENT_AMOUNT",
      "message": "Insufficient payment amount",
      "details": {
        "expected": "0.05 USDC",
        "actual": "0.03 USDC",
        "shortfall": "0.02 USDC"
      }
    }
  }],
  "isError": true
}
```

### Error Types

| Error Code | Description |
|------------|-------------|
| `PAYMENT_REQUIRED` | No payment signature provided |
| `INVALID_SIGNATURE` | Invalid signature format |
| `TRANSACTION_NOT_FOUND` | Transaction not found on-chain |
| `INSUFFICIENT_AMOUNT` | Payment amount too low |
| `WRONG_RECIPIENT` | Payment sent to wrong address |
| `WRONG_TOKEN` | Not a USDC transfer |
| `EXPIRED_PAYMENT` | Transaction too old |
| `REPLAY_ATTACK` | Signature already used |
| `RPC_ERROR` | RPC communication failure |
| `VERIFICATION_TIMEOUT` | Verification took too long |

## Cache Strategy

### Redis (Production)

```typescript
// .env
REDIS_URL=redis://localhost:6379

// Cache structure
x402:payment:{signature} -> {
  toolName: string,
  amount: number,
  timestamp: number,
  verified: boolean,
  params: any
}

// TTL: 1 hour (configurable)
```

### In-Memory (Development)

```typescript
// .env
REDIS_URL=  # Leave empty

// Automatic cleanup every minute
// Max 1000 entries
```

### Cache Benefits

1. **Prevents Replay Attacks**: Each signature can only be used once
2. **Reduces RPC Calls**: Cached verifications return instantly
3. **Multi-Instance Support**: Redis enables horizontal scaling

## Monitoring

### Metrics

```typescript
const metrics = paymentService.getMetrics();

{
  totalVerifications: 1523,
  successfulVerifications: 1489,
  failedVerifications: 34,
  cacheHits: 892,
  cacheMisses: 631,
  averageVerificationTime: 1234, // ms
  cacheHitRate: 0.586,
  successRate: 0.978,
  rpcErrors: 5,
  totalAmount: 156.34 // USDC
}
```

### Prometheus Export

```typescript
const prometheus = paymentService.monitor.exportPrometheusMetrics();
```

Outputs:
```
payment_verifications_total 1523
payment_verifications_success_total 1489
payment_success_rate 0.978
payment_cache_hit_rate 0.586
payment_total_amount_usdc 156.34
```

### Alerts

Automatic alerts for:
- High failure rate (> 10%)
- RPC errors (> 10)
- Slow verifications (> 5 seconds)

## Production Deployment

### Environment Setup

```bash
# Production .env
SOLANA_NETWORK=mainnet
SOLANA_RPC_MAINNET=https://your-premium-rpc.com
HELIUS_API_KEY=your_helius_key
RECIPIENT_WALLET_MAINNET=YourMainnetWallet

# Redis (required for production)
REDIS_URL=rediss://your-redis-cluster:6379

# Monitoring
MONITORING_ENABLED=true
ALERT_FAILURE_THRESHOLD=0.05  # 5% for production
```

### RPC Endpoint Recommendations

1. **Helius** (recommended): High rate limits, reliable
2. **QuickNode**: Good performance, websocket support
3. **Alchemy**: Reliable, good analytics
4. **Fallback**: Use multiple endpoints for redundancy

### Horizontal Scaling

1. Use Redis for shared cache
2. Deploy multiple MCP server instances
3. Load balance at client level (MCP doesn't have native LB)
4. Monitor cache hit rate across instances

### Security Checklist

- [ ] Use mainnet wallet with appropriate security
- [ ] Enable transaction age limits (5 minutes max)
- [ ] Monitor for replay attacks
- [ ] Use Redis authentication in production
- [ ] Encrypt Redis connection (TLS)
- [ ] Rate limit tool calls at application level
- [ ] Monitor unusual payment patterns
- [ ] Set up alerting for failures

## Testing

### Unit Tests

```typescript
import { PaymentService } from './services/payment.service';

describe('PaymentService', () => {
  it('should calculate executeBet price correctly', () => {
    const service = new PaymentService();
    const price = service.calculatePrice('executeBet', { amount: 100 });
    expect(price).toBe(0.10 + 100 * 0.02); // $0.10 + 2% = $2.10
  });
});
```

### Integration Tests

```typescript
describe('Payment Flow', () => {
  it('should reject tool call without payment', async () => {
    const result = await handler.handleToolCall('analyzeMarket', {
      market: 'test',
      timeframe: '24h'
    });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toBe('PAYMENT_REQUIRED');
  });

  it('should accept tool call with valid payment', async () => {
    // Create and send payment transaction
    const signature = await sendPayment();

    const result = await handler.handleToolCall('analyzeMarket', {
      market: 'test',
      timeframe: '24h',
      x402_payment_signature: signature
    });

    expect(result.isError).toBeFalsy();
  });
});
```

### Devnet Testing

1. Get devnet SOL: https://faucet.solana.com
2. Get devnet USDC: Use Solana CLI or web faucet
3. Test full payment flow
4. Verify cache behavior
5. Test error scenarios

## Cost Optimization

### Minimize RPC Calls

1. **Use Cache**: 60%+ cache hit rate saves significant RPC costs
2. **Batch Operations**: Use `getSignatureStatuses` for multiple signatures
3. **Optimize Commitment**: Use 'confirmed' instead of 'finalized' when safe
4. **Connection Pooling**: Reuse connections across requests

### Example Savings

Without optimization:
- 1000 verifications/day
- 3 RPC calls per verification
- 3000 RPC calls/day

With optimization:
- 1000 verifications/day
- 60% cache hit rate = 400 RPC calls avoided
- 40% need verification × 3 calls = 1200 RPC calls
- **60% reduction in RPC costs**

## Troubleshooting

### Payment Not Found

**Symptoms**: `TRANSACTION_NOT_FOUND` error

**Solutions**:
1. Wait 5-10 seconds for confirmation
2. Check you're on correct network (devnet vs mainnet)
3. Verify RPC endpoint is working
4. Check transaction on Solana Explorer

### Wrong Recipient

**Symptoms**: `WRONG_RECIPIENT` error

**Solutions**:
1. Verify recipient address in payment requirement
2. Ensure you're sending to the correct address
3. Check network matches (devnet vs mainnet)

### Insufficient Amount

**Symptoms**: `INSUFFICIENT_AMOUNT` error

**Solutions**:
1. Check calculated price matches payment
2. Account for dynamic pricing (e.g., % fees)
3. Ensure USDC has 6 decimals (multiply by 1,000,000)

### Replay Attack

**Symptoms**: `REPLAY_ATTACK` error

**Solutions**:
1. Create a new payment transaction
2. Don't reuse signatures across different tools
3. Check cache hasn't expired prematurely

### RPC Errors

**Symptoms**: `RPC_ERROR` or timeouts

**Solutions**:
1. Check RPC endpoint health
2. Add fallback endpoints
3. Increase retry attempts
4. Use premium RPC provider (Helius, QuickNode)

## Example: Complete Tool Implementation

```typescript
// Define tool
{
  name: 'customAnalysis',
  description: 'Advanced custom analysis. PAYMENT: $1.00 USDC',
  inputSchema: {
    type: 'object',
    properties: {
      data: { type: 'string', description: 'Data to analyze' },
      x402_payment_signature: {
        type: 'string',
        description: 'Payment signature (optional on first call)'
      }
    },
    required: ['data']
  }
}

// Add pricing
calculatePrice(toolName: string, params: any): number {
  if (toolName === 'customAnalysis') {
    return 1.00; // $1.00 USDC
  }
  return 0.01;
}

// Implement logic
private async customAnalysis(args: any) {
  const { data } = args;

  // Your analysis logic here
  const result = performAnalysis(data);

  return {
    analysis: result,
    timestamp: new Date().toISOString()
  };
}

// Add to executeTool switch
case 'customAnalysis':
  return this.customAnalysis(args);
```

## Summary

This implementation provides:

1. **Seamless Integration**: Works with any MCP client
2. **Robust Verification**: Full on-chain verification with retry logic
3. **Production Ready**: Redis cache, monitoring, error handling
4. **Cost Optimized**: Caching and connection pooling
5. **Secure**: Replay attack prevention, transaction age limits
6. **Scalable**: Multi-instance support with shared cache

The key insight: **Payment signature is just another tool parameter**, making x402 payments feel natural in the MCP protocol while providing full security and verification.
