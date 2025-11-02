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
  VERIFICATION_TIMEOUT = 'VERIFICATION_TIMEOUT'
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

  /**
   * Convert to MCP error format
   */
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

  /**
   * Get user-friendly error message with action items
   */
  getUserMessage(): string {
    switch (this.code) {
      case PaymentErrorCode.PAYMENT_REQUIRED:
        return this.message;

      case PaymentErrorCode.INVALID_SIGNATURE:
        return `Invalid transaction signature format. Please ensure you're providing a valid Solana transaction signature.`;

      case PaymentErrorCode.TRANSACTION_NOT_FOUND:
        return `Transaction not found on Solana. Possible reasons:
- Transaction is not yet confirmed (wait a few seconds and try again)
- Invalid signature
- Transaction is on a different network (check devnet vs mainnet)`;

      case PaymentErrorCode.INSUFFICIENT_AMOUNT:
        return `Insufficient payment amount. Expected: ${this.details?.expected}, Received: ${this.details?.actual}`;

      case PaymentErrorCode.WRONG_RECIPIENT:
        return `Payment sent to wrong recipient. Expected: ${this.details?.expected}, Actual: ${this.details?.actual}`;

      case PaymentErrorCode.WRONG_TOKEN:
        return `Payment must be made in USDC. Expected mint: ${this.details?.expectedMint}`;

      case PaymentErrorCode.EXPIRED_PAYMENT:
        return `Payment transaction is too old. Maximum age: ${this.details?.maxAge}, Actual age: ${this.details?.age}`;

      case PaymentErrorCode.REPLAY_ATTACK:
        return `This payment signature has already been used for ${this.details?.originalTool}. Each payment can only be used once.`;

      case PaymentErrorCode.RPC_ERROR:
        return `Failed to verify payment due to RPC connection issues. Please try again.`;

      case PaymentErrorCode.VERIFICATION_TIMEOUT:
        return `Payment verification timed out. The transaction may still be pending confirmation.`;

      default:
        return this.message;
    }
  }
}

// Factory functions for creating specific errors

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
        'Transaction not yet confirmed (wait a few seconds)',
        'Invalid signature',
        'Transaction on different network (check devnet vs mainnet)',
        'Transaction failed or dropped'
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
    'Insufficient payment amount',
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
      age: `${Math.round(age)} seconds`,
      maxAge: `${maxAge} seconds`,
      hint: 'Create a new payment transaction'
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
      message: 'Each payment can only be used once. Please create a new payment.'
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

export function createPaymentRequiredError(
  toolName: string,
  paymentReq: {
    amount: number;
    recipient: string;
    usdcMint: string;
    network: string;
    description: string;
  }
): PaymentError {
  return new PaymentError(
    PaymentErrorCode.PAYMENT_REQUIRED,
    `Payment of ${paymentReq.amount} USDC required for ${toolName}`,
    {
      payment: paymentReq,
      instructions: [
        '1. Create a USDC transfer transaction to the recipient wallet',
        `2. Amount: ${paymentReq.amount} USDC`,
        `3. Recipient: ${paymentReq.recipient}`,
        `4. Network: ${paymentReq.network}`,
        '5. Sign and send the transaction to Solana',
        '6. Wait for confirmation (usually 2-5 seconds)',
        '7. Call this tool again with x402_payment_signature parameter set to the transaction signature'
      ],
      example: {
        x402_payment_signature: '5KxR7...9mJp'
      }
    }
  );
}
