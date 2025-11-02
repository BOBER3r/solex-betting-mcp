# Client Example: Using the x402 MCP Server

This document shows how AI agents and clients interact with the x402-enabled MCP server.

## AI Agent Flow (Conceptual)

```
1. Agent wants to analyze a market
2. Calls tool without payment
3. Receives payment requirement
4. Creates USDC payment transaction
5. Waits for confirmation
6. Retries tool call with signature
7. Receives analysis result
```

## Example: Claude Desktop Configuration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "betting-analytics": {
      "command": "node",
      "args": ["/path/to/betting-analytics-mcp-server/dist/server.js"],
      "env": {
        "SOLANA_NETWORK": "devnet",
        "RECIPIENT_WALLET_DEVNET": "8x4eB...Abc2",
        "REDIS_URL": ""
      }
    }
  }
}
```

## Manual Testing with MCP Inspector

```bash
# Install MCP Inspector
npm install -g @modelcontextprotocol/inspector

# Run the server in inspector mode
npx @modelcontextprotocol/inspector node dist/server.js
```

Then interact via the web UI at http://localhost:6274

## JavaScript/TypeScript Client Example

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';

/**
 * Example client that automatically handles x402 payments
 */
class X402MCPClient {
  private client: Client;
  private connection: Connection;
  private wallet: Keypair;
  private usdcMint: PublicKey;

  constructor(serverPath: string, walletPrivateKey: string, network: 'devnet' | 'mainnet') {
    // Initialize MCP client
    const transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        SOLANA_NETWORK: network,
        ...process.env
      }
    });

    this.client = new Client({
      name: 'x402-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    this.client.connect(transport);

    // Initialize Solana connection
    const rpcUrl = network === 'devnet'
      ? 'https://api.devnet.solana.com'
      : 'https://api.mainnet-beta.solana.com';

    this.connection = new Connection(rpcUrl, 'confirmed');

    // Load wallet
    this.wallet = Keypair.fromSecretKey(bs58.decode(walletPrivateKey));

    // Set USDC mint
    this.usdcMint = new PublicKey(
      network === 'devnet'
        ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
        : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    );
  }

  /**
   * Call a tool with automatic payment handling
   */
  async callTool(toolName: string, args: any): Promise<any> {
    try {
      // First attempt without payment
      const result = await this.client.request(
        {
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args
          }
        },
        { timeout: 30000 }
      );

      // If successful, return result
      if (!result.isError) {
        return this.parseResult(result);
      }

      // Check if payment is required
      const error = this.parseResult(result);
      if (error.error === 'PAYMENT_REQUIRED') {
        console.log('Payment required:', error.payment);

        // Create payment
        const signature = await this.createPayment(error.payment);
        console.log('Payment sent:', signature);

        // Wait for confirmation
        await this.waitForConfirmation(signature);
        console.log('Payment confirmed');

        // Retry with payment signature
        const retryResult = await this.client.request(
          {
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: {
                ...args,
                x402_payment_signature: signature
              }
            }
          },
          { timeout: 30000 }
        );

        if (retryResult.isError) {
          throw new Error(this.parseResult(retryResult).message);
        }

        return this.parseResult(retryResult);
      }

      // Other error
      throw new Error(error.message || 'Unknown error');

    } catch (error: any) {
      console.error('Tool call failed:', error);
      throw error;
    }
  }

  /**
   * Create a USDC payment transaction
   */
  private async createPayment(paymentReq: {
    amount: number;
    recipient: string;
    usdcMint: string;
  }): Promise<string> {
    const recipient = new PublicKey(paymentReq.recipient);

    // Get token accounts
    const senderTokenAccount = await getAssociatedTokenAddress(
      this.usdcMint,
      this.wallet.publicKey
    );

    const recipientTokenAccount = await getAssociatedTokenAddress(
      this.usdcMint,
      recipient
    );

    // Create transfer instruction
    const amountInSmallestUnit = Math.floor(paymentReq.amount * 1_000_000); // 6 decimals

    const transferIx = createTransferInstruction(
      senderTokenAccount,
      recipientTokenAccount,
      this.wallet.publicKey,
      amountInSmallestUnit,
      [],
      TOKEN_PROGRAM_ID
    );

    // Create and send transaction
    const tx = new Transaction().add(transferIx);
    tx.feePayer = this.wallet.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;

    // Sign and send
    tx.sign(this.wallet);
    const signature = await this.connection.sendRawTransaction(tx.serialize());

    return signature;
  }

  /**
   * Wait for transaction confirmation
   */
  private async waitForConfirmation(signature: string, timeout: number = 60000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const status = await this.connection.getSignatureStatus(signature);

      if (status.value?.confirmationStatus === 'confirmed' ||
          status.value?.confirmationStatus === 'finalized') {
        return;
      }

      if (status.value?.err) {
        throw new Error(`Transaction failed: ${status.value.err}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Transaction confirmation timeout');
  }

  /**
   * Parse MCP result
   */
  private parseResult(result: any): any {
    if (result.content && result.content[0]?.text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch {
        return result.content[0].text;
      }
    }
    return result;
  }

  /**
   * List available tools
   */
  async listTools() {
    const result = await this.client.request({
      method: 'tools/list',
      params: {}
    });

    return result.tools;
  }

  /**
   * Get server health
   */
  async healthCheck() {
    return this.callTool('healthCheck', {});
  }

  /**
   * Close client connection
   */
  async close() {
    await this.client.close();
  }
}

// Usage Example
async function main() {
  const client = new X402MCPClient(
    '/path/to/server/dist/server.js',
    'your-wallet-private-key-base58',
    'devnet'
  );

  try {
    // List available tools
    const tools = await client.listTools();
    console.log('Available tools:', tools);

    // Call a tool (payment will be handled automatically)
    const analysis = await client.callTool('analyzeMarket', {
      market: 'NBA-LAL-vs-GSW',
      timeframe: '24h'
    });

    console.log('Analysis result:', analysis);

    // Call another tool
    const odds = await client.callTool('getOdds', {
      market: 'NBA-LAL-vs-GSW'
    });

    console.log('Odds:', odds);

    // Execute a bet (dynamic pricing: $0.10 + 2% of $100 = $2.10)
    const bet = await client.callTool('executeBet', {
      market: 'NBA-LAL-vs-GSW',
      amount: 100,
      side: 'home'
    });

    console.log('Bet placed:', bet);

    // Health check (no payment required)
    const health = await client.healthCheck();
    console.log('Server health:', health);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

main();
```

## Python Client Example

```python
import asyncio
import json
import base58
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from solana.rpc.async_api import AsyncClient
from spl.token.instructions import transfer, TransferParams
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class X402MCPClient:
    def __init__(self, server_path: str, wallet_private_key: str, network: str = 'devnet'):
        self.server_path = server_path
        self.network = network
        self.wallet = Keypair.from_base58_string(wallet_private_key)

        rpc_url = 'https://api.devnet.solana.com' if network == 'devnet' else 'https://api.mainnet-beta.solana.com'
        self.connection = AsyncClient(rpc_url)

        self.usdc_mint = Pubkey.from_string(
            '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' if network == 'devnet'
            else 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        )

    async def call_tool(self, tool_name: str, args: dict):
        """Call a tool with automatic payment handling"""
        server_params = StdioServerParameters(
            command='node',
            args=[self.server_path],
            env={'SOLANA_NETWORK': self.network}
        )

        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()

                # First attempt without payment
                result = await session.call_tool(tool_name, args)

                # Parse result
                content = json.loads(result.content[0].text)

                # Check if payment required
                if content.get('error') == 'PAYMENT_REQUIRED':
                    print(f"Payment required: {content['payment']}")

                    # Create payment
                    signature = await self.create_payment(content['payment'])
                    print(f"Payment sent: {signature}")

                    # Wait for confirmation
                    await self.wait_for_confirmation(signature)
                    print("Payment confirmed")

                    # Retry with payment
                    args['x402_payment_signature'] = signature
                    result = await session.call_tool(tool_name, args)
                    content = json.loads(result.content[0].text)

                return content

    async def create_payment(self, payment_req: dict) -> str:
        """Create USDC payment transaction"""
        recipient = Pubkey.from_string(payment_req['recipient'])
        amount = int(payment_req['amount'] * 1_000_000)  # 6 decimals

        # Get token accounts
        sender_token_account = get_associated_token_address(
            self.wallet.pubkey(),
            self.usdc_mint
        )
        recipient_token_account = get_associated_token_address(
            recipient,
            self.usdc_mint
        )

        # Create transfer instruction
        transfer_ix = transfer(
            TransferParams(
                program_id=TOKEN_PROGRAM_ID,
                source=sender_token_account,
                dest=recipient_token_account,
                owner=self.wallet.pubkey(),
                amount=amount
            )
        )

        # Create and send transaction
        recent_blockhash = (await self.connection.get_latest_blockhash()).value.blockhash
        tx = Transaction([transfer_ix])
        tx.recent_blockhash = recent_blockhash
        tx.sign(self.wallet)

        result = await self.connection.send_transaction(tx)
        return str(result.value)

    async def wait_for_confirmation(self, signature: str, timeout: int = 60):
        """Wait for transaction confirmation"""
        import time
        start = time.time()

        while time.time() - start < timeout:
            status = await self.connection.get_signature_status(signature)

            if status.value and status.value.confirmation_status in ['confirmed', 'finalized']:
                return

            await asyncio.sleep(2)

        raise TimeoutError("Transaction confirmation timeout")

# Usage
async def main():
    client = X402MCPClient(
        '/path/to/server/dist/server.js',
        'your-wallet-private-key-base58',
        'devnet'
    )

    # Call a tool
    result = await client.call_tool('analyzeMarket', {
        'market': 'NBA-LAL-vs-GSW',
        'timeframe': '24h'
    })

    print('Result:', result)

asyncio.run(main())
```

## Payment Simulation Script

For testing without actual USDC:

```typescript
// test-payment-flow.ts
import { BettingToolHandler } from './src/handlers/betting.handler';

async function testPaymentFlow() {
  const handler = new BettingToolHandler();
  await handler.initialize();

  console.log('=== Test 1: Call without payment ===');
  const result1 = await handler.handleToolCall('analyzeMarket', {
    market: 'TEST-MARKET',
    timeframe: '24h'
  });

  console.log(JSON.stringify(result1, null, 2));

  // In real scenario, client would:
  // 1. Parse payment requirement
  // 2. Create USDC transaction
  // 3. Get signature
  // 4. Retry with signature

  console.log('\n=== Test 2: Call with mock signature (will fail) ===');
  const result2 = await handler.handleToolCall('analyzeMarket', {
    market: 'TEST-MARKET',
    timeframe: '24h',
    x402_payment_signature: 'mock_signature_for_testing'
  });

  console.log(JSON.stringify(result2, null, 2));

  await handler.shutdown();
}

testPaymentFlow();
```

## Summary

The client implementation requires:

1. **MCP Client**: To communicate with the server via stdio
2. **Solana Client**: To create and send USDC payments
3. **Payment Logic**: To handle the two-step flow:
   - Try without payment → Get requirement
   - Create payment → Retry with signature

The key insight is that the payment flow is transparent to the end user (AI agent), which just sees a tool that requires payment and automatically handles it.
