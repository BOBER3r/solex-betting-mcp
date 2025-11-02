# Betting Analytics MCP Server with x402 Solana Micropayments

A Model Context Protocol (MCP) server that provides betting analytics tools with integrated Solana USDC micropayments using the x402 protocol.

## Overview

This MCP server demonstrates how to implement x402 micropayments in a stdio-based JSON-RPC environment. Unlike HTTP servers where middleware can intercept requests, MCP servers require payment verification to be integrated directly into the tool execution flow.

### Key Features

- **Seamless Payment Integration**: Payment signature as a tool parameter
- **On-Chain Verification**: Full Solana transaction verification
- **Replay Attack Prevention**: Payment signature caching
- **Dynamic Pricing**: Support for fixed and percentage-based fees
- **Production Ready**: Redis caching, RPC failover, monitoring
- **Multi-Instance Support**: Horizontal scaling with shared cache

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/your-org/betting-analytics-mcp-server.git
cd betting-analytics-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

### 2. Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
SOLANA_NETWORK=devnet
RECIPIENT_WALLET_DEVNET=YourDevnetWalletAddress
REDIS_URL=  # Leave empty for in-memory cache
```

### 3. Run the Server

```bash
npm start
```

Or in development mode with auto-reload:

```bash
npm run dev
```

## Architecture

### Payment Flow

```
┌─────────┐        ┌─────────┐        ┌─────────┐
│ AI Agent│        │   MCP   │        │ Solana  │
│         │        │ Server  │        │         │
└────┬────┘        └────┬────┘        └────┬────┘
     │                  │                  │
     │ 1. Call tool     │                  │
     │ (no payment)     │                  │
     ├─────────────────>│                  │
     │                  │                  │
     │ 2. PAYMENT_REQ   │                  │
     │<─────────────────┤                  │
     │                  │                  │
     │ 3. Create & send USDC tx            │
     ├────────────────────────────────────>│
     │                  │                  │
     │ 4. Tx confirmed  │                  │
     │<────────────────────────────────────┤
     │                  │                  │
     │ 5. Call with sig │                  │
     ├─────────────────>│                  │
     │                  │ 6. Verify tx     │
     │                  ├─────────────────>│
     │                  │ 7. Tx details    │
     │                  │<─────────────────┤
     │ 8. Tool result   │                  │
     │<─────────────────┤                  │
```

### Project Structure

```
src/
├── config/
│   └── payment.config.ts        # Network and payment configuration
├── services/
│   ├── payment.service.ts       # Payment verification service
│   └── rpc-manager.ts           # RPC connection management
├── cache/
│   └── payment-cache.ts         # Redis + in-memory cache
├── errors/
│   └── payment-errors.ts        # Error types and factories
├── monitoring/
│   └── payment-monitor.ts       # Metrics and alerting
├── handlers/
│   └── betting.handler.ts       # Tool handlers with payment
└── server.ts                    # MCP server entry point
```

## Available Tools

### 1. executeBet

Execute a bet on a market.

**Payment**: $0.10 + 2% of bet amount

**Example**:
```json
{
  "market": "NBA-LAL-vs-GSW",
  "amount": 100,
  "side": "home",
  "x402_payment_signature": "5KxR7...9mJp"
}
```

### 2. analyzeMarket

Analyze a betting market with trends and statistics.

**Payment**: $0.05 USDC

**Example**:
```json
{
  "market": "NBA-LAL-vs-GSW",
  "timeframe": "24h",
  "x402_payment_signature": "5KxR7...9mJp"
}
```

### 3. getOdds

Get current odds for a market.

**Payment**: $0.02 USDC

**Example**:
```json
{
  "market": "NBA-LAL-vs-GSW",
  "x402_payment_signature": "5KxR7...9mJp"
}
```

### 4. healthCheck

Check server health and metrics.

**Payment**: None (free)

## Payment Integration

### Step 1: Call Without Payment

```typescript
const result = await client.callTool('analyzeMarket', {
  market: 'NBA-LAL-vs-GSW',
  timeframe: '24h'
});
```

**Response**:
```json
{
  "error": "PAYMENT_REQUIRED",
  "message": "Payment of 0.05 USDC required for analyzeMarket",
  "payment": {
    "amount": 0.05,
    "recipient": "8x4eB...Abc2",
    "usdcMint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "network": "devnet"
  },
  "instructions": [...]
}
```

### Step 2: Create Payment

```typescript
// Create USDC transfer to recipient
const signature = await createUSDCTransfer({
  recipient: payment.recipient,
  amount: payment.amount,
  usdcMint: payment.usdcMint
});
```

### Step 3: Retry With Signature

```typescript
const result = await client.callTool('analyzeMarket', {
  market: 'NBA-LAL-vs-GSW',
  timeframe: '24h',
  x402_payment_signature: signature
});
```

**Response**:
```json
{
  "success": true,
  "payment": {
    "verified": true,
    "amount": 0.05,
    "signature": "5KxR7...9mJp"
  },
  "result": {
    "market": "NBA-LAL-vs-GSW",
    "trends": {...},
    "statistics": {...}
  }
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_NETWORK` | Network (devnet/mainnet) | `devnet` |
| `SOLANA_RPC_DEVNET` | Devnet RPC endpoint | Solana public RPC |
| `SOLANA_RPC_MAINNET` | Mainnet RPC endpoint | Solana public RPC |
| `RECIPIENT_WALLET_DEVNET` | Devnet payment recipient | - |
| `RECIPIENT_WALLET_MAINNET` | Mainnet payment recipient | - |
| `REDIS_URL` | Redis connection URL | - (in-memory) |
| `PAYMENT_CACHE_TTL` | Cache TTL in seconds | `3600` |
| `MAX_TRANSACTION_AGE` | Max tx age in seconds | `300` |
| `VERIFICATION_RETRY_ATTEMPTS` | RPC retry attempts | `3` |
| `RPC_MAX_CONCURRENT` | Max concurrent RPC calls | `10` |
| `RPC_RATE_LIMIT` | Requests per second | `50` |

### USDC Mint Addresses

- **Devnet**: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **Mainnet**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

## Caching

### In-Memory Cache (Development)

Automatic when `REDIS_URL` is not set:
- Stores up to 1000 entries
- Automatic cleanup every minute
- Single-instance only

### Redis Cache (Production)

Required for production deployment:

```env
REDIS_URL=redis://localhost:6379
# Or with auth:
REDIS_URL=rediss://default:password@redis-host:6379
```

**Benefits**:
- Multi-instance support
- Persistence across restarts
- Shared cache across servers

**Cache Structure**:
```
x402:payment:{signature} -> {
  toolName: string,
  amount: number,
  timestamp: number,
  verified: boolean
}
```

## Monitoring

### Metrics

Access metrics via the `healthCheck` tool:

```json
{
  "metrics": {
    "totalVerifications": 1523,
    "successfulVerifications": 1489,
    "failedVerifications": 34,
    "cacheHitRate": 0.586,
    "successRate": 0.978,
    "averageVerificationTime": 1234,
    "totalAmount": 156.34
  }
}
```

### Alerts

Automatic alerts triggered on:
- High failure rate (> 10%)
- Excessive RPC errors (> 10)
- Slow verifications (> 5 seconds)

### Prometheus Integration

Export metrics in Prometheus format:

```typescript
const metrics = paymentService.monitor.exportPrometheusMetrics();
```

## Error Handling

All errors are returned in MCP-compatible format:

### Payment Required
```json
{
  "error": "PAYMENT_REQUIRED",
  "message": "Payment of 0.05 USDC required",
  "payment": {...}
}
```

### Invalid Signature
```json
{
  "error": "INVALID_SIGNATURE",
  "message": "Invalid transaction signature format",
  "details": {...}
}
```

### Transaction Not Found
```json
{
  "error": "TRANSACTION_NOT_FOUND",
  "message": "Transaction not found on Solana",
  "details": {
    "possibleReasons": [
      "Transaction not yet confirmed",
      "Invalid signature",
      "Wrong network"
    ]
  }
}
```

### Insufficient Amount
```json
{
  "error": "INSUFFICIENT_AMOUNT",
  "message": "Insufficient payment amount",
  "details": {
    "expected": "0.05 USDC",
    "actual": "0.03 USDC",
    "shortfall": "0.02 USDC"
  }
}
```

### Replay Attack
```json
{
  "error": "REPLAY_ATTACK",
  "message": "Payment signature already used",
  "details": {
    "originalTool": "analyzeMarket"
  }
}
```

## Security

### Implemented Protections

1. **Replay Attack Prevention**: Cached signatures cannot be reused
2. **Transaction Age Limit**: Payments older than 5 minutes rejected
3. **Amount Verification**: Exact amount matching required
4. **Recipient Verification**: Only payments to correct address accepted
5. **Token Verification**: Only USDC transfers accepted
6. **Signature Validation**: Format validation before RPC calls

### Best Practices

- Use separate wallets for devnet and mainnet
- Enable Redis authentication in production
- Use TLS for Redis connections
- Monitor for unusual payment patterns
- Set up alerts for high failure rates
- Use premium RPC endpoints (Helius, QuickNode)
- Implement rate limiting at application level

## Production Deployment

### Checklist

- [ ] Configure mainnet wallet address
- [ ] Set up Redis with authentication and TLS
- [ ] Configure premium RPC endpoints
- [ ] Enable monitoring and alerting
- [ ] Set up log aggregation
- [ ] Configure automatic backups
- [ ] Test payment flow on devnet
- [ ] Verify cache persistence
- [ ] Load test with multiple instances
- [ ] Set up health check endpoints

### Recommended Infrastructure

- **RPC Provider**: Helius or QuickNode (high rate limits)
- **Cache**: Redis Cloud or AWS ElastiCache
- **Monitoring**: Datadog, New Relic, or Prometheus
- **Alerts**: PagerDuty or Opsgenie
- **Logs**: CloudWatch, Stackdriver, or Papertrail

### Horizontal Scaling

1. Deploy multiple MCP server instances
2. Use shared Redis cache
3. Load balance at client level
4. Monitor cache hit rates across instances

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
npm run format
```

## Examples

See detailed examples in:
- [CLIENT_EXAMPLE.md](./CLIENT_EXAMPLE.md) - Client implementation examples
- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) - Complete implementation guide
- [PAYMENT_DESIGN.md](./PAYMENT_DESIGN.md) - Technical design document

## Troubleshooting

### Transaction Not Found

**Cause**: Transaction not yet confirmed or on wrong network

**Solution**:
1. Wait 5-10 seconds for confirmation
2. Verify network matches (devnet vs mainnet)
3. Check transaction on Solana Explorer
4. Verify RPC endpoint is responding

### Insufficient Amount

**Cause**: Payment amount doesn't match requirement

**Solution**:
1. Check calculated price for dynamic pricing tools
2. Ensure USDC has 6 decimals (multiply by 1,000,000)
3. Account for any percentage-based fees

### Replay Attack Error

**Cause**: Attempting to reuse a payment signature

**Solution**:
1. Create a new payment transaction
2. Don't reuse signatures across different tools
3. Check if cache has expired prematurely

### RPC Errors

**Cause**: RPC endpoint issues or rate limiting

**Solution**:
1. Check RPC endpoint health
2. Add fallback endpoints in configuration
3. Use premium RPC provider (Helius, QuickNode)
4. Increase retry attempts and delays

## Cost Optimization

### RPC Call Reduction

- **Cache Hit Rate**: Target 60%+ to reduce RPC calls by 60%
- **Connection Pooling**: Reuse connections across requests
- **Batch Operations**: Use `getSignatureStatuses` for multiple signatures
- **Commitment Levels**: Use 'confirmed' instead of 'finalized' when safe

### Example Savings

| Scenario                | RPC Calls | Savings |
|-------------------------|-----------|---------|
| Without cache           | 3,000/day | -       |
| With 60% cache hit rate | 1,200/day | 60%     |
| With batching           | 800/day   | 73%     |

## License

MIT

## Support

For issues and questions:
- GitHub Issues: [github.com/your-org/betting-analytics-mcp-server/issues](https://github.com/your-org/betting-analytics-mcp-server/issues)
- Documentation: See [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)
- x402 Protocol: [github.com/x402-solana](https://github.com/x402-solana)

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## Acknowledgments

- Built with [Model Context Protocol](https://modelcontextprotocol.io)
- Powered by [Solana](https://solana.com)
- Inspired by [x402 Protocol](https://github.com/x402-solana)
