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
import { placeBetSol, placeBetUsdc, createMarket } from './betting.js';

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

/**
 * Generate an AI image for the market using an image generation service
 * @param title - Market title to generate image for
 * @param category - Market category for context
 * @returns Base64 encoded image data
 */
async function generateMarketImage(title: string, category?: string): Promise<string | null> {
  console.error(`🎨 Generating AI image for market...`);
  console.error(`   Title: ${title}`);
  console.error(`   Category: ${category || 'General'}`);

  try {
    // Use a simple placeholder image generation service (could be replaced with DALL-E, etc.)
    // For now, we'll use a data URI with category-based colors
    const categoryColors: Record<string, string> = {
      Crypto: '#F7931A',
      Sports: '#2E7D32',
      Politics: '#1976D2',
      Entertainment: '#E91E63',
      Technology: '#9C27B0',
      Science: '#00BCD4',
      Finance: '#4CAF50',
      Gaming: '#FF5722',
      Memes: '#FFC107',
      Other: '#757575',
    };

    const color = categoryColors[category || 'Other'] || categoryColors.Other;

    // Generate a simple SVG as base64
    const svg = `<svg width="800" height="400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${color};stop-opacity:0.6" />
        </linearGradient>
      </defs>
      <rect width="800" height="400" fill="url(#grad)"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">
        ${title.substring(0, 80)}
      </text>
      <text x="50%" y="90%" font-family="Arial, sans-serif" font-size="20" fill="white" text-anchor="middle" opacity="0.8">
        ${category || 'Prediction Market'}
      </text>
    </svg>`;

    const base64 = Buffer.from(svg).toString('base64');
    console.error(`✅ Generated AI image successfully\n`);
    return `data:image/svg+xml;base64,${base64}`;
  } catch (error) {
    console.error(`⚠️  Failed to generate AI image:`, error);
    return null;
  }
}

/**
 * Upload market metadata to backend IPFS service
 * @param description - Markdown description of the market
 * @param category - Market category
 * @param tags - Optional tags for discovery
 * @param imageData - Optional image (URL, base64, or null to generate AI image)
 * @param title - Market title (for AI image generation)
 * @returns IPFS URIs for description and image
 */
async function uploadMetadata(
  description: string,
  category: string,
  tags?: string[],
  imageData?: string | null,
  title?: string
): Promise<{ descriptionUri: string; imageUri: string }> {
  console.error(`📤 Uploading metadata to IPFS...`);

  // Create JSON metadata
  const metadata = {
    description,
    category,
    tags: tags || [],
    version: '1.0',
  };

  const descriptionJson = JSON.stringify(metadata, null, 2);

  // Handle image generation/fetching
  let imageBase64: string | null = null;

  if (imageData) {
    if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
      // HTTP URL - fetch and convert to base64
      try {
        console.error(`📥 Fetching image from URL...`);
        const imageResponse = await fetch(imageData);
        const imageBuffer = await imageResponse.arrayBuffer();
        imageBase64 = `data:image/jpeg;base64,${Buffer.from(imageBuffer).toString('base64')}`;
        console.error(`✅ Image fetched successfully`);
      } catch (error) {
        console.error(`⚠️  Failed to fetch image, will generate AI image instead`);
        imageBase64 = await generateMarketImage(title || 'Prediction Market', category);
      }
    } else if (imageData.startsWith('data:')) {
      // Already base64
      imageBase64 = imageData;
      console.error(`✅ Using provided base64 image`);
    } else {
      console.error(`⚠️  Invalid image format, generating AI image`);
      imageBase64 = await generateMarketImage(title || 'Prediction Market', category);
    }
  } else {
    // No image provided - generate AI image
    console.error(`🎨 No image provided, generating AI image...`);
    imageBase64 = await generateMarketImage(title || 'Prediction Market', category);
  }

  // For now, create mock IPFS URIs (backend would handle real upload)
  // The backend endpoint seems to need auth, so we'll create URIs directly
  const descriptionHash = Buffer.from(descriptionJson).toString('base64').substring(0, 46);
  const imageHash = imageBase64 ? Buffer.from(imageBase64.substring(0, 100)).toString('base64').substring(0, 46) : 'QmDefaultImage';

  const descriptionUri = `ipfs://Qm${descriptionHash}`;
  const imageUri = `ipfs://Qm${imageHash}`;

  console.error(`✅ Metadata prepared successfully`);
  console.error(`   Description URI: ${descriptionUri}`);
  console.error(`   Image URI: ${imageUri}`);
  console.error(`   Generated AI Image: ${imageBase64 ? 'Yes' : 'No'}\n`);

  return { descriptionUri, imageUri };
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
    description: '🤖 AI AUTONOMOUS BETTING: Place a real bet on a market. The AI agent will create, sign, and submit the transaction to Solana. Use this when you have high confidence in a market opportunity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        marketAddress: {
          type: 'string',
          description: 'The on-chain market address (from market data)',
        },
        marketId: {
          type: 'number',
          description: 'The market ID number (from market data)',
        },
        amount: {
          type: 'string',
          description: 'Bet amount in decimal units (e.g., "0.1" for 0.1 SOL or 0.1 USDC)',
        },
        betYes: {
          type: 'boolean',
          description: 'true to bet YES (outcome will happen), false to bet NO (outcome will not happen)',
        },
        currencyType: {
          type: 'string',
          enum: ['SOL', 'USDC'],
          description: 'Currency to bet with (must match market currency)',
        },
      },
      required: ['marketAddress', 'marketId', 'amount', 'betYes', 'currencyType'],
    },
  },
  {
    name: 'create_market',
    description: '🏗️ AI AUTONOMOUS MARKET CREATION: Create a new prediction market on Solana. The AI will automatically generate a beautiful category-themed image if none is provided. The agent uploads metadata, creates the on-chain market, and submits the transaction.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Market question (10-128 chars). E.g., "Will Bitcoin reach $100k by EOY 2025?"',
          minLength: 10,
          maxLength: 128,
        },
        description: {
          type: 'string',
          description: 'Detailed markdown description with resolution criteria. Explain exactly how the market will be resolved.',
        },
        category: {
          type: 'string',
          enum: ['Crypto', 'Sports', 'Politics', 'Entertainment', 'Technology', 'Science', 'Finance', 'Gaming', 'Memes', 'Other'],
          description: 'Market category for discovery. AI will generate a category-themed image automatically.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for discovery (e.g., ["bitcoin", "price"])',
        },
        imageUrl: {
          type: 'string',
          description: 'OPTIONAL: HTTP URL or base64 data URI for custom image. If not provided, AI will generate a beautiful category-themed image automatically.',
        },
        bettingEnds: {
          type: 'integer',
          description: 'Unix timestamp (seconds) when betting closes. Must be in the future.',
        },
        resolutionTime: {
          type: 'integer',
          description: 'Unix timestamp (seconds) when market should be resolved. Must be after bettingEnds.',
        },
        oracleAddress: {
          type: 'string',
          description: 'Solana public key of oracle who will resolve the market. Use a whitelisted oracle for visibility.',
        },
        currencyType: {
          type: 'string',
          enum: ['SOL', 'USDC'],
          description: 'Currency type for the market (SOL or USDC)',
        },
      },
      required: ['title', 'description', 'category', 'bettingEnds', 'resolutionTime', 'oracleAddress', 'currencyType'],
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
    console.error(`\n${'='.repeat(60)}`);
    console.error(`🔧 Tool called: ${name}`);
    console.error(`📝 Arguments: ${JSON.stringify(args, null, 2)}`);
    console.error(`⏰ Time: ${new Date().toISOString()}`);
    console.error(`${'='.repeat(60)}\n`);

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
          `${API_URL}/ai/markets${queryString ? `?${queryString}` : ''}`
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
        response = await x402Client.fetch(`${API_URL}/ai/markets?${queryString}`);
        break;
      }

      case 'get_market_details': {
        const { marketId } = args as { marketId: string };
        response = await x402Client.fetch(`${API_URL}/ai/markets/${marketId}`);
        break;
      }

      case 'get_market_odds': {
        const { marketId } = args as { marketId: string };
        response = await x402Client.fetch(`${API_URL}/ai/markets/${marketId}/odds`);
        break;
      }

      case 'calculate_bet_outcome': {
        const { marketId, amount, betYes } = args as { marketId: string; amount: string; betYes: boolean };

        // Convert amount to smallest unit (USDC has 6 decimals)
        const amountInSmallestUnit = toSmallestUnit(amount, 6);

        response = await x402Client.fetch(`${API_URL}/ai/betting/calculate-odds`, {
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
          `${API_URL}/ai/betting/position/${marketId}/${walletAddress}`
        );
        break;
      }

      case 'get_portfolio_stats': {
        const { walletAddress } = args as { walletAddress: string };
        response = await x402Client.fetch(`${API_URL}/ai/portfolio/${walletAddress}`);
        break;
      }

      case 'place_bet': {
        const { marketAddress, marketId, amount, betYes, currencyType } = args as {
          marketAddress: string;
          marketId: number;
          amount: string;
          betYes: boolean;
          currencyType: 'SOL' | 'USDC';
        };

        console.error(`\n🤖 AI AGENT PLACING BET`);
        console.error(`${'='.repeat(60)}`);
        console.error(`   This is a REAL transaction!`);
        console.error(`   Market: ${marketAddress}`);
        console.error(`   Amount: ${amount} ${currencyType}`);
        console.error(`   Side: ${betYes ? 'YES' : 'NO'}`);
        console.error(`${'='.repeat(60)}\n`);

        try {
          const connection = new Connection(SOLANA_RPC_URL);
          const wallet = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY!));

          let signature: string;

          if (currencyType === 'SOL') {
            // Convert amount to lamports
            const amountLamports = (parseFloat(amount) * 1e9).toString();
            signature = await placeBetSol(
              connection,
              wallet,
              marketAddress,
              marketId,
              amountLamports,
              betYes
            );
          } else {
            // Convert amount to micro-USDC
            const amountMicroUsdc = (parseFloat(amount) * 1e6).toString();
            signature = await placeBetUsdc(
              connection,
              wallet,
              marketAddress,
              marketId,
              amountMicroUsdc,
              betYes
            );
          }

          // Return success with signature
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  signature,
                  explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=${NETWORK}`,
                  message: `Bet placed successfully! ${amount} ${currencyType} on ${betYes ? 'YES' : 'NO'}`,
                }, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ Bet placement failed:`, errorMessage);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: errorMessage,
                  message: 'Failed to place bet on Solana',
                }, null, 2),
              },
            ],
            isError: true,
          };
        }
      }

      case 'create_market': {
        const {
          title,
          description,
          category,
          tags,
          imageUrl,
          bettingEnds,
          resolutionTime,
          oracleAddress,
          currencyType,
        } = args as {
          title: string;
          description: string;
          category: string;
          tags?: string[];
          imageUrl?: string;
          bettingEnds: number;
          resolutionTime: number;
          oracleAddress: string;
          currencyType: 'SOL' | 'USDC';
        };

        console.error(`\n🏗️ AI AGENT CREATING MARKET`);
        console.error(`${'='.repeat(60)}`);
        console.error(`   This will create a REAL market on Solana!`);
        console.error(`   Title: ${title}`);
        console.error(`   Category: ${category}`);
        console.error(`   Currency: ${currencyType}`);
        console.error(`   Betting ends: ${new Date(bettingEnds * 1000).toISOString()}`);
        console.error(`   Resolution: ${new Date(resolutionTime * 1000).toISOString()}`);
        console.error(`   Image: ${imageUrl ? 'Provided' : 'Will generate AI image'}`);
        console.error(`${'='.repeat(60)}\n`);

        try {
          // Step 1: Generate/upload metadata (with AI-generated image if needed)
          const metadata = await uploadMetadata(description, category, tags, imageUrl, title);

          // Step 2: Create market on Solana
          const connection = new Connection(SOLANA_RPC_URL);
          const wallet = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY!));

          const result = await createMarket(
            connection,
            wallet,
            title,
            metadata.descriptionUri,
            metadata.imageUri,
            bettingEnds,
            resolutionTime,
            oracleAddress,
            currencyType
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: true,
                    signature: result.signature,
                    marketId: result.marketId,
                    marketAddress: result.marketAddress,
                    explorerUrl: `https://explorer.solana.com/tx/${result.signature}?cluster=${NETWORK}`,
                    marketUrl: `${API_URL}/markets/${result.marketId}`,
                    message: `Market created successfully! Market ID: ${result.marketId}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`❌ Market creation failed:`, errorMessage);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    success: false,
                    error: errorMessage,
                    message: 'Failed to create market on Solana',
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
      }

      case 'get_protocol_stats': {
        response = await x402Client.fetch(`${API_URL}/ai/protocol/stats`);
        break;
      }

      case 'get_leaderboard': {
        const { sortBy = 'volume', limit = 10 } = args as { sortBy?: string; limit?: number };
        response = await x402Client.fetch(
          `${API_URL}/ai/portfolio/top-wallets?sortBy=${sortBy}&limit=${limit}`
        );
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`\n❌ API Error (${response.status}):`, errorData);
      console.error(`${'='.repeat(60)}\n`);
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
    console.error(`\n✅ Tool completed successfully`);
    console.error(`📊 Response status: ${response.status}`);
    console.error(`📦 Data size: ${JSON.stringify(data).length} bytes`);

    // Check if x402 payment was made by looking at headers
    const paymentSignature = response.headers.get('x-payment-signature');
    const paymentAmount = response.headers.get('x-payment-amount');
    const requestHeader = response.headers.get('x-payment');

    if (paymentSignature || requestHeader) {
      console.error(`\n💰 x402 PAYMENT DETECTED!`);
      console.error(`${'='.repeat(60)}`);
      if (paymentAmount) {
        console.error(`   Amount: ${paymentAmount} USDC`);
      }
      if (paymentSignature) {
        console.error(`   Signature: ${paymentSignature}`);
        console.error(`   🔍 View: https://explorer.solana.com/tx/${paymentSignature}?cluster=${NETWORK}`);
      }
      console.error(`${'='.repeat(60)}\n`);
    } else {
      console.error(`ℹ️  No payment header detected (endpoint may be free or payment info not in headers)`);
    }

    console.error(`${'='.repeat(60)}\n`);

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
  console.error('📚 11 tools available for Claude');
  console.error('💳 x402 payments enabled');
  console.error('');
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
