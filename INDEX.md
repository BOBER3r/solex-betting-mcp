# x402 MCP Server - Complete Documentation Index

## Overview

This is a complete implementation of an MCP (Model Context Protocol) server with integrated x402 Solana micropayments. The server provides betting analytics tools that require USDC payments, demonstrating how to implement pay-per-use AI agent tools.

## Quick Start Guides

### For First-Time Users
1. Start with [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - 5-minute overview
2. Read [README.md](./README.md) - Full feature overview
3. Follow [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) - Step-by-step setup

### For Developers
1. Read [DESIGN_SUMMARY.md](./DESIGN_SUMMARY.md) - Design decisions
2. Study [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
3. Review [PAYMENT_DESIGN.md](./PAYMENT_DESIGN.md) - Technical specification

### For Client Developers
1. Read [CLIENT_EXAMPLE.md](./CLIENT_EXAMPLE.md) - Integration examples
2. Test with provided client code
3. Adapt to your use case

## Documentation Files

### User Documentation

#### [README.md](./README.md)
**Purpose**: Main documentation entry point
**Contains**:
- Project overview and features
- Installation and quick start
- Available tools and pricing
- Configuration options
- Error handling reference
- Production deployment guide
- Troubleshooting section

**Read this if**: You want a complete overview of the project

#### [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
**Purpose**: Fast lookup reference
**Contains**:
- 30-second overview
- Core concepts diagram
- Environment variables table
- Common tasks and solutions
- Pricing examples
- Error codes quick reference
- Troubleshooting commands

**Read this if**: You need quick answers to specific questions

### Developer Documentation

#### [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)
**Purpose**: Step-by-step implementation guide
**Contains**:
- Complete payment flow walkthrough
- Code examples for each component
- Dynamic pricing implementation
- Cache configuration
- Error handling patterns
- Monitoring setup
- Production deployment checklist
- Testing strategies

**Read this if**: You're implementing x402 in your own MCP server

#### [ARCHITECTURE.md](./ARCHITECTURE.md)
**Purpose**: System architecture and design
**Contains**:
- System overview diagram
- Component responsibilities
- Data flow diagrams
- Payment verification process
- Pricing models
- Security model
- Performance optimization
- Deployment patterns
- Monitoring and observability

**Read this if**: You want to understand how the system works internally

#### [PAYMENT_DESIGN.md](./PAYMENT_DESIGN.md)
**Purpose**: Complete technical specification
**Contains**:
- Payment flow design
- Core package usage (@x402-solana/core)
- Network configuration
- Payment verification implementation
- Dynamic pricing system
- Cache strategy (Redis vs in-memory)
- Comprehensive error handling
- Production concerns (RPC, monitoring, costs)
- Complete code examples

**Read this if**: You need the full technical specification

#### [DESIGN_SUMMARY.md](./DESIGN_SUMMARY.md)
**Purpose**: High-level design decisions
**Contains**:
- Problem statement and solution
- Core component overview
- Implementation patterns
- Pricing models
- Security model
- Performance optimization
- Production deployment strategy
- Cost analysis
- Comparison with HTTP x402
- Future enhancements

**Read this if**: You want to understand the design philosophy

### Client Documentation

#### [CLIENT_EXAMPLE.md](./CLIENT_EXAMPLE.md)
**Purpose**: Client integration examples
**Contains**:
- AI agent flow
- Claude Desktop configuration
- TypeScript/JavaScript client implementation
- Python client implementation
- Payment creation examples
- Error handling
- Testing scripts

**Read this if**: You're building a client that uses this server

## Source Code Files

### Configuration

#### [src/config/payment.config.ts](./src/config/payment.config.ts)
**Purpose**: Network and payment configuration
**Exports**:
- `NetworkConfig`: Type for network settings
- `NETWORKS`: Devnet and mainnet configurations
- `getNetworkConfig()`: Get current network config
- `getPaymentConfig()`: Get payment settings

**Key features**:
- USDC mint addresses for each network
- RPC endpoint configuration with failover
- Recipient wallet addresses
- Confirmation strategies

### Services

#### [src/services/payment.service.ts](./src/services/payment.service.ts)
**Purpose**: Core payment verification service
**Class**: `PaymentService`
**Methods**:
- `verifyPayment()`: Verify a Solana transaction
- `getPaymentRequirement()`: Get payment details for a tool
- `calculatePrice()`: Calculate dynamic pricing
- `healthCheck()`: Check service health

**Key features**:
- On-chain transaction verification
- Replay attack prevention
- Dynamic pricing support
- Cache integration
- Retry logic with exponential backoff

#### [src/services/rpc-manager.ts](./src/services/rpc-manager.ts)
**Purpose**: RPC connection management
**Class**: `RPCManager`
**Methods**:
- `getConnection()`: Get next available RPC connection
- `schedule()`: Execute RPC call with rate limiting
- `scheduleWithRetry()`: Execute with automatic retry
- `getHealthStatus()`: Get endpoint health status

**Key features**:
- Round-robin load balancing
- Rate limiting (Bottleneck)
- Health checking
- Automatic failover

### Cache

#### [src/cache/payment-cache.ts](./src/cache/payment-cache.ts)
**Purpose**: Payment signature caching
**Classes**:
- `PaymentCache`: Main abstraction
- `RedisCache`: Redis backend
- `MemoryCache`: In-memory backend

**Methods**:
- `get()`: Get cached entry
- `set()`: Cache new entry
- `has()`: Check if exists
- `delete()`: Remove entry
- `getStats()`: Get cache statistics

**Key features**:
- Dual backend support (Redis/Memory)
- Automatic TTL management
- Replay attack prevention
- Statistics tracking

### Errors

#### [src/errors/payment-errors.ts](./src/errors/payment-errors.ts)
**Purpose**: Error types and factories
**Exports**:
- `PaymentErrorCode`: Enum of error codes
- `PaymentError`: Base error class
- Factory functions for each error type

**Error types**:
- `PAYMENT_REQUIRED`
- `INVALID_SIGNATURE`
- `TRANSACTION_NOT_FOUND`
- `INSUFFICIENT_AMOUNT`
- `WRONG_RECIPIENT`
- `WRONG_TOKEN`
- `EXPIRED_PAYMENT`
- `REPLAY_ATTACK`
- `RPC_ERROR`
- `VERIFICATION_TIMEOUT`

**Key features**:
- MCP-compatible error format
- User-friendly messages
- Detailed error context

### Monitoring

#### [src/monitoring/payment-monitor.ts](./src/monitoring/payment-monitor.ts)
**Purpose**: Metrics and alerting
**Class**: `PaymentMonitor`
**Methods**:
- `recordVerification()`: Record verification attempt
- `recordRPCError()`: Record RPC error
- `getMetrics()`: Get current metrics
- `getWindowedMetrics()`: Get time-window metrics
- `exportPrometheusMetrics()`: Export for Prometheus

**Metrics tracked**:
- Total verifications
- Success/failure rates
- Cache hit rates
- Average verification time
- RPC error count
- Total USDC processed

**Key features**:
- Automatic alerting
- Prometheus export
- Time-windowed metrics
- Error breakdown

### Handlers

#### [src/handlers/betting.handler.ts](./src/handlers/betting.handler.ts)
**Purpose**: Tool implementations with payment verification
**Class**: `BettingToolHandler`
**Methods**:
- `handleToolCall()`: Main entry point for tool calls
- `executeBet()`: Place a bet
- `analyzeMarket()`: Analyze market trends
- `getOdds()`: Get current odds
- `healthCheck()`: Server health status

**Key features**:
- Payment verification integration
- MCP-compatible responses
- Error handling
- Simulated betting logic

### Server

#### [src/server.ts](./src/server.ts)
**Purpose**: MCP server entry point
**Responsibilities**:
- MCP server initialization
- Tool registration
- Request routing
- Graceful shutdown

**Key features**:
- Stdio transport
- Tool definitions with payment info
- Error handling
- Lifecycle management

## Configuration Files

### [.env.example](./.env.example)
**Purpose**: Environment variable template
**Contains**:
- Network configuration
- RPC endpoints
- Recipient wallet addresses
- Cache settings
- Verification parameters
- Monitoring settings

**Usage**: Copy to `.env` and customize

### [package.json](./package.json)
**Purpose**: Node.js package configuration
**Contains**:
- Dependencies
- Build scripts
- Project metadata

**Key dependencies**:
- `@solana/web3.js`: Solana client
- `@modelcontextprotocol/sdk`: MCP SDK
- `redis`: Redis client
- `bottleneck`: Rate limiting

### [tsconfig.json](./tsconfig.json)
**Purpose**: TypeScript compiler configuration
**Contains**:
- Compiler options
- Module settings
- Output configuration

## How to Navigate This Codebase

### Scenario 1: I want to understand the system
1. Read [DESIGN_SUMMARY.md](./DESIGN_SUMMARY.md)
2. Review [ARCHITECTURE.md](./ARCHITECTURE.md)
3. Look at code in this order:
   - `src/config/payment.config.ts`
   - `src/services/payment.service.ts`
   - `src/handlers/betting.handler.ts`
   - `src/server.ts`

### Scenario 2: I want to deploy this
1. Read [README.md](./README.md) - Quick Start section
2. Follow [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) - Production Deployment
3. Use [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) for troubleshooting

### Scenario 3: I want to build a client
1. Read [CLIENT_EXAMPLE.md](./CLIENT_EXAMPLE.md)
2. Study the payment flow in [DESIGN_SUMMARY.md](./DESIGN_SUMMARY.md)
3. Test with the provided examples

### Scenario 4: I want to add a new tool
1. Review tool pattern in [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md)
2. Add pricing in `src/services/payment.service.ts`
3. Implement logic in `src/handlers/betting.handler.ts`
4. Register in `src/server.ts`

### Scenario 5: I want to customize pricing
1. Read pricing section in [PAYMENT_DESIGN.md](./PAYMENT_DESIGN.md)
2. Study examples in [DESIGN_SUMMARY.md](./DESIGN_SUMMARY.md)
3. Modify `calculatePrice()` in `src/services/payment.service.ts`

### Scenario 6: I'm debugging an issue
1. Check error code in [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
2. Review error handling in [PAYMENT_DESIGN.md](./PAYMENT_DESIGN.md)
3. Check troubleshooting in [README.md](./README.md)
4. Look at relevant error factory in `src/errors/payment-errors.ts`

## Key Design Decisions

### Why payment signature as a tool parameter?
MCP uses stdio transport, not HTTP. There are no headers or middleware. Making the payment signature a tool parameter is the most natural way to integrate payments into the MCP protocol.

### Why two-step flow?
This makes the payment requirement discoverable and provides clear instructions to AI agents. It's retry-friendly and aligns with how AI agents naturally handle errors.

### Why cache payment signatures?
1. **Security**: Prevents replay attacks
2. **Performance**: 60%+ reduction in RPC calls
3. **Cost**: Lower infrastructure costs

### Why support both Redis and in-memory cache?
- **In-memory**: Simple for development and single-instance deployments
- **Redis**: Required for multi-instance production deployments

### Why dynamic pricing?
Different tools have different value propositions. Dynamic pricing allows fair monetization based on usage patterns (e.g., percentage of bet amount).

## Testing Strategy

### Unit Tests
Test individual components in isolation:
- `payment.service.test.ts`: Payment verification logic
- `payment-cache.test.ts`: Cache operations
- `rpc-manager.test.ts`: RPC connection management

### Integration Tests
Test component interactions:
- Payment flow end-to-end
- Cache persistence
- Error handling

### E2E Tests
Test full system on devnet:
- Real USDC transactions
- Complete payment flow
- Multi-instance scenarios

## Deployment Checklist

- [ ] Configure environment variables
- [ ] Set up Redis (production)
- [ ] Configure premium RPC endpoints
- [ ] Test on devnet
- [ ] Load test
- [ ] Set up monitoring
- [ ] Configure alerts
- [ ] Document runbooks
- [ ] Train team
- [ ] Deploy to production

## Support and Resources

### Documentation
- This index: Overview of all files
- Quick start: [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- Full guide: [README.md](./README.md)

### External Resources
- MCP Protocol: https://modelcontextprotocol.io
- Solana Docs: https://docs.solana.com
- x402 Toolkit: https://github.com/x402-solana

### Community
- GitHub Issues: Report bugs and feature requests
- Discord: Join the MCP/Solana communities
- Email: support@your-domain.com

## Version History

- v1.0.0 (Current): Initial release with core functionality
  - Payment verification
  - Redis + in-memory caching
  - Dynamic pricing
  - Monitoring and alerting
  - Production-ready deployment

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please see CONTRIBUTING.md for guidelines.

---

**Note**: This is a reference implementation demonstrating x402 micropayments in MCP servers. Adapt it to your specific use case and requirements.