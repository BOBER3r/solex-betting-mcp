import { Connection, PublicKey, TransactionSignature } from '@solana/web3.js';
import { getNetworkConfig, getPaymentConfig, NetworkConfig } from '../config/payment.config';
import { PaymentCache } from '../cache/payment-cache';
import {
  PaymentError,
  PaymentErrorCode,
  createInvalidSignatureError,
  createTransactionNotFoundError,
  createInsufficientAmountError,
  createWrongRecipientError,
  createExpiredPaymentError,
  createReplayAttackError,
  createRPCError
} from '../errors/payment-errors';
import { RPCManager } from './rpc-manager';
import { PaymentMonitor } from '../monitoring/payment-monitor';

export interface VerificationResult {
  valid: boolean;
  cached?: boolean;
  transactionDetails?: {
    signature: string;
    amount: number;
    sender: string;
    timestamp: number;
  };
}

export interface PaymentRequirement {
  amount: number;
  recipient: string;
  usdcMint: string;
  network: string;
  description: string;
}

export class PaymentService {
  private rpcManager: RPCManager;
  private paymentCache: PaymentCache;
  private networkConfig: NetworkConfig;
  private paymentConfig: ReturnType<typeof getPaymentConfig>;
  private monitor: PaymentMonitor;

  constructor() {
    this.networkConfig = getNetworkConfig();
    this.paymentConfig = getPaymentConfig();

    // Initialize RPC manager with multiple endpoints
    this.rpcManager = new RPCManager(
      this.networkConfig.rpcEndpoints,
      this.paymentConfig.rateLimit
    );

    // Initialize cache
    this.paymentCache = new PaymentCache(this.paymentConfig.cache);

    // Initialize monitoring
    this.monitor = new PaymentMonitor();
  }

  /**
   * Initialize the payment service (async setup)
   */
  async initialize(): Promise<void> {
    await this.paymentCache.connect();
    console.log('Payment service initialized');
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    await this.paymentCache.disconnect();
    console.log('Payment service shut down');
  }

  /**
   * Verify a payment transaction
   */
  async verifyPayment(
    signature: string,
    expectedAmount: number,
    toolName: string,
    params?: any
  ): Promise<VerificationResult> {
    const startTime = Date.now();

    try {
      // Validate signature format
      if (!this.isValidSignature(signature)) {
        throw createInvalidSignatureError(signature);
      }

      // Check for replay attack (signature already used)
      const cached = await this.paymentCache.get(signature);
      if (cached) {
        if (cached.toolName !== toolName) {
          throw createReplayAttackError(signature, cached.toolName);
        }

        this.monitor.recordVerification(true, Date.now() - startTime, true);
        return { valid: true, cached: true };
      }

      // Verify transaction on-chain
      const txDetails = await this.verifyTransactionWithRetry(signature);

      // Check transaction age
      const blockTime = txDetails.blockTime;
      if (!blockTime) {
        throw new PaymentError(
          PaymentErrorCode.TRANSACTION_NOT_FOUND,
          'Transaction does not have a block time'
        );
      }

      const age = Date.now() / 1000 - blockTime;
      const maxAge = this.paymentConfig.verification.maxTransactionAge;
      if (age > maxAge) {
        throw createExpiredPaymentError(age, maxAge);
      }

      // Extract and verify USDC transfer
      const transfer = await this.extractUSDCTransfer(txDetails);

      if (!transfer) {
        throw new PaymentError(
          PaymentErrorCode.WRONG_TOKEN,
          'No USDC transfer found in transaction',
          {
            expectedMint: this.networkConfig.usdcMint.toBase58(),
            hint: 'Ensure you are sending USDC tokens to the correct recipient'
          }
        );
      }

      // Verify amount (with small tolerance for floating point precision)
      const tolerance = 0.000001; // 1 micro-USDC
      if (transfer.amount < expectedAmount - tolerance) {
        throw createInsufficientAmountError(expectedAmount, transfer.amount);
      }

      // Verify recipient
      if (transfer.recipient !== this.networkConfig.recipientWallet.toBase58()) {
        throw createWrongRecipientError(
          this.networkConfig.recipientWallet.toBase58(),
          transfer.recipient
        );
      }

      // Cache successful payment
      await this.paymentCache.set(signature, {
        toolName,
        amount: transfer.amount,
        timestamp: Date.now(),
        verified: true,
        params
      });

      this.monitor.recordVerification(true, Date.now() - startTime, false);

      return {
        valid: true,
        cached: false,
        transactionDetails: {
          signature,
          amount: transfer.amount,
          sender: transfer.sender,
          timestamp: blockTime
        }
      };

    } catch (error: any) {
      this.monitor.recordVerification(false, Date.now() - startTime, false);

      if (error instanceof PaymentError) {
        throw error;
      }

      // Handle RPC errors
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        throw createTransactionNotFoundError(signature);
      }

      if (error.message?.includes('timeout') || error.message?.includes('timed out')) {
        throw new PaymentError(
          PaymentErrorCode.VERIFICATION_TIMEOUT,
          'Transaction verification timed out',
          { signature, timeout: this.paymentConfig.verification.timeout }
        );
      }

      this.monitor.recordRPCError();
      throw createRPCError(error);
    }
  }

  /**
   * Get payment requirement for a tool call
   */
  getPaymentRequirement(toolName: string, params: any): PaymentRequirement {
    const amount = this.calculatePrice(toolName, params);
    return {
      amount,
      recipient: this.networkConfig.recipientWallet.toBase58(),
      usdcMint: this.networkConfig.usdcMint.toBase58(),
      network: process.env.SOLANA_NETWORK || 'devnet',
      description: `Payment for ${toolName}`
    };
  }

  /**
   * Calculate price for a tool call (dynamic pricing)
   */
  calculatePrice(toolName: string, params: any): number {
    switch (toolName) {
      case 'executeBet': {
        const betAmount = params.amount || 0;
        const baseFee = 0.10; // $0.10 base
        const percentageFee = betAmount * 0.02; // 2% of bet
        return this.roundToMicroUSDC(baseFee + percentageFee);
      }

      case 'analyzeMarket':
        return 0.05; // $0.05 fixed

      case 'getOdds':
        return 0.02; // $0.02 fixed

      default:
        return 0.01; // Default $0.01
    }
  }

  /**
   * Health check for RPC connection
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    try {
      const connection = this.rpcManager.getConnection();
      const slot = await connection.getSlot();
      const cacheStats = await this.paymentCache.getStats();
      const metrics = this.monitor.getMetrics();

      return {
        healthy: slot > 0,
        details: {
          currentSlot: slot,
          network: process.env.SOLANA_NETWORK || 'devnet',
          cache: cacheStats,
          metrics
        }
      };
    } catch (error: any) {
      return {
        healthy: false,
        details: {
          error: error.message
        }
      };
    }
  }

  /**
   * Get payment metrics
   */
  getMetrics() {
    return this.monitor.getMetrics();
  }

  // Private helper methods

  private async verifyTransactionWithRetry(
    signature: string
  ): Promise<any> {
    const maxRetries = this.paymentConfig.verification.retryAttempts;
    const retryDelay = this.paymentConfig.verification.retryDelay;
    let lastError: any;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const tx = await this.rpcManager.schedule((connection) =>
          connection.getTransaction(signature, {
            commitment: this.networkConfig.confirmationStrategy,
            maxSupportedTransactionVersion: 0
          })
        );

        if (tx) {
          return tx;
        }

        // Transaction not found yet, wait before retry
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)));
        }
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)));
        }
      }
    }

    throw createTransactionNotFoundError(signature);
  }

  private async extractUSDCTransfer(txDetails: any): Promise<{
    amount: number;
    recipient: string;
    sender: string;
  } | null> {
    const meta = txDetails.meta;
    if (!meta) return null;

    const preBalances = meta.preTokenBalances || [];
    const postBalances = meta.postTokenBalances || [];
    const usdcMintStr = this.networkConfig.usdcMint.toBase58();

    // Find USDC balance changes
    for (const post of postBalances) {
      if (post.mint !== usdcMintStr) continue;

      const pre = preBalances.find(
        (p: any) => p.accountIndex === post.accountIndex
      );

      const preAmount = pre ? Number(pre.uiTokenAmount.uiAmount) : 0;
      const postAmount = Number(post.uiTokenAmount.uiAmount);
      const difference = postAmount - preAmount;

      // If this account received USDC
      if (difference > 0) {
        // Find the sender (account that lost USDC)
        let sender = 'unknown';
        for (const preBalance of preBalances) {
          if (preBalance.mint !== usdcMintStr) continue;

          const postBalance = postBalances.find(
            (p: any) => p.accountIndex === preBalance.accountIndex
          );

          if (!postBalance) continue;

          const preSenderAmount = Number(preBalance.uiTokenAmount.uiAmount);
          const postSenderAmount = Number(postBalance.uiTokenAmount.uiAmount);
          const senderDiff = postSenderAmount - preSenderAmount;

          if (senderDiff < 0) {
            sender = preBalance.owner;
            break;
          }
        }

        return {
          amount: difference,
          recipient: post.owner,
          sender
        };
      }
    }

    return null;
  }

  private isValidSignature(signature: string): boolean {
    // Solana signatures are base58 encoded and 87-88 characters
    return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(signature);
  }

  private roundToMicroUSDC(amount: number): number {
    // USDC has 6 decimals, round to micro-USDC precision
    return Math.round(amount * 1_000_000) / 1_000_000;
  }
}
