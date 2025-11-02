#!/usr/bin/env node

/**
 * Sol Bets MCP Server
 *
 * Provides AI agents access to prediction markets with x402 micropayments on Solana.
 *
 * Features:
 * - 10 tools for market discovery, analysis, and betting
 * - Automatic USDC payments via x402 protocol
 * - Secure wallet management
 * - Error handling and logging
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { X402Client } from '@x402-solana/client';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const API_URL = process.env.API_URL || 'https://staging-api.solex.bet';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const NETWORK = process.env.NETWORK || 'devnet';
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

if (!WALLET_PRIVATE_KEY) {
  console.error('❌ ERROR: WALLET_PRIVATE_KEY environment variable not set');
  console.error('Please set WALLET_PRIVATE_KEY in .env file');
  console.error('See .env.example for template');
  process.exit(1);
}

// ============================================================================
// Initialize x402 Client
// ============================================================================

const x402Client = new X402Client({
  solanaRpcUrl: SOLANA_RPC_URL,
  walletPrivateKey: WALLET_PRIVATE_KEY,
  network: NETWORK as 'devnet' | 'mainnet-beta',
  debug: true, // Enable detailed payment logging (fixed in v0.1.1)
});

// Log initialization
const keypairForDisplay = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY!));
const walletAddress = keypairForDisplay.publicKey.toString();

console.error('🚀 Sol Bets MCP Server');
console.error(`📡 Network: ${NETWORK}`);
console.error(`🔗 RPC: ${SOLANA_RPC_URL}`);
console.error(`🌐 API: ${API_URL}`);
console.error(`💳 Agent Wallet: ${walletAddress}`);
console.error(`🔍 View transactions: https://explorer.solana.com/address/${walletAddress}?cluster=${NETWORK}`);

// ============================================================================
// Constants
// ============================================================================

/**
 * Available market categories (hardcoded from backend)
 */
const ALL_CATEGORIES = [
  'Sports',
  'Crypto',
  'Politics',
  'Entertainment',
  'Science',
  'Technology',
  'Finance',
  'Memes',
  'Gaming',
] as const;

type CategoryName = typeof ALL_CATEGORIES[number];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert decimal amount to smallest unit
 * @param amount - Decimal amount (e.g., 1.5)
 * @param decimals - Number of decimals (9 for SOL, 6 for USDC)
 * @returns Integer in smallest unit as string
 */
function toSmallestUnit(amount: string | number, decimals: number = 6): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  const multiplier = Math.pow(10, decimals);
  return Math.floor(numAmount * multiplier).toString();
}

// ============================================================================
// Wallet Balance Monitor
// ============================================================================

async function checkWalletBalance() {
  try {
    const connection = new Connection(SOLANA_RPC_URL);
    const keypair = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY!));
    const balance = await connection.getBalance(keypair.publicKey);
    const balanceSOL = balance / LAMPORTS_PER_SOL;

    console.error(`💰 Wallet: ${keypair.publicKey.toString()}`);
    console.error(`💵 Balance: ${balanceSOL.toFixed(4)} SOL`);

    if (balance < 0.1 * LAMPORTS_PER_SOL) {
      console.error('⚠️  WARNING: Wallet balance is low! Please fund your wallet.');
    }
  } catch (error) {
    console.error('⚠️  Could not check wallet balance:', error);
  }
}

// Check balance on startup
await checkWalletBalance();

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  {
    name: 'sol-bets-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS = [
  {
    name: 'search_markets',
    description: 'Search for betting markets by keyword, category, or status. Returns paginated results with market details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: {
          type: 'string',
          description: 'Search query (e.g., "bitcoin", "election")',
        },
        category: {
          type: 'string',
          enum: ['Sports', 'Crypto', 'Politics', 'Entertainment', 'Science', 'Technology', 'Finance', 'Memes', 'Gaming'],
          description: 'Market category filter',
        },
        status: {
          type: 'string',
          enum: ['active', 'resolved'],
          description: 'Market status filter',
        },
        onlyWhitelisted: {
          type: 'boolean',
          description: 'Only show official markets with whitelisted oracles',
        },
        limit: {
          type: 'number',
          description: 'Results per page (1-100)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_trending_markets',
    description: 'Get the top trending markets by volume. Great for discovering hot opportunities with high activity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Number of markets to return (1-100)',
          default: 20,
        },
        currency: {
          type: 'string',
          enum: ['SOL', 'USDC'],
          description: 'Filter by currency type (optional)',
        },
        category: {
          type: 'string',
          enum: ['Sports', 'Crypto', 'Politics', 'Entertainment', 'Science', 'Technology', 'Finance', 'Memes', 'Gaming'],
          description: 'Filter by category (optional)',
        },
      },
    },
  },
  {
    name: 'get_market_details',
    description: 'Get detailed information about a specific market including title, description, creator, current odds, and volume.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketId: {
          type: 'string',
          description: 'The market ID to fetch details for',
        },
      },
      required: ['marketId'],
    },
  },
  {
    name: 'get_market_odds',
    description: 'Get current yes/no odds for a market. Essential for bet analysis and determining fair value.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketId: {
          type: 'string',
          description: 'The market ID',
        },
      },
      required: ['marketId'],
    },
  },
  {
    name: 'calculate_bet_outcome',
    description: 'Simulate a bet to see expected shares, price impact, and fees before placing. Critical for bet optimization.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketId: {
          type: 'string',
          description: 'The market ID',
        },
        amount: {
          type: 'string',
          description: 'Bet amount in SOL or USDC (e.g., "1.5")',
        },
        betYes: {
          type: 'boolean',
          description: 'true for YES bet, false for NO bet',
        },
      },
      required: ['marketId', 'amount', 'betYes'],
    },
  },
  {
    name: 'get_user_position',
    description: "Check user's position in a specific market including shares held, average price, current value, and P&L.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketId: {
          type: 'string',
          description: 'The market ID',
        },
        walletAddress: {
          type: 'string',
          description: 'User wallet address',
        },
      },
      required: ['marketId', 'walletAddress'],
    },
  },
  {
    name: 'get_portfolio_stats',
    description: 'Get comprehensive portfolio statistics for a wallet including total positions, P&L, win rate, and active markets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        walletAddress: {
          type: 'string',
          description: 'User wallet address',
        },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'place_bet',
    description: 'Place a bet on a market. This executes the actual blockchain transaction. Requires wallet signature.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketId: {
          type: 'string',
          description: 'The market ID',
        },
        amount: {
          type: 'string',
          description: 'Bet amount in SOL or USDC',
        },
        betYes: {
          type: 'boolean',
          description: 'true for YES bet, false for NO bet',
        },
        betterAddress: {
          type: 'string',
          description: 'The wallet placing the bet',
        },
        mint: {
          type: 'string',
          description: 'Token mint address (SOL or USDC mint)',
        },
      },
      required: ['marketId', 'amount', 'betYes', 'betterAddress', 'mint'],
    },
  },
  {
    name: 'get_protocol_stats',
    description: 'Get platform-wide statistics including total volume, fees collected, number of markets, and TVL.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_leaderboard',
    description: 'Get top performing wallets sorted by volume, P&L, win rate, or fees earned. Shows the best traders.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sortBy: {
          type: 'string',
          enum: ['volume', 'pnl', 'winRate', 'fees'],
          description: 'Metric to sort by',
        },
        limit: {
          type: 'number',
          description: 'Number of wallets to return (1-100)',
          default: 10,
        },
      },
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    console.error(`🔧 Tool called: ${name}`);
    console.error(`📝 Arguments: ${JSON.stringify(args, null, 2)}`);

    let response;

    switch (name) {
      case 'search_markets': {
        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(args as Record<string, any>)) {
          if (value !== undefined && value !== null) {
            params[key] = String(value);
          }
        }
        const queryString = new URLSearchParams(params).toString();

        response = await x402Client.fetch(
          `${API_URL}/api/markets${queryString ? `?${queryString}` : ''}`
        );
        break;
      }

      case 'get_trending_markets': {
        const { limit = 20, currency, category } = args as {
          limit?: number;
          currency?: string;
          category?: string;
        };

        // Build query parameters for volume-sorted markets
        const params: Record<string, string> = {
          status: 'active',
          sortBy: 'volume',
          limit: String(limit),
        };

        if (currency) params.currency = currency;
        if (category) params.category = category;

        const queryString = new URLSearchParams(params).toString();
        response = await x402Client.fetch(`${API_URL}/api/markets?${queryString}`);
        break;
      }

      case 'get_market_details': {
        const { marketId } = args as { marketId: string };
        response = await x402Client.fetch(`${API_URL}/api/markets/${marketId}`);
        break;
      }

      case 'get_market_odds': {
        const { marketId } = args as { marketId: string };
        response = await x402Client.fetch(`${API_URL}/api/markets/${marketId}/odds`);
        break;
      }

      case 'calculate_bet_outcome': {
        const { marketId, amount, betYes } = args as { marketId: string; amount: string; betYes: boolean };

        // Convert amount to smallest unit (USDC has 6 decimals)
        const amountInSmallestUnit = toSmallestUnit(amount, 6);

        response = await x402Client.fetch(`${API_URL}/api/betting/calculate-odds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketId,
            amount: amountInSmallestUnit,
            betYes,
          }),
        });
        break;
      }

      case 'get_user_position': {
        const { marketId, walletAddress } = args as { marketId: string; walletAddress: string };
        response = await x402Client.fetch(
          `${API_URL}/api/betting/position/${marketId}/${walletAddress}`
        );
        break;
      }

      case 'get_portfolio_stats': {
        const { walletAddress } = args as { walletAddress: string };
        response = await x402Client.fetch(`${API_URL}/api/portfolio/${walletAddress}`);
        break;
      }

      case 'place_bet': {
        const { marketId, amount, betYes, betterAddress, mint } = args as {
          marketId: string;
          amount: string;
          betYes: boolean;
          betterAddress: string;
          mint: string;
        };

        // Convert amount to smallest unit (USDC has 6 decimals, SOL has 9)
        // Determine decimals based on mint (simplified - adjust if needed)
        const decimals = mint.toLowerCase().includes('usdc') ? 6 : 9;
        const amountInSmallestUnit = toSmallestUnit(amount, decimals);

        response = await x402Client.fetch(`${API_URL}/api/betting/place-bet`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketId,
            amount: amountInSmallestUnit,
            betYes,
            betterAddress,
            mint,
          }),
        });
        break;
      }

      case 'get_protocol_stats': {
        response = await x402Client.fetch(`${API_URL}/api/protocol/stats`);
        break;
      }

      case 'get_leaderboard': {
        const { sortBy = 'volume', limit = 10 } = args as { sortBy?: string; limit?: number };
        response = await x402Client.fetch(
          `${API_URL}/api/portfolio/top-wallets?sortBy=${sortBy}&limit=${limit}`
        );
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`❌ API Error (${response.status}):`, errorData);
      return {
        content: [
          {
            type: 'text',
            text: `API Error (${response.status}): ${JSON.stringify(errorData, null, 2)}`,
          },
        ],
        isError: true,
      };
    }

    const data = await response.json();
    console.error(`✅ Tool completed successfully`);

    // Log payment info if x402 payment was made
    if (response.headers.get('x-payment-signature')) {
      const txSignature = response.headers.get('x-payment-signature');
      const paymentAmount = response.headers.get('x-payment-amount');
      console.error(`💰 x402 Payment Made:`);
      console.error(`   Amount: ${paymentAmount || 'unknown'} USDC`);
      console.error(`   Signature: ${txSignature}`);
      console.error(`   🔍 View: https://explorer.solana.com/tx/${txSignature}?cluster=${NETWORK}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error executing tool ${name}:`, errorMessage);

    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// ============================================================================
// Start Server
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✅ Sol Bets MCP Server running on stdio');
  console.error('📚 10 tools available for Claude');
  console.error('💳 x402 payments enabled');
  console.error('');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
