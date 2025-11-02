# x402 MCP Server Design Summary

## Executive Summary

This document summarizes the design and implementation of x402 Solana micropayments for MCP servers. The challenge is adapting the x402 protocol (designed for HTTP) to work with MCP's stdio-based JSON-RPC communication.

## The Challenge

**Standard x402 (HTTP)**:
```
HTTP Request → Middleware checks x402 header → Verify payment → Route to handler
```

**MCP (stdio)**:
```
JSON-RPC over stdio → No middleware layer → Tools called directly
```

**Key Insight**: In MCP, payment verification must be part of the tool execution flow, not a middleware layer.

## The Solution

### Payment Signature as Tool Parameter

Instead of HTTP headers, payment signatures are passed as a special tool parameter:

```typescript
{
  name: "analyzeMarket",
  inputSchema: {
    type: "object",
    properties: {
      market: { type: "string" },
      timeframe: { type: "string" },
      x402_payment_signature: {  // ← Payment signature
        type: "string",
        description: "Payment signature (optional on first call)"
      }
    }
  }
}
```

### Two-Step Flow

**Step 1: Payment Discovery**
```json
// Request (no payment)
{ "market": "NBA-LAL-vs-GSW", "timeframe": "24h" }

// Response
{
  "error": "PAYMENT_REQUIRED",
  "payment": {
    "amount": 0.05,
    "recipient": "8x4e...",
    "usdcMint": "4zMM...",
    "network": "devnet"
  }
}
```

**Step 2: Payment Execution**
```json
// Request (with payment)
{
  "market": "NBA-LAL-vs-GSW",
  "timeframe": "24h",
  "x402_payment_signature": "5KxR7...9mJp"
}

// Response
{
  "success": true,
  "payment": { "verified": true },
  "result": { /* analysis data */ }
}
```

## Core Components

### 1. Payment Service (`payment.service.ts`)

**Responsibilities**:
- Calculate required payment amounts (fixed or dynamic)
- Verify Solana transactions on-chain
- Manage payment signature cache
- Prevent replay attacks

**Key Methods**:
```typescript
class PaymentService {
  // Get payment requirement for a tool call
  getPaymentRequirement(toolName, params): PaymentRequirement

  // Verify a payment transaction
  verifyPayment(signature, expectedAmount, toolName): VerificationResult

  // Calculate dynamic pricing
  calculatePrice(toolName, params): number

  // Health check
  healthCheck(): HealthStatus
}
```

### 2. Payment Cache (`payment-cache.ts`)

**Purpose**: Prevent replay attacks and reduce RPC calls

**Implementations**:
- **Redis**: Production (multi-instance support)
- **In-Memory**: Development (single instance)

**Cache Structure**:
```
Key: x402:payment:{signature}
Value: { toolName, amount, timestamp, verified }
TTL: 1 hour
```

**Benefits**:
- 60%+ reduction in RPC calls
- Instant response for cached payments
- Replay attack prevention

### 3. RPC Manager (`rpc-manager.ts`)

**Purpose**: Reliable Solana RPC communication

**Features**:
- Round-robin load balancing
- Rate limiting (50 req/sec)
- Automatic retry with backoff
- Health checking
- Failover to backup endpoints

### 4. Error Handling (`payment-errors.ts`)

**Error Types**:
- `PAYMENT_REQUIRED`: No signature provided
- `INVALID_SIGNATURE`: Bad signature format
- `TRANSACTION_NOT_FOUND`: Tx not on-chain
- `INSUFFICIENT_AMOUNT`: Payment too low
- `WRONG_RECIPIENT`: Wrong destination
- `WRONG_TOKEN`: Not USDC
- `EXPIRED_PAYMENT`: Transaction too old
- `REPLAY_ATTACK`: Signature already used
- `RPC_ERROR`: RPC communication failed
- `VERIFICATION_TIMEOUT`: Verification took too long

All errors are MCP-compatible:
```json
{
  "content": [{ "type": "text", "text": JSON.stringify(error) }],
  "isError": true
}
```

### 5. Monitoring (`payment-monitor.ts`)

**Tracked Metrics**:
- Total verifications
- Success/failure rates
- Cache hit rates
- Average verification time
- RPC error counts
- Total USDC processed

**Alerts**:
- High failure rate (> 10%)
- Excessive RPC errors (> 10)
- Slow verifications (> 5s)

**Export Formats**:
- JSON for application consumption
- Prometheus for Grafana

## Implementation Pattern

### Tool Handler Template

```typescript
async handleToolCall(toolName: string, args: any) {
  // 1. Extract payment signature
  const paymentSignature = args.x402_payment_signature;

  // 2. Calculate required payment
  const paymentReq = this.paymentService.getPaymentRequirement(
    toolName,
    args
  );

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

  // 6. Return result with payment info
  return {
    success: true,
    payment: {
      verified: true,
      cached: verification.cached,
      amount: paymentReq.amount
    },
    result
  };
}
```

## Pricing Models

### Fixed Pricing

Simple, predictable fees:

```typescript
{
  'analyzeMarket': 0.05,  // $0.05
  'getOdds': 0.02,        // $0.02
}
```

### Dynamic Pricing

Fee based on parameters:

```typescript
calculatePrice('executeBet', { amount: 100 }) {
  const baseFee = 0.10;              // $0.10
  const percentageFee = 100 * 0.02;  // $2.00 (2%)
  return 2.10;                       // Total: $2.10
}
```

### Tiered Pricing

Fee based on usage level:

```typescript
calculatePrice('dataAnalysis', { size: 5000 }) {
  if (size < 1000) return 0.01;   // Small
  if (size < 10000) return 0.05;  // Medium
  return 0.10;                    // Large
}
```

## Security Model

### Defense in Depth

**Layer 1: Input Validation**
- Signature format validation
- Parameter type checking
- Amount range validation

**Layer 2: On-Chain Verification**
- Transaction existence check
- Confirmation status verification
- Token transfer parsing

**Layer 3: Business Logic**
- Amount matching
- Recipient matching
- Transaction age validation

**Layer 4: Caching**
- Replay attack prevention
- Signature deduplication
- Secure storage (Redis TLS)

### Security Checklist

- [x] Signature format validation
- [x] On-chain transaction verification
- [x] Amount verification (exact match)
- [x] Recipient verification
- [x] Token verification (USDC only)
- [x] Replay attack prevention (cache)
- [x] Transaction age limit (5 minutes)
- [x] Redis authentication (production)
- [x] TLS for Redis (production)
- [x] Rate limiting (application level)

## Performance Optimization

### Cache Strategy

**Target**: 60%+ cache hit rate

**Impact**:
```
1000 verifications/day
Without cache: 1000 × 3 RPC calls = 3000 calls
With 60% cache hit: 400 × 3 RPC calls = 1200 calls
Savings: 60% reduction in RPC costs
```

### RPC Optimization

**Techniques**:
1. **Connection pooling**: Reuse connections
2. **Batching**: `getSignatureStatuses` for multiple signatures
3. **Commitment optimization**: Use 'confirmed' vs 'finalized'
4. **Multiple endpoints**: Failover and load balancing

### Horizontal Scaling

**Requirements**:
- Redis for shared cache
- Stateless server design
- Client-side load balancing

**Deployment**:
```
┌─────────┐  ┌─────────┐  ┌─────────┐
│ MCP #1  │  │ MCP #2  │  │ MCP #3  │
└────┬────┘  └────┬────┘  └────┬────┘
     └───────────┬────────────┘
                 │
          ┌──────▼──────┐
          │Redis Cluster│
          └─────────────┘
```

## Production Deployment

### Environment Configuration

**Development**:
```env
SOLANA_NETWORK=devnet
REDIS_URL=  # In-memory cache
SOLANA_RPC_DEVNET=https://api.devnet.solana.com
```

**Production**:
```env
SOLANA_NETWORK=mainnet
REDIS_URL=rediss://redis-cluster:6379
SOLANA_RPC_MAINNET=https://premium-rpc.helius.com
HELIUS_API_KEY=your_key
MONITORING_ENABLED=true
```

### Infrastructure Recommendations

| Component | Development | Production |
|-----------|-------------|------------|
| Cache | In-memory | Redis Cluster |
| RPC | Public endpoint | Helius/QuickNode |
| Monitoring | Console logs | Datadog/New Relic |
| Alerts | None | PagerDuty |
| Logs | Local | CloudWatch/Stackdriver |

### Deployment Checklist

- [ ] Configure mainnet wallet
- [ ] Set up Redis with auth + TLS
- [ ] Configure premium RPC endpoints
- [ ] Enable monitoring
- [ ] Set up alerting
- [ ] Test on devnet
- [ ] Load test
- [ ] Configure backups
- [ ] Document runbooks

## Cost Analysis

### RPC Costs

**Assumptions**:
- 1000 verifications/day
- $0.001 per RPC call (typical premium endpoint)

**Without Optimization**:
```
1000 verifications × 3 calls = 3000 calls/day
3000 × $0.001 = $3.00/day = $90/month
```

**With 60% Cache Hit Rate**:
```
400 verifications × 3 calls = 1200 calls/day
1200 × $0.001 = $1.20/day = $36/month
Savings: $54/month (60%)
```

### Redis Costs

**AWS ElastiCache** (us-east-1):
- cache.t3.micro: $15/month
- cache.r6g.large: $125/month (production)

**Redis Cloud**:
- 500MB: $5/month
- 5GB: $50/month

### Total Monthly Cost Estimate

**Low Volume** (100 verifications/day):
- RPC: $10/month
- Redis: $5/month
- **Total**: $15/month

**Medium Volume** (1000 verifications/day):
- RPC: $36/month (with caching)
- Redis: $15/month
- **Total**: $51/month

**High Volume** (10,000 verifications/day):
- RPC: $360/month (with caching)
- Redis: $50/month
- **Total**: $410/month

## Comparison: HTTP vs MCP x402

| Aspect | HTTP (Standard) | MCP (This Design) |
|--------|-----------------|-------------------|
| Payment Location | HTTP header | Tool parameter |
| Verification | Middleware | Tool handler |
| Error Response | HTTP 402 | JSON error |
| Client Integration | Auto-payment header | Two-step flow |
| Middleware Support | Yes | No (by design) |
| Protocol Overhead | HTTP headers | JSON parameter |

## Key Advantages

### 1. MCP-Native Design
- Works with stdio transport
- No middleware required
- Natural tool parameter

### 2. Developer Experience
- Clear payment requirements in tool schema
- Descriptive error messages
- Easy to test and debug

### 3. AI Agent Friendly
- Discoverable payment requirements
- Step-by-step instructions
- Retry-friendly flow

### 4. Production Ready
- Redis caching for scale
- RPC failover
- Comprehensive monitoring
- Security best practices

### 5. Cost Effective
- 60%+ cache hit rate
- Optimized RPC usage
- Batch operations support

## Limitations and Tradeoffs

### Limitations

1. **Two-Step Flow**: Requires retry (vs HTTP 402 auto-retry)
2. **No Native Middleware**: Payment logic in each handler
3. **Cache Dependency**: Redis required for multi-instance
4. **RPC Latency**: On-chain verification adds latency (1-3s)

### Tradeoffs

| Choice | Pro | Con |
|--------|-----|-----|
| Parameter vs Header | Works with stdio | More verbose |
| Two-step flow | Clear to agents | Extra round-trip |
| On-chain verification | Secure | Slower than cache-only |
| Redis cache | Multi-instance support | Infrastructure dependency |

## Future Enhancements

### Short Term

1. **Batch Verification**: Verify multiple signatures in one RPC call
2. **Pre-warming Cache**: Load recent payments on startup
3. **WebSocket RPC**: Faster confirmation via subscriptions
4. **GraphQL RPC**: Reduce data transfer overhead

### Medium Term

1. **Payment Pools**: Pre-fund account for instant verification
2. **L2 Integration**: Use Solana L2 for lower fees
3. **Multi-Token Support**: Accept SOL, other SPL tokens
4. **Subscription Model**: Monthly pass for unlimited access

### Long Term

1. **Zero-Knowledge Proofs**: Verify without on-chain lookup
2. **State Compression**: Reduce transaction size
3. **Cross-Chain**: Support other blockchains
4. **Decentralized Cache**: P2P payment verification network

## Testing Strategy

### Unit Tests

```typescript
describe('PaymentService', () => {
  it('calculates fixed price correctly')
  it('calculates dynamic price correctly')
  it('validates signature format')
  it('detects replay attacks')
  it('handles RPC errors gracefully')
})
```

### Integration Tests

```typescript
describe('Payment Flow', () => {
  it('rejects call without payment')
  it('accepts call with valid payment')
  it('caches verified payments')
  it('prevents signature reuse')
})
```

### End-to-End Tests

```typescript
describe('Full Flow', () => {
  it('completes payment flow on devnet')
  it('handles network errors')
  it('retries failed verifications')
  it('scales with multiple instances')
})
```

## Documentation

### For Developers

- [README.md](./README.md) - Overview and quick start
- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) - Step-by-step implementation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture details
- [PAYMENT_DESIGN.md](./PAYMENT_DESIGN.md) - Full design specification

### For Users

- [CLIENT_EXAMPLE.md](./CLIENT_EXAMPLE.md) - Client integration examples
- Tool descriptions include payment information
- Error messages include actionable instructions

## Conclusion

This design successfully adapts the x402 micropayment protocol to MCP servers by:

1. **Using tool parameters** instead of HTTP headers for payment signatures
2. **Implementing a two-step flow** that's natural for AI agents
3. **Providing production-ready components** for caching, monitoring, and error handling
4. **Optimizing costs** through intelligent caching and RPC management
5. **Maintaining security** with replay prevention and on-chain verification

The result is a system that feels native to MCP while providing the full security and functionality of the x402 protocol.

## References

- MCP Protocol: https://modelcontextprotocol.io
- Solana Documentation: https://docs.solana.com
- x402 Toolkit: https://github.com/x402-solana/toolkit
- USDC on Solana: https://www.circle.com/en/usdc-multichain/solana

## License

MIT License - See [LICENSE](./LICENSE) file

## Support

For questions and issues:
- GitHub: [issues](https://github.com/your-org/betting-analytics-mcp-server/issues)
- Email: support@your-domain.com
- Discord: https://discord.gg/your-server
