# x402 MCP Server Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         AI Agent / Client                        │
│  - Calls MCP tools via JSON-RPC                                 │
│  - Creates Solana USDC payments                                 │
│  - Handles payment signature parameter                          │
└────────────────┬────────────────────────────────────────────────┘
                 │ stdio (JSON-RPC)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Server                                │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │                    Tool Handler                              │ │
│ │  - Receives tool calls                                       │ │
│ │  - Checks for payment signature                              │ │
│ │  - Delegates to Payment Service                              │ │
│ │  - Executes tool logic after verification                    │ │
│ └────────────────┬────────────────────────────────────────────┘ │
│                  │                                               │
│ ┌────────────────▼────────────────────────────────────────────┐ │
│ │                  Payment Service                             │ │
│ │  - Calculates required payment amount                        │ │
│ │  - Verifies transaction on Solana                            │ │
│ │  - Manages payment cache                                     │ │
│ │  - Prevents replay attacks                                   │ │
│ └─┬─────────────┬─────────────┬─────────────┬────────────────┘ │
│   │             │             │             │                   │
│   ▼             ▼             ▼             ▼                   │
│ ┌─────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│ │Cache│  │   RPC    │  │  Error   │  │ Monitor  │             │
│ │     │  │ Manager  │  │ Handler  │  │          │             │
│ └─────┘  └──────────┘  └──────────┘  └──────────┘             │
└────┬────────────┬────────────────────────────┬─────────────────┘
     │            │                            │
     ▼            ▼                            ▼
┌─────────┐  ┌──────────┐              ┌────────────┐
│  Redis  │  │  Solana  │              │ Monitoring │
│  Cache  │  │   RPC    │              │  Service   │
└─────────┘  └──────────┘              └────────────┘
```

## Component Details

### 1. MCP Server Layer

**Responsibility**: JSON-RPC communication over stdio

**Components**:
- `server.ts`: MCP server initialization and request handling
- Tool registration with payment requirements in descriptions

**Key Operations**:
- List available tools with payment information
- Route tool calls to handler
- Format responses in MCP protocol

### 2. Tool Handler Layer

**Responsibility**: Business logic and payment orchestration

**Components**:
- `betting.handler.ts`: Tool implementations with payment verification

**Payment Flow**:
```typescript
1. Extract payment signature from arguments
2. Calculate required payment amount
3. If no signature → Return PAYMENT_REQUIRED error
4. If signature exists → Verify payment
5. If verified → Execute tool logic
6. Return result with payment info
```

**Tool Categories**:
- **Paid Tools**: executeBet, analyzeMarket, getOdds
- **Free Tools**: healthCheck

### 3. Payment Service Layer

**Responsibility**: Payment verification and management

**Components**:
- `payment.service.ts`: Core payment verification logic
- `rpc-manager.ts`: RPC connection pooling and failover
- `payment-cache.ts`: Redis and in-memory caching
- `payment-errors.ts`: Error types and factories
- `payment-monitor.ts`: Metrics and alerting

**Verification Process**:
```typescript
1. Validate signature format
2. Check cache for replay attack
3. Query Solana RPC for transaction
4. Verify transaction age (< 5 minutes)
5. Extract USDC transfer details
6. Verify amount, recipient, token
7. Cache successful verification
8. Return verification result
```

### 4. Cache Layer

**Responsibility**: Payment signature deduplication

**Storage Backends**:
- **Redis**: Production (multi-instance support)
- **In-Memory**: Development (single instance)

**Cache Key Structure**:
```
x402:payment:{signature}
```

**Cache Entry**:
```typescript
{
  toolName: string,      // Which tool used this payment
  amount: number,        // Payment amount in USDC
  timestamp: number,     // When verified
  verified: boolean,     // Verification status
  params?: any          // Tool parameters (optional)
}
```

**TTL**: 1 hour (configurable)

### 5. RPC Manager

**Responsibility**: Solana RPC communication with reliability

**Features**:
- **Round-robin load balancing** across multiple endpoints
- **Rate limiting** (50 req/sec default)
- **Automatic retry** with exponential backoff
- **Health checking** of endpoints
- **Failover** to backup endpoints

**Bottleneck Configuration**:
```typescript
{
  maxConcurrent: 10,           // Max parallel requests
  reservoir: 50,               // Max per refresh interval
  reservoirRefreshInterval: 1000,  // 1 second
  minTime: 20                  // Min 20ms between requests
}
```

### 6. Error Handler

**Responsibility**: Consistent error formatting

**Error Categories**:

| Category | Codes |
|----------|-------|
| Payment Required | `PAYMENT_REQUIRED` |
| Format Errors | `INVALID_SIGNATURE` |
| Chain Errors | `TRANSACTION_NOT_FOUND`, `EXPIRED_PAYMENT` |
| Verification Errors | `INSUFFICIENT_AMOUNT`, `WRONG_RECIPIENT`, `WRONG_TOKEN` |
| Security Errors | `REPLAY_ATTACK` |
| System Errors | `RPC_ERROR`, `VERIFICATION_TIMEOUT` |

**MCP Error Format**:
```json
{
  "content": [{
    "type": "text",
    "text": JSON.stringify({
      "error": "ERROR_CODE",
      "message": "Human-readable message",
      "details": { /* Additional context */ }
    })
  }],
  "isError": true
}
```

### 7. Monitor

**Responsibility**: Observability and alerting

**Metrics Tracked**:
- Total verifications
- Success/failure counts and rates
- Cache hit/miss rates
- Average verification time
- RPC error count
- Total USDC processed

**Alert Conditions**:
- Failure rate > 10%
- RPC errors > 10
- Avg verification time > 5 seconds

**Export Formats**:
- JSON (for application consumption)
- Prometheus (for Grafana/etc)

## Data Flow

### Happy Path: Successful Payment Verification

```
┌──────┐    ┌─────────┐    ┌─────────┐    ┌───────┐    ┌────────┐
│Agent │    │ Handler │    │ Payment │    │ Cache │    │ Solana │
│      │    │         │    │ Service │    │       │    │        │
└──┬───┘    └────┬────┘    └────┬────┘    └───┬───┘    └───┬────┘
   │             │              │             │            │
   │ Call tool   │              │             │            │
   │ (no sig)    │              │             │            │
   ├────────────>│              │             │            │
   │             │              │             │            │
   │             │ Get payment  │             │            │
   │             │ requirement  │             │            │
   │             ├─────────────>│             │            │
   │             │              │             │            │
   │             │ Return req   │             │            │
   │             │<─────────────┤             │            │
   │             │              │             │            │
   │ PAYMENT_REQ │              │             │            │
   │<────────────┤              │             │            │
   │             │              │             │            │
   │ Create USDC payment tx    │             │            │
   ├───────────────────────────────────────────────────────>│
   │             │              │             │            │
   │ Wait for confirmation     │             │            │
   │<───────────────────────────────────────────────────────┤
   │             │              │             │            │
   │ Call tool   │              │             │            │
   │ (with sig)  │              │             │            │
   ├────────────>│              │             │            │
   │             │              │             │            │
   │             │ Verify       │             │            │
   │             │ payment      │             │            │
   │             ├─────────────>│             │            │
   │             │              │             │            │
   │             │              │ Check cache │            │
   │             │              ├────────────>│            │
   │             │              │             │            │
   │             │              │ Not found   │            │
   │             │              │<────────────┤            │
   │             │              │             │            │
   │             │              │ Get transaction          │
   │             │              ├────────────────────────>│
   │             │              │             │            │
   │             │              │ Tx details  │            │
   │             │              │<────────────────────────┤
   │             │              │             │            │
   │             │              │ Verify amount,          │
   │             │              │ recipient, token        │
   │             │              │             │            │
   │             │              │ Cache result│            │
   │             │              ├────────────>│            │
   │             │              │             │            │
   │             │ Verified     │             │            │
   │             │<─────────────┤             │            │
   │             │              │             │            │
   │ Execute     │              │             │            │
   │ tool logic  │              │             │            │
   │             │              │             │            │
   │ Result      │              │             │            │
   │<────────────┤              │             │            │
```

### Error Path: Replay Attack Detection

```
┌──────┐    ┌─────────┐    ┌─────────┐    ┌───────┐
│Agent │    │ Handler │    │ Payment │    │ Cache │
│      │    │         │    │ Service │    │       │
└──┬───┘    └────┬────┘    └────┬────┘    └───┬───┘
   │             │              │             │
   │ Call tool   │              │             │
   │ (with sig)  │              │             │
   ├────────────>│              │             │
   │             │              │             │
   │             │ Verify       │             │
   │             ├─────────────>│             │
   │             │              │             │
   │             │              │ Check cache │
   │             │              ├────────────>│
   │             │              │             │
   │             │              │ Found!      │
   │             │              │ (different  │
   │             │              │  tool)      │
   │             │              │<────────────┤
   │             │              │             │
   │             │ REPLAY_ATK   │             │
   │             │<─────────────┤             │
   │             │              │             │
   │ Error       │              │             │
   │<────────────┤              │             │
```

## Pricing Models

### Fixed Pricing

```typescript
calculatePrice(toolName: string): number {
  const prices = {
    'analyzeMarket': 0.05,  // $0.05 USDC
    'getOdds': 0.02,        // $0.02 USDC
  };
  return prices[toolName] || 0.01;
}
```

### Dynamic Pricing

```typescript
calculatePrice(toolName: string, params: any): number {
  if (toolName === 'executeBet') {
    const baseFee = 0.10;              // $0.10 base
    const percentageFee = params.amount * 0.02;  // 2% of bet
    return baseFee + percentageFee;
  }
  return 0.05;
}
```

**Example**: Bet $100
- Base fee: $0.10
- Percentage fee: $100 × 2% = $2.00
- **Total**: $2.10 USDC

### Tiered Pricing

```typescript
calculatePrice(toolName: string, params: any): number {
  if (toolName === 'dataAnalysis') {
    const dataSize = params.size;
    if (dataSize < 1000) return 0.01;      // Small
    if (dataSize < 10000) return 0.05;     // Medium
    return 0.10;                           // Large
  }
  return 0.01;
}
```

## Security Model

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Replay attacks | Payment signature caching |
| Expired payments | Transaction age verification |
| Insufficient payments | Exact amount matching |
| Wrong recipient | Recipient address verification |
| Wrong token | USDC mint verification |
| RPC manipulation | Multiple endpoint verification |
| Cache poisoning | Redis authentication + TLS |

### Security Layers

1. **Input Validation**
   - Signature format validation
   - Parameter type checking
   - Amount range validation

2. **On-Chain Verification**
   - Transaction existence
   - Confirmation status
   - Token transfer parsing

3. **Business Logic**
   - Amount matching
   - Recipient matching
   - Age validation

4. **Caching**
   - Replay attack prevention
   - TTL-based expiration
   - Secure storage

## Performance Optimization

### Cache Hit Rate

**Target**: 60%+ cache hit rate

**Benefits**:
- Reduces RPC calls by 60%
- Faster response times
- Lower infrastructure costs

**Strategies**:
- Appropriate TTL (1 hour default)
- Warm cache on startup
- Monitor hit/miss ratios

### RPC Call Reduction

**Techniques**:
1. **Caching**: Store verified transactions
2. **Batching**: Use `getSignatureStatuses` for multiple signatures
3. **Connection pooling**: Reuse WebSocket connections
4. **Commitment optimization**: Use 'confirmed' instead of 'finalized'

**Impact**:
```
Without optimization: 3 calls/verification × 1000 verifications = 3000 calls
With 60% cache hit:   3 calls × 400 verifications = 1200 calls
Reduction: 60%
```

### Horizontal Scaling

**Requirements**:
- Redis for shared cache
- Stateless server design
- Load balancing at client

**Deployment**:
```
┌────────┐     ┌────────┐     ┌────────┐
│ MCP    │     │ MCP    │     │ MCP    │
│Server 1│     │Server 2│     │Server 3│
└───┬────┘     └───┬────┘     └───┬────┘
    │              │              │
    └──────────┬───┴──────────────┘
               │
         ┌─────▼─────┐
         │   Redis   │
         │  Cluster  │
         └───────────┘
```

## Deployment Patterns

### Development

```yaml
Environment: Local
Cache: In-memory
Network: Devnet
RPC: Public endpoint
Monitoring: Console logs
```

### Staging

```yaml
Environment: Cloud
Cache: Redis (single instance)
Network: Devnet
RPC: Premium endpoint (Helius)
Monitoring: Basic metrics
```

### Production

```yaml
Environment: Cloud (multi-region)
Cache: Redis Cluster
Network: Mainnet
RPC: Premium endpoints (multiple providers)
Monitoring: Full observability stack
Alerts: PagerDuty integration
```

## Monitoring and Observability

### Key Metrics

**Payment Metrics**:
- `payment_verifications_total`: Counter
- `payment_success_rate`: Gauge (0-1)
- `payment_cache_hit_rate`: Gauge (0-1)
- `payment_verification_duration_seconds`: Histogram
- `payment_total_amount_usdc`: Counter

**RPC Metrics**:
- `rpc_calls_total`: Counter
- `rpc_errors_total`: Counter
- `rpc_response_time_seconds`: Histogram

**Cache Metrics**:
- `cache_hits_total`: Counter
- `cache_misses_total`: Counter
- `cache_size`: Gauge

### Dashboards

**Overview Dashboard**:
- Success rate (24h)
- Total USDC processed
- Cache hit rate
- Active verifications

**Performance Dashboard**:
- Verification duration (p50, p95, p99)
- RPC response times
- Cache performance
- Error rates

**Alerts**:
- Success rate < 90% (warning)
- Success rate < 80% (critical)
- RPC errors > 10/min (warning)
- Avg verification time > 5s (warning)

## Summary

This architecture provides:

1. **Seamless Integration**: Payment as a tool parameter
2. **Production Reliability**: Redis caching, RPC failover, monitoring
3. **Security**: Multiple verification layers, replay protection
4. **Performance**: Caching, connection pooling, batching
5. **Scalability**: Horizontal scaling with shared cache
6. **Observability**: Comprehensive metrics and alerting

The key innovation is treating payment verification as part of the tool execution flow, making x402 micropayments feel native to the MCP protocol while maintaining full security and on-chain verification.
