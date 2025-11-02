import { Connection, ConnectionConfig } from '@solana/web3.js';
import Bottleneck from 'bottleneck';

/**
 * RPC Manager with rate limiting and failover support
 */
export class RPCManager {
  private connections: Connection[];
  private currentIndex: number = 0;
  private limiter: Bottleneck;
  private healthStatus: Map<string, boolean>;

  constructor(
    endpoints: string[],
    rateLimitConfig?: {
      maxConcurrent?: number;
      reservoir?: number;
      reservoirRefreshInterval?: number;
    }
  ) {
    if (endpoints.length === 0) {
      throw new Error('At least one RPC endpoint is required');
    }

    const connectionConfig: ConnectionConfig = {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
      disableRetryOnRateLimit: false
    };

    this.connections = endpoints.map(
      endpoint => new Connection(endpoint, connectionConfig)
    );

    // Initialize health status
    this.healthStatus = new Map();
    endpoints.forEach(endpoint => {
      this.healthStatus.set(endpoint, true);
    });

    // Configure rate limiter
    // Default: 50 requests per second with max 10 concurrent
    this.limiter = new Bottleneck({
      maxConcurrent: rateLimitConfig?.maxConcurrent || 10,
      reservoir: rateLimitConfig?.reservoir || 50,
      reservoirRefreshAmount: rateLimitConfig?.reservoir || 50,
      reservoirRefreshInterval: rateLimitConfig?.reservoirRefreshInterval || 1000,
      minTime: 20 // Minimum 20ms between requests
    });

    // Start health check interval
    this.startHealthCheck();
  }

  /**
   * Get next available connection (round-robin with health checks)
   */
  getConnection(): Connection {
    const startIndex = this.currentIndex;
    let attempts = 0;

    while (attempts < this.connections.length) {
      const connection = this.connections[this.currentIndex];
      const endpoint = this.getEndpoint(connection);

      // Move to next connection for next call
      this.currentIndex = (this.currentIndex + 1) % this.connections.length;

      // Return if healthy or if all connections are unhealthy (fallback)
      if (this.healthStatus.get(endpoint) || attempts === this.connections.length - 1) {
        return connection;
      }

      attempts++;
    }

    // Fallback to first connection if all are unhealthy
    return this.connections[0];
  }

  /**
   * Execute RPC call with rate limiting
   */
  async schedule<T>(fn: (connection: Connection) => Promise<T>): Promise<T> {
    return this.limiter.schedule(async () => {
      const connection = this.getConnection();
      try {
        const result = await fn(connection);
        this.markHealthy(connection);
        return result;
      } catch (error: any) {
        // Mark unhealthy on specific errors
        if (
          error.message?.includes('429') ||
          error.message?.includes('rate limit') ||
          error.message?.includes('timeout')
        ) {
          this.markUnhealthy(connection);
        }
        throw error;
      }
    });
  }

  /**
   * Execute with automatic retry on different endpoints
   */
  async scheduleWithRetry<T>(
    fn: (connection: Connection) => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: any;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.schedule(fn);
      } catch (error) {
        lastError = error;
        // Wait before retry with exponential backoff
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
      }
    }

    throw lastError;
  }

  /**
   * Get all connections
   */
  getAllConnections(): Connection[] {
    return [...this.connections];
  }

  /**
   * Get health status of all endpoints
   */
  getHealthStatus(): Map<string, boolean> {
    return new Map(this.healthStatus);
  }

  /**
   * Mark endpoint as healthy
   */
  private markHealthy(connection: Connection): void {
    const endpoint = this.getEndpoint(connection);
    this.healthStatus.set(endpoint, true);
  }

  /**
   * Mark endpoint as unhealthy
   */
  private markUnhealthy(connection: Connection): void {
    const endpoint = this.getEndpoint(connection);
    this.healthStatus.set(endpoint, false);
    console.warn(`RPC endpoint marked unhealthy: ${endpoint}`);
  }

  /**
   * Get endpoint URL from connection
   */
  private getEndpoint(connection: Connection): string {
    return (connection as any)._rpcEndpoint || 'unknown';
  }

  /**
   * Periodic health check for all endpoints
   */
  private startHealthCheck(): void {
    setInterval(async () => {
      for (const connection of this.connections) {
        try {
          await connection.getSlot();
          this.markHealthy(connection);
        } catch (error) {
          this.markUnhealthy(connection);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get limiter statistics
   */
  getStats() {
    return {
      running: this.limiter.running(),
      queued: this.limiter.queued(),
      done: (this.limiter as any).done || 0
    };
  }
}
