import { PaymentService } from '../services/payment.service';
import { PaymentError, createPaymentRequiredError } from '../errors/payment-errors';

/**
 * MCP tool handler with payment verification
 */
export class BettingToolHandler {
  private paymentService: PaymentService;

  constructor() {
    this.paymentService = new PaymentService();
  }

  /**
   * Initialize the handler
   */
  async initialize(): Promise<void> {
    await this.paymentService.initialize();
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    await this.paymentService.shutdown();
  }

  /**
   * Handle tool call with payment verification
   */
  async handleToolCall(toolName: string, args: any) {
    try {
      // Extract payment signature from arguments
      const paymentSignature = args.x402_payment_signature;

      // Calculate required payment for this tool call
      const paymentReq = this.paymentService.getPaymentRequirement(toolName, args);

      // If no payment signature provided, return payment required error
      if (!paymentSignature) {
        throw createPaymentRequiredError(toolName, paymentReq);
      }

      // Verify payment
      const verification = await this.paymentService.verifyPayment(
        paymentSignature,
        paymentReq.amount,
        toolName,
        args
      );

      // Payment verified successfully - execute tool logic
      const result = await this.executeTool(toolName, args);

      // Add payment info to result
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              payment: {
                verified: true,
                cached: verification.cached,
                amount: paymentReq.amount,
                signature: paymentSignature
              },
              result
            }, null, 2)
          }
        ]
      };

    } catch (error: any) {
      // Handle payment errors
      if (error instanceof PaymentError) {
        return error.toMCPError();
      }

      // Handle general errors
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'TOOL_EXECUTION_ERROR',
              message: error.message,
              details: error.stack
            }, null, 2)
          }
        ],
        isError: true
      };
    }
  }

  /**
   * Execute the actual tool logic (after payment verification)
   */
  private async executeTool(toolName: string, args: any): Promise<any> {
    switch (toolName) {
      case 'executeBet':
        return this.executeBet(args);

      case 'analyzeMarket':
        return this.analyzeMarket(args);

      case 'getOdds':
        return this.getOdds(args);

      case 'healthCheck':
        return this.healthCheck();

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Execute a bet
   */
  private async executeBet(args: any) {
    // Validate arguments
    const { market, amount, side } = args;

    if (!market || !amount || !side) {
      throw new Error('Missing required parameters: market, amount, side');
    }

    if (amount <= 0) {
      throw new Error('Bet amount must be positive');
    }

    if (!['home', 'away', 'draw'].includes(side)) {
      throw new Error('Invalid side. Must be one of: home, away, draw');
    }

    // Simulate bet execution
    // In production, this would integrate with actual betting platform
    const betId = `bet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Fetch current odds (simulated)
    const odds = this.getMarketOdds(market);

    // Calculate potential payout
    const potentialPayout = amount * odds[side];

    return {
      betId,
      market,
      amount,
      side,
      odds: odds[side],
      potentialPayout,
      status: 'pending',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Analyze a market
   */
  private async analyzeMarket(args: any) {
    const { market, timeframe } = args;

    if (!market || !timeframe) {
      throw new Error('Missing required parameters: market, timeframe');
    }

    if (!['1h', '24h', '7d'].includes(timeframe)) {
      throw new Error('Invalid timeframe. Must be one of: 1h, 24h, 7d');
    }

    // Simulate market analysis
    // In production, this would fetch real data and run analytics
    const analysis = {
      market,
      timeframe,
      timestamp: new Date().toISOString(),
      trends: {
        home: this.generateTrend(),
        away: this.generateTrend(),
        draw: this.generateTrend()
      },
      statistics: {
        volume: Math.floor(Math.random() * 1000000),
        volatility: Math.random() * 0.5,
        momentum: (Math.random() - 0.5) * 2
      },
      recommendations: {
        confidence: Math.random(),
        suggestion: ['home', 'away', 'draw'][Math.floor(Math.random() * 3)]
      },
      priceMovement: {
        home: (Math.random() - 0.5) * 0.2,
        away: (Math.random() - 0.5) * 0.2,
        draw: (Math.random() - 0.5) * 0.2
      }
    };

    return analysis;
  }

  /**
   * Get current odds for a market
   */
  private async getOdds(args: any) {
    const { market } = args;

    if (!market) {
      throw new Error('Missing required parameter: market');
    }

    // Simulate fetching odds
    const odds = this.getMarketOdds(market);

    return {
      market,
      timestamp: new Date().toISOString(),
      odds,
      spread: {
        home: Math.random() * 2 - 1,
        away: Math.random() * 2 - 1
      },
      totalVolume: Math.floor(Math.random() * 1000000),
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Health check endpoint (no payment required)
   */
  private async healthCheck() {
    const health = await this.paymentService.healthCheck();
    const metrics = this.paymentService.getMetrics();

    return {
      status: health.healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      rpc: health.details,
      payment: {
        metrics,
        cache: health.details.cache
      }
    };
  }

  /**
   * Helper: Generate simulated market odds
   */
  private getMarketOdds(market: string): { home: number; away: number; draw: number } {
    // Generate realistic odds that sum to slightly over 100% (bookmaker margin)
    const base = Math.random() * 0.5 + 1.5; // Base odds between 1.5 and 2.0
    return {
      home: Number((base + Math.random() * 0.5).toFixed(2)),
      away: Number((base + Math.random() * 0.5).toFixed(2)),
      draw: Number((base + Math.random() * 1.0 + 1.0).toFixed(2))
    };
  }

  /**
   * Helper: Generate simulated trend data
   */
  private generateTrend(): { direction: string; strength: number; confidence: number } {
    const directions = ['bullish', 'bearish', 'neutral'];
    return {
      direction: directions[Math.floor(Math.random() * directions.length)],
      strength: Math.random(),
      confidence: Math.random()
    };
  }
}
