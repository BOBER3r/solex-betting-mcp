#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { BettingToolHandler } from './handlers/betting.handler.js';

/**
 * Betting Analytics MCP Server with x402 Solana micropayments
 */

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

// Initialize handler
await toolHandler.initialize();

// Define available tools with payment information
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'executeBet',
        description: `Execute a bet on a market.

PAYMENT REQUIRED: $0.10 base fee + 2% of bet amount in USDC.

On first call without payment, you will receive payment instructions.
Then call again with x402_payment_signature parameter.`,
        inputSchema: {
          type: 'object',
          properties: {
            market: {
              type: 'string',
              description: 'The market identifier (e.g., "NBA-LAL-vs-GSW", "EPL-MUN-vs-CHE")'
            },
            amount: {
              type: 'number',
              description: 'Bet amount in USD (must be positive)'
            },
            side: {
              type: 'string',
              enum: ['home', 'away', 'draw'],
              description: 'Which side to bet on'
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
        description: `Analyze a betting market with advanced analytics.

PAYMENT REQUIRED: $0.05 USDC.

Returns trends, statistics, recommendations, and price movements.
On first call without payment, you will receive payment instructions.`,
        inputSchema: {
          type: 'object',
          properties: {
            market: {
              type: 'string',
              description: 'The market identifier'
            },
            timeframe: {
              type: 'string',
              enum: ['1h', '24h', '7d'],
              description: 'Analysis timeframe'
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
        description: `Get current odds for a betting market.

PAYMENT REQUIRED: $0.02 USDC.

Returns current odds, spreads, volume, and last update time.`,
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
      },
      {
        name: 'healthCheck',
        description: `Check server health status and payment system metrics.

NO PAYMENT REQUIRED - this is a free diagnostic tool.`,
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Health check doesn't require payment
    if (name === 'healthCheck') {
      const result = await toolHandler['healthCheck']();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    // All other tools go through payment verification
    return await toolHandler.handleToolCall(name, args || {});

  } catch (error: any) {
    console.error('Tool execution error:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'INTERNAL_SERVER_ERROR',
            message: error.message,
            stack: error.stack
          }, null, 2)
        }
      ],
      isError: true
    };
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.error('Shutting down...');
  await toolHandler.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Shutting down...');
  await toolHandler.shutdown();
  process.exit(0);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Betting Analytics MCP Server running on stdio');
  console.error('Network:', process.env.SOLANA_NETWORK || 'devnet');
  console.error('Cache:', process.env.REDIS_URL ? 'Redis' : 'In-memory');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
