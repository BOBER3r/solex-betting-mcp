# x402 Micropayment System Design for MCP Server

## Overview

This document outlines the architecture for integrating x402 Solana micropayments into an MCP (Model Context Protocol) server that provides betting analytics tools over JSON-RPC via stdio.

## 1. Payment Flow Design

### Core Challenge
MCP servers communicate via JSON-RPC over stdio (stdin/stdout), not HTTP. AI agents interact through structured tool calls, not REST endpoints.

### Proposed Flow

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│  AI Agent   │                    │ MCP Server  │                    │   Solana    │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                   │                                  │
       │ 1. Call tool without payment     │                                  │
       │──────────────────────────────────>│                                  │
       │                                   │                                  │
       │ 2. Return payment_required error │                                  │
       │   with amount & recipient        │                                  │
       │<──────────────────────────────────│                                  │
       │                                   │                                  │
       │ 3. Create & sign USDC tx         │                                  │
       │──────────────────────────────────────────────────────────────────────>│
       │                                   │                                  │
       │                            4. Transaction confirmed                  │
       │<──────────────────────────────────────────────────────────────────────│
       │                                   │                                  │
       │ 5. Call tool with signature      │                                  │
       │──────────────────────────────────>│                                  │
       │                                   │                                  │
       │                                   │ 6. Verify transaction            │
       │                                   │─────────────────────────────────>│
       │                                   │                                  │
       │                                   │ 7. Transaction details           │
       │                                   │<─────────────────────────────────│
       │                                   │                                  │
       │ 8. Return tool result             │                                  │
       │<──────────────────────────────────│                                  │
```

### Payment Signature in Tool Schema

**Option A: Special Parameter (Recommended)**
```typescript
{
  name: "analyzeMarket",
  inputSchema: {
    type: "object",
    properties: {
      market: { type: "string" },
      timeframe: { type: "string" },
      x402_payment_signature: {
        type: "string",
        description: "Solana transaction signature for x402 payment (optional on first call)"
      }
    },
    required: ["market", "timeframe"]
  }
}
```

**Advantages:**
- Explicit and discoverable
- Works with all MCP clients
- Clear separation of payment from business logic
- Easy to document and validate

**Option B: Separate Payment Tool**
```typescript
// Two-step process
1. Call: verifyPayment({ signature: "..." })
2. Call: analyzeMarket({ market: "...", sessionToken: "..." })
```
Not recommended - adds complexity and requires session management.

## 2. Core Package Configuration

### Network Configuration

```typescript
// src/config/payment.config.ts
import { PublicKey } from '@solana/web3.js';

export interface NetworkConfig {
  rpcEndpoint: string;
  usdcMint: PublicKey;
  recipientWallet: PublicKey;
  confirmationStrategy: 'finalized' | 'confirmed';
}

export const NETWORKS: Record<'devnet' | 'mainnet', NetworkConfig> = {
  devnet: {
    rpcEndpoint: process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com',
    usdcMint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), // Devnet USDC
    recipientWallet: new PublicKey(process.env.RECIPIENT_WALLET_DEVNET!),
    confirmationStrategy: 'confirmed'
  },
  mainnet: {
    rpcEndpoint: process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com',
    usdcMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // Mainnet USDC
    recipientWallet: new PublicKey(process.env.RECIPIENT_WALLET_MAINNET!),
    confirmationStrategy: 'finalized'
  }
};

export const getNetworkConfig = (): NetworkConfig => {
  const network = (process.env.SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet';
  return NETWORKS[network];
};
```

### Payment Service Setup

```typescript
// src/services/payment.service.ts
import { Connection, PublicKey } from '@solana/web3.js';
import {
  TransactionVerifier,
  USDCVerifier,
  PaymentCache,
  VerificationResult
} from '@x402-solana/core';
import { getNetworkConfig } from '../config/payment.config';

export class PaymentService {
  private connection: Connection;
  private transactionVerifier: TransactionVerifier;
  private usdcVerifier: USDCVerifier;
  private paymentCache: PaymentCache;
  private config: NetworkConfig;

  constructor() {
    this.config = getNetworkConfig();

    // Initialize Solana connection with optimized settings
    this.connection = new Connection(
      this.config.rpcEndpoint,
      {
        commitment: this.config.confirmationStrategy,
        confirmTransactionInitialTimeout: 60000,
        // Use websocket for faster updates in production
        wsEndpoint: this.config.rpcEndpoint.replace('https', 'wss')
      }
    );

    // Initialize verifiers
    this.transactionVerifier = new TransactionVerifier(this.connection);

    this.usdcVerifier = new USDCVerifier({
      connection: this.connection,
      usdcMint: this.config.usdcMint,
      recipientWallet: this.config.recipientWallet
    });

    // Initialize cache (Redis for production, in-memory for dev)
    this.paymentCache = new PaymentCache({
      type: process.env.REDIS_URL ? 'redis' : 'memory',
      redisUrl: process.env.REDIS_URL,
      ttl: 3600, // 1 hour cache
      prefix: 'x402:payment:'
    });
  }

  /**
   * Verify a payment transaction
   */
  async verifyPayment(
    signature: string,
    expectedAmount: number, // Amount in USDC (e.g., 0.10)
    toolName: string
  ): Promise<VerificationResult> {
    // Check cache first (prevents replay attacks and saves RPC calls)
    const cached = await this.paymentCache.get(signature);
    if (cached) {
      if (cached.toolName !== toolName) {
        return {
          valid: false,
          error: 'PAYMENT_USED_FOR_DIFFERENT_TOOL',
          details: `Payment was used for ${cached.toolName}, not ${toolName}`
        };
      }
      return { valid: true, cached: true };
    }

    // Verify transaction exists and is confirmed
    const txResult = await this.transactionVerifier.verify(signature);
    if (!txResult.valid) {
      return txResult;
    }

    // Verify USDC transfer details
    const usdcResult = await this.usdcVerifier.verify(
      signature,
      expectedAmount,
      this.config.recipientWallet
    );

    if (!usdcResult.valid) {
      return usdcResult;
    }

    // Cache successful payment
    await this.paymentCache.set(signature, {
      toolName,
      amount: expectedAmount,
      timestamp: Date.now(),
      verified: true
    });

    return { valid: true, cached: false };
  }

  /**
   * Calculate dynamic pricing for tools
   */
  calculatePrice(toolName: string, params: any): number {
    switch (toolName) {
      case 'executeBet':
        const betAmount = params.amount || 0;
        const baseFee = 0.10; // $0.10 base
        const percentageFee = betAmount * 0.02; // 2% of bet
        return baseFee + percentageFee;

      case 'analyzeMarket':
        return 0.05; // $0.05 fixed

      case 'getOdds':
        return 0.02; // $0.02 fixed

      default:
        return 0.01; // Default $0.01
    }
  }

  /**
   * Get payment requirements for a tool call
   */
  getPaymentRequirement(toolName: string, params: any) {
    const amount = this.calculatePrice(toolName, params);
    return {
      amount,
      recipient: this.config.recipientWallet.toBase58(),
      usdcMint: this.config.usdcMint.toBase58(),
      network: process.env.SOLANA_NETWORK || 'devnet',
      description: `Payment for ${toolName}`
    };
  }

  /**
   * Health check for RPC connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      const slot = await this.connection.getSlot();
      return slot > 0;
    } catch (error) {
      console.error('RPC health check failed:', error);
      return false;
    }
  }
}
```

## 3. MCP Tool Implementation

### Tool Handler with Payment Verification

```typescript
// src/handlers/betting.handler.ts
import { PaymentService } from '../services/payment.service';

export class BettingToolHandler {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  /**
   * Handle tool call with payment verification
   */
  async handleToolCall(toolName: string, args: any) {
    // Check if payment signature is provided
    const paymentSignature = args.x402_payment_signature;

    // Calculate required payment
    const paymentReq = this.paymentService.getPaymentRequirement(toolName, args);

    // If no payment signature, return payment required error
    if (!paymentSignature) {
      return this.createPaymentRequiredError(toolName, paymentReq);
    }

    // Verify payment
    try {
      const verification = await this.paymentService.verifyPayment(
        paymentSignature,
        paymentReq.amount,
        toolName
      );

      if (!verification.valid) {
        return this.createPaymentInvalidError(verification);
      }

      // Payment verified - execute tool logic
      return await this.executeTool(toolName, args);

    } catch (error) {
      return this.createPaymentVerificationError(error);
    }
  }

  /**
   * Execute the actual tool logic
   */
  private async executeTool(toolName: string, args: any) {
    switch (toolName) {
      case 'executeBet':
        return this.executeBet(args);
      case 'analyzeMarket':
        return this.analyzeMarket(args);
      case 'getOdds':
        return this.getOdds(args);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Create MCP-compatible payment required error
   */
  private createPaymentRequiredError(toolName: string, paymentReq: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "PAYMENT_REQUIRED",
            message: `Payment of ${paymentReq.amount} USDC required for ${toolName}`,
            payment: paymentReq,
            instructions: [
              "1. Create a USDC transfer transaction to the recipient wallet",
              "2. Sign and send the transaction to Solana",
              "3. Wait for confirmation",
              "4. Call this tool again with x402_payment_signature parameter"
            ]
          }, null, 2)
        }
      ],
      isError: true
    };
  }

  /**
   * Create MCP-compatible payment invalid error
   */
  private createPaymentInvalidError(verification: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "PAYMENT_INVALID",
            message: "Payment verification failed",
            reason: verification.error,
            details: verification.details
          }, null, 2)
        }
      ],
      isError: true
    };
  }

  /**
   * Create MCP-compatible verification error
   */
  private createPaymentVerificationError(error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "PAYMENT_VERIFICATION_ERROR",
            message: "Failed to verify payment",
            details: error.message
          }, null, 2)
        }
      ],
      isError: true
    };
  }

  // Tool implementations
  private async executeBet(args: any) {
    // Implementation
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            betId: "bet_123",
            amount: args.amount,
            market: args.market
          })
        }
      ]
    };
  }

  private async analyzeMarket(args: any) {
    // Implementation
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            market: args.market,
            analysis: {
              trend: "bullish",
              confidence: 0.85
            }
          })
        }
      ]
    };
  }

  private async getOdds(args: any) {
    // Implementation
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            market: args.market,
            odds: {
              home: 1.85,
              away: 2.10,
              draw: 3.50
            }
          })
        }
      ]
    };
  }
}
```

### MCP Server Integration

```typescript
// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BettingToolHandler } from './handlers/betting.handler';

const server = new Server(
  {
    name: 'betting-analytics-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const toolHandler = new BettingToolHandler();

// Define tools with payment parameter
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'executeBet',
        description: 'Execute a bet on a market. Requires payment: $0.10 + 2% of bet amount in USDC.',
        inputSchema: {
          type: 'object',
          properties: {
            market: {
              type: 'string',
              description: 'The market identifier'
            },
            amount: {
              type: 'number',
              description: 'Bet amount in USD'
            },
            side: {
              type: 'string',
              enum: ['home', 'away', 'draw'],
              description: 'Betting side'
            },
            x402_payment_signature: {
              type: 'string',
              description: 'Solana transaction signature for x402 payment (optional on first call, required after receiving PAYMENT_REQUIRED error)'
            }
          },
          required: ['market', 'amount', 'side']
        }
      },
      {
        name: 'analyzeMarket',
        description: 'Analyze a betting market. Requires payment: $0.05 USDC.',
        inputSchema: {
          type: 'object',
          properties: {
            market: {
              type: 'string',
              description: 'The market identifier'
            },
            timeframe: {
              type: 'string',
              description: 'Analysis timeframe (1h, 24h, 7d)'
            },
            x402_payment_signature: {
              type: 'string',
              description: 'Solana transaction signature for x402 payment (optional on first call)'
            }
          },
          required: ['market', 'timeframe']
        }
      },
      {
        name: 'getOdds',
        description: 'Get current odds for a market. Requires payment: $0.02 USDC.',
        inputSchema: {
          type: 'object',
          properties: {
            market: {
              type: 'string',
              description: 'The market identifier'
            },
            x402_payment_signature: {
              type: 'string',
              description: 'Solana transaction signature for x402 payment (optional on first call)'
            }
          },
          required: ['market']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    return await toolHandler.handleToolCall(name, args || {});
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'TOOL_EXECUTION_ERROR',
            message: error.message
          })
        }
      ],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Betting Analytics MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
```

## 4. Dynamic Pricing Implementation

### Price Calculator with Validation

```typescript
// src/services/pricing.service.ts
export interface PricingRule {
  base: number;
  percentage?: number;
  percentageOf?: string; // Parameter name to calculate percentage from
  min?: number;
  max?: number;
}

export class PricingService {
  private rules: Map<string, PricingRule> = new Map([
    ['executeBet', {
      base: 0.10,
      percentage: 0.02,
      percentageOf: 'amount',
      min: 0.10,
      max: 100.00
    }],
    ['analyzeMarket', {
      base: 0.05,
      min: 0.05,
      max: 0.05
    }],
    ['getOdds', {
      base: 0.02,
      min: 0.02,
      max: 0.02
    }]
  ]);

  calculatePrice(toolName: string, params: any): number {
    const rule = this.rules.get(toolName);
    if (!rule) {
      throw new Error(`No pricing rule for tool: ${toolName}`);
    }

    let price = rule.base;

    // Add percentage fee if applicable
    if (rule.percentage && rule.percentageOf) {
      const baseValue = params[rule.percentageOf];
      if (typeof baseValue === 'number') {
        price += baseValue * rule.percentage;
      }
    }

    // Apply min/max constraints
    if (rule.min !== undefined) {
      price = Math.max(price, rule.min);
    }
    if (rule.max !== undefined) {
      price = Math.min(price, rule.max);
    }

    // Round to 6 decimals (USDC precision)
    return Math.round(price * 1_000_000) / 1_000_000;
  }

  /**
   * Validate that payment amount matches expected price
   */
  validateAmount(
    toolName: string,
    params: any,
    actualAmount: number,
    tolerance: number = 0.000001 // Allow for rounding errors
  ): boolean {
    const expectedAmount = this.calculatePrice(toolName, params);
    return Math.abs(actualAmount - expectedAmount) <= tolerance;
  }
}
```

## 5. Cache Strategy

### Redis Cache Implementation

```typescript
// src/cache/redis-cache.ts
import { createClient, RedisClientType } from 'redis';

export interface CacheEntry {
  toolName: string;
  amount: number;
  timestamp: number;
  verified: boolean;
  params?: any;
}

export class RedisPaymentCache {
  private client: RedisClientType;
  private prefix: string;
  private ttl: number;

  constructor(config: { redisUrl: string; prefix?: string; ttl?: number }) {
    this.client = createClient({ url: config.redisUrl });
    this.prefix = config.prefix || 'x402:payment:';
    this.ttl = config.ttl || 3600; // 1 hour default

    this.client.on('error', (err) => {
      console.error('Redis cache error:', err);
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }

  async get(signature: string): Promise<CacheEntry | null> {
    try {
      const key = this.prefix + signature;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(signature: string, entry: CacheEntry): Promise<void> {
    try {
      const key = this.prefix + signature;
      await this.client.setEx(key, this.ttl, JSON.stringify(entry));
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  async has(signature: string): Promise<boolean> {
    try {
      const key = this.prefix + signature;
      return (await this.client.exists(key)) === 1;
    } catch (error) {
      console.error('Cache has error:', error);
      return false;
    }
  }

  async delete(signature: string): Promise<void> {
    try {
      const key = this.prefix + signature;
      await this.client.del(key);
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ keys: number; memory: string }> {
    try {
      const keys = await this.client.keys(this.prefix + '*');
      const info = await this.client.info('memory');
      return {
        keys: keys.length,
        memory: info
      };
    } catch (error) {
      console.error('Cache stats error:', error);
      return { keys: 0, memory: 'unknown' };
    }
  }
}
```

### In-Memory Cache (Development)

```typescript
// src/cache/memory-cache.ts
export class MemoryPaymentCache {
  private cache: Map<string, { entry: CacheEntry; expiresAt: number }>;
  private ttl: number;

  constructor(config: { ttl?: number } = {}) {
    this.cache = new Map();
    this.ttl = config.ttl || 3600; // 1 hour default

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  async get(signature: string): Promise<CacheEntry | null> {
    const item = this.cache.get(signature);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(signature);
      return null;
    }

    return item.entry;
  }

  async set(signature: string, entry: CacheEntry): Promise<void> {
    const expiresAt = Date.now() + this.ttl * 1000;
    this.cache.set(signature, { entry, expiresAt });
  }

  async has(signature: string): Promise<boolean> {
    return (await this.get(signature)) !== null;
  }

  async delete(signature: string): Promise<void> {
    this.cache.delete(signature);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  getStats(): { keys: number; memory: string } {
    return {
      keys: this.cache.size,
      memory: `~${this.cache.size * 200} bytes` // Rough estimate
    };
  }
}
```

### Cache Key Structure

```
x402:payment:{signature}
```

Example:
```
x402:payment:5KxR7...9mJp
```

### Multi-Instance Considerations

For multi-instance deployments:
- **Use Redis** (not in-memory) for shared cache
- **Enable Redis Cluster** for high availability
- **Set appropriate TTL** (1 hour recommended)
- **Monitor cache hit rates** to optimize TTL
- **Implement cache warming** for frequently accessed signatures

## 6. Error Handling

### Comprehensive Error Types

```typescript
// src/errors/payment-errors.ts
export enum PaymentErrorCode {
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  INSUFFICIENT_AMOUNT = 'INSUFFICIENT_AMOUNT',
  WRONG_RECIPIENT = 'WRONG_RECIPIENT',
  WRONG_TOKEN = 'WRONG_TOKEN',
  EXPIRED_PAYMENT = 'EXPIRED_PAYMENT',
  REPLAY_ATTACK = 'REPLAY_ATTACK',
  RPC_ERROR = 'RPC_ERROR',
  VERIFICATION_TIMEOUT = 'VERIFIC' +
      'ATION_TIMEOUT'
}

export class PaymentError extends Error {
  constructor(
    public code: PaymentErrorCode,
    public message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'PaymentError';
  }

  toMCPError() {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: this.code,
            message: this.message,
            details: this.details
          }, null, 2)
        }
      ],
      isError: true
    };
  }
}

// Error factory functions
export function createInvalidSignatureError(signature: string): PaymentError {
  return new PaymentError(
    PaymentErrorCode.INVALID_SIGNATURE,
    'Invalid transaction signature format',
    { signature }
  );
}

export function createTransactionNotFoundError(signature: string): PaymentError {
  return new PaymentError(
    PaymentErrorCode.TRANSACTION_NOT_FOUND,
    'Transaction not found on Solana',
    {
      signature,
      possibleReasons: [
        'Transaction not yet confirmed',
        'Invalid signature',
        'Transaction on different network'
      ]
    }
  );
}

export function createInsufficientAmountError(
  expected: number,
  actual: number
): PaymentError {
  return new PaymentError(
    PaymentErrorCode.INSUFFICIENT_AMOUNT,
    `Insufficient payment amount`,
    {
      expected: `${expected} USDC`,
      actual: `${actual} USDC`,
      shortfall: `${expected - actual} USDC`
    }
  );
}

export function createWrongRecipientError(
  expected: string,
  actual: string
): PaymentError {
  return new PaymentError(
    PaymentErrorCode.WRONG_RECIPIENT,
    'Payment sent to wrong recipient',
    { expected, actual }
  );
}

export function createExpiredPaymentError(
  age: number,
  maxAge: number
): PaymentError {
  return new PaymentError(
    PaymentErrorCode.EXPIRED_PAYMENT,
    'Payment transaction is too old',
    {
      age: `${age} seconds`,
      maxAge: `${maxAge} seconds`
    }
  );
}

export function createReplayAttackError(
  signature: string,
  originalTool: string
): PaymentError {
  return new PaymentError(
    PaymentErrorCode.REPLAY_ATTACK,
    'Payment signature already used',
    {
      signature,
      originalTool,
      message: 'Each payment can only be used once'
    }
  );
}

export function createRPCError(error: any): PaymentError {
  return new PaymentError(
    PaymentErrorCode.RPC_ERROR,
    'Failed to communicate with Solana RPC',
    {
      error: error.message,
      suggestion: 'Check RPC endpoint configuration and network connectivity'
    }
  );
}
```

### Error Handling in Verifier

```typescript
// src/services/payment.service.ts (enhanced)
export class PaymentService {
  // ... previous code ...

  async verifyPayment(
    signature: string,
    expectedAmount: number,
    toolName: string
  ): Promise<VerificationResult> {
    // Validate signature format
    if (!this.isValidSignature(signature)) {
      throw createInvalidSignatureError(signature);
    }

    // Check for replay attack
    const cached = await this.paymentCache.get(signature);
    if (cached) {
      if (cached.toolName !== toolName) {
        throw createReplayAttackError(signature, cached.toolName);
      }
      return { valid: true, cached: true };
    }

    try {
      // Verify transaction exists with retry logic
      const txDetails = await this.verifyTransactionWithRetry(signature);

      // Check transaction age
      const age = Date.now() / 1000 - txDetails.blockTime!;
      const maxAge = 300; // 5 minutes
      if (age > maxAge) {
        throw createExpiredPaymentError(age, maxAge);
      }

      // Verify USDC transfer
      const transfer = await this.extractUSDCTransfer(txDetails);

      if (!transfer) {
        throw new PaymentError(
          PaymentErrorCode.WRONG_TOKEN,
          'No USDC transfer found in transaction'
        );
      }

      // Verify amount
      if (transfer.amount < expectedAmount) {
        throw createInsufficientAmountError(expectedAmount, transfer.amount);
      }

      // Verify recipient
      if (transfer.recipient !== this.config.recipientWallet.toBase58()) {
        throw createWrongRecipientError(
          this.config.recipientWallet.toBase58(),
          transfer.recipient
        );
      }

      // Cache successful payment
      await this.paymentCache.set(signature, {
        toolName,
        amount: expectedAmount,
        timestamp: Date.now(),
        verified: true
      });

      return { valid: true, cached: false };

    } catch (error: any) {
      if (error instanceof PaymentError) {
        throw error;
      }

      // Handle RPC errors
      if (error.message?.includes('not found')) {
        throw createTransactionNotFoundError(signature);
      }

      throw createRPCError(error);
    }
  }

  private async verifyTransactionWithRetry(
    signature: string,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const tx = await this.connection.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });

        if (tx) return tx;

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }

    throw createTransactionNotFoundError(signature);
  }

  private isValidSignature(signature: string): boolean {
    // Solana signatures are base58 encoded and ~88 characters
    return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(signature);
  }

  private async extractUSDCTransfer(txDetails: any): Promise<{
    amount: number;
    recipient: string;
  } | null> {
    // Parse transaction to extract USDC transfer details
    // This is a simplified version - actual implementation would parse
    // the transaction instructions

    const meta = txDetails.meta;
    if (!meta) return null;

    // Look for token balance changes
    const preBalances = meta.preTokenBalances || [];
    const postBalances = meta.postTokenBalances || [];

    for (const post of postBalances) {
      if (post.mint !== this.config.usdcMint.toBase58()) continue;

      const pre = preBalances.find(
        (p: any) => p.accountIndex === post.accountIndex
      );

      if (!pre) continue;

      const preAmount = Number(pre.uiTokenAmount.uiAmount);
      const postAmount = Number(post.uiTokenAmount.uiAmount);
      const difference = postAmount - preAmount;

      if (difference > 0) {
        return {
          amount: difference,
          recipient: post.owner
        };
      }
    }

    return null;
  }
}
```

## 7. Production Concerns

### RPC Rate Limiting

```typescript
// src/services/rpc-manager.ts
import { Connection } from '@solana/web3.js';
import Bottleneck from 'bottleneck';

export class RPCManager {
  private connections: Connection[];
  private currentIndex: number = 0;
  private limiter: Bottleneck;

  constructor(endpoints: string[], rateLimitConfig?: any) {
    this.connections = endpoints.map(
      endpoint => new Connection(endpoint, 'confirmed')
    );

    // Rate limiter: 50 requests per second
    this.limiter = new Bottleneck({
      reservoir: 50,
      reservoirRefreshAmount: 50,
      reservoirRefreshInterval: 1000,
      maxConcurrent: 10,
      ...rateLimitConfig
    });
  }

  /**
   * Get next connection (round-robin)
   */
  getConnection(): Connection {
    const conn = this.connections[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.connections.length;
    return conn;
  }

  /**
   * Execute RPC call with rate limiting
   */
  async schedule<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
    return this.limiter.schedule(() => fn(this.getConnection()));
  }
}
```

### Transaction Confirmation Strategy

```typescript
// src/services/confirmation-strategy.ts
import { Connection, TransactionSignature } from '@solana/web3.js';

export class ConfirmationStrategy {
  constructor(private connection: Connection) {}

  /**
   * Wait for transaction confirmation with timeout
   */
  async confirmTransaction(
    signature: TransactionSignature,
    timeout: number = 60000
  ): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const status = await this.connection.getSignatureStatus(signature);

        if (status.value?.confirmationStatus === 'confirmed' ||
            status.value?.confirmationStatus === 'finalized') {
          return true;
        }

        if (status.value?.err) {
          throw new Error(`Transaction failed: ${status.value.err}`);
        }

        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error('Error checking transaction status:', error);
      }
    }

    throw new Error('Transaction confirmation timeout');
  }

  /**
   * Use websocket subscription for faster confirmation
   */
  async confirmTransactionFast(
    signature: TransactionSignature,
    timeout: number = 60000
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Transaction confirmation timeout'));
      }, timeout);

      this.connection.onSignature(
        signature,
        (result) => {
          clearTimeout(timeoutId);
          if (result.err) {
            reject(new Error(`Transaction failed: ${result.err}`));
          } else {
            resolve(true);
          }
        },
        'confirmed'
      );
    });
  }
}
```

### Monitoring and Alerting

```typescript
// src/monitoring/payment-monitor.ts
export interface PaymentMetrics {
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  averageVerificationTime: number;
  cacheHitRate: number;
  rpcErrors: number;
}

export class PaymentMonitor {
  private metrics: PaymentMetrics = {
    totalVerifications: 0,
    successfulVerifications: 0,
    failedVerifications: 0,
    averageVerificationTime: 0,
    cacheHitRate: 0,
    rpcErrors: 0
  };

  private verificationTimes: number[] = [];

  recordVerification(success: boolean, duration: number, fromCache: boolean) {
    this.metrics.totalVerifications++;

    if (success) {
      this.metrics.successfulVerifications++;
    } else {
      this.metrics.failedVerifications++;
    }

    if (fromCache) {
      this.updateCacheHitRate();
    }

    this.verificationTimes.push(duration);
    this.updateAverageTime();

    // Alert on high failure rate
    if (this.getFailureRate() > 0.1) { // 10%
      this.alert('High payment verification failure rate');
    }
  }

  recordRPCError() {
    this.metrics.rpcErrors++;

    // Alert on RPC issues
    if (this.metrics.rpcErrors > 10) {
      this.alert('High number of RPC errors - check endpoint health');
    }
  }

  private updateAverageTime() {
    const sum = this.verificationTimes.reduce((a, b) => a + b, 0);
    this.metrics.averageVerificationTime = sum / this.verificationTimes.length;
  }

  private updateCacheHitRate() {
    // Calculate based on recent verifications
    this.metrics.cacheHitRate =
      this.metrics.successfulVerifications / this.metrics.totalVerifications;
  }

  private getFailureRate(): number {
    if (this.metrics.totalVerifications === 0) return 0;
    return this.metrics.failedVerifications / this.metrics.totalVerifications;
  }

  private alert(message: string) {
    console.error(`[PAYMENT ALERT] ${message}`);

    // In production, integrate with monitoring service:
    // - Send to Datadog, New Relic, etc.
    // - Trigger PagerDuty alert
    // - Send Slack notification
  }

  getMetrics(): PaymentMetrics {
    return { ...this.metrics };
  }

  reset() {
    this.metrics = {
      totalVerifications: 0,
      successfulVerifications: 0,
      failedVerifications: 0,
      averageVerificationTime: 0,
      cacheHitRate: 0,
      rpcErrors: 0
    };
    this.verificationTimes = [];
  }
}
```

### Cost Optimization

```typescript
// src/optimization/cost-optimizer.ts
export class CostOptimizer {
  /**
   * Batch verify multiple payments in a single RPC call
   */
  async batchVerifySignatures(
    connection: Connection,
    signatures: string[]
  ): Promise<Map<string, boolean>> {
    // Use getSignatureStatuses (plural) for batch verification
    const response = await connection.getSignatureStatuses(signatures);

    const results = new Map<string, boolean>();
    response.value.forEach((status, index) => {
      results.set(
        signatures[index],
        status?.confirmationStatus === 'confirmed' ||
        status?.confirmationStatus === 'finalized'
      );
    });

    return results;
  }

  /**
   * Cache transaction details to reduce RPC calls
   */
  async getTransactionCached(
    connection: Connection,
    signature: string,
    cache: any
  ): Promise<any> {
    const cacheKey = `tx:${signature}`;
    const cached = await cache.get(cacheKey);

    if (cached) {
      return JSON.parse(cached);
    }

    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    if (tx) {
      await cache.set(cacheKey, JSON.stringify(tx), 3600); // Cache for 1 hour
    }

    return tx;
  }

  /**
   * Use commitment level based on payment amount
   */
  getOptimalCommitment(amount: number): 'confirmed' | 'finalized' {
    // For large payments, wait for finalized
    return amount > 100 ? 'finalized' : 'confirmed';
  }
}
```

## Summary

This design provides:

1. **Seamless Payment Flow**: AI agents call tools without payment first, receive payment requirements, then retry with signature
2. **Robust Verification**: Uses @x402-solana/core for transaction verification with replay attack prevention
3. **Dynamic Pricing**: Flexible pricing rules with percentage-based fees
4. **Production-Ready Caching**: Redis for multi-instance deployments, in-memory for development
5. **Comprehensive Error Handling**: Specific error codes for all failure scenarios
6. **Production Hardening**: RPC rate limiting, confirmation strategies, monitoring, and cost optimization

The system is designed to be:
- **MCP-native**: Works with stdio JSON-RPC protocol
- **Developer-friendly**: Clear error messages guide agents through payment flow
- **Scalable**: Redis cache enables multi-instance deployment
- **Reliable**: Retry logic, fallback RPC endpoints, and monitoring
- **Cost-effective**: Batch operations and intelligent caching minimize RPC costs