import { PublicKey } from '@solana/web3.js';

export interface NetworkConfig {
  rpcEndpoint: string;
  usdcMint: PublicKey;
  recipientWallet: PublicKey;
  confirmationStrategy: 'finalized' | 'confirmed';
  rpcEndpoints: string[]; // Multiple endpoints for failover
}

export const NETWORKS: Record<'devnet' | 'mainnet', Omit<NetworkConfig, 'recipientWallet'>> = {
  devnet: {
    rpcEndpoint: process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com',
    rpcEndpoints: [
      process.env.SOLANA_RPC_DEVNET || 'https://api.devnet.solana.com',
      'https://devnet.helius-rpc.com/?api-key=' + (process.env.HELIUS_API_KEY || ''),
    ].filter(url => !url.endsWith('=')), // Remove endpoints with missing API keys
    usdcMint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), // Devnet USDC
    confirmationStrategy: 'confirmed'
  },
  mainnet: {
    rpcEndpoint: process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com',
    rpcEndpoints: [
      process.env.SOLANA_RPC_MAINNET || 'https://api.mainnet-beta.solana.com',
      'https://mainnet.helius-rpc.com/?api-key=' + (process.env.HELIUS_API_KEY || ''),
      'https://rpc.ankr.com/solana',
    ].filter(url => !url.endsWith('=')),
    usdcMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // Mainnet USDC
    confirmationStrategy: 'finalized'
  }
};

export const getNetworkConfig = (): NetworkConfig => {
  const network = (process.env.SOLANA_NETWORK || 'devnet') as 'devnet' | 'mainnet';
  const baseConfig = NETWORKS[network];

  const recipientWalletKey = network === 'devnet'
    ? process.env.RECIPIENT_WALLET_DEVNET
    : process.env.RECIPIENT_WALLET_MAINNET;

  if (!recipientWalletKey) {
    throw new Error(
      `Missing recipient wallet configuration for ${network}. ` +
      `Set RECIPIENT_WALLET_${network.toUpperCase()} environment variable.`
    );
  }

  return {
    ...baseConfig,
    recipientWallet: new PublicKey(recipientWalletKey)
  };
};

export const getPaymentConfig = () => ({
  // Cache configuration
  cache: {
    type: process.env.REDIS_URL ? 'redis' : 'memory',
    redisUrl: process.env.REDIS_URL,
    ttl: parseInt(process.env.PAYMENT_CACHE_TTL || '3600'), // 1 hour
    prefix: 'x402:payment:'
  },

  // Verification settings
  verification: {
    maxTransactionAge: parseInt(process.env.MAX_TRANSACTION_AGE || '300'), // 5 minutes
    retryAttempts: parseInt(process.env.VERIFICATION_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.VERIFICATION_RETRY_DELAY || '1000'), // 1 second
    timeout: parseInt(process.env.VERIFICATION_TIMEOUT || '60000'), // 1 minute
  },

  // RPC rate limiting
  rateLimit: {
    maxConcurrent: parseInt(process.env.RPC_MAX_CONCURRENT || '10'),
    reservoir: parseInt(process.env.RPC_RATE_LIMIT || '50'),
    reservoirRefreshInterval: 1000, // 1 second
  },

  // Monitoring
  monitoring: {
    enabled: process.env.MONITORING_ENABLED === 'true',
    alertThreshold: parseFloat(process.env.ALERT_FAILURE_THRESHOLD || '0.1'), // 10%
  }
});
