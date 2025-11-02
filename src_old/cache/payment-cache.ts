import { createClient, RedisClientType } from 'redis';

export interface CacheEntry {
  toolName: string;
  amount: number;
  timestamp: number;
  verified: boolean;
  params?: any;
}

export interface CacheConfig {
  type: 'redis' | 'memory';
  redisUrl?: string;
  ttl?: number;
  prefix?: string;
}

export interface CacheStats {
  keys: number;
  hits?: number;
  misses?: number;
  memory?: string;
}

/**
 * Payment cache abstraction supporting both Redis and in-memory storage
 */
export class PaymentCache {
  private backend: RedisCache | MemoryCache;

  constructor(config: CacheConfig) {
    if (config.type === 'redis' && config.redisUrl) {
      this.backend = new RedisCache(config);
    } else {
      this.backend = new MemoryCache(config);
    }
  }

  async connect(): Promise<void> {
    await this.backend.connect();
  }

  async disconnect(): Promise<void> {
    await this.backend.disconnect();
  }

  async get(signature: string): Promise<CacheEntry | null> {
    return this.backend.get(signature);
  }

  async set(signature: string, entry: CacheEntry): Promise<void> {
    return this.backend.set(signature, entry);
  }

  async has(signature: string): Promise<boolean> {
    return this.backend.has(signature);
  }

  async delete(signature: string): Promise<void> {
    return this.backend.delete(signature);
  }

  async getStats(): Promise<CacheStats> {
    return this.backend.getStats();
  }

  async clear(): Promise<void> {
    return this.backend.clear();
  }
}

/**
 * Redis-backed cache for production use
 */
class RedisCache {
  private client: RedisClientType;
  private prefix: string;
  private ttl: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(config: CacheConfig) {
    this.client = createClient({
      url: config.redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Redis: Max reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.prefix = config.prefix || 'x402:payment:';
    this.ttl = config.ttl || 3600;

    this.client.on('error', (err) => {
      console.error('Redis cache error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis cache connected');
    });

    this.client.on('reconnecting', () => {
      console.log('Redis cache reconnecting...');
    });
  }

  async connect(): Promise<void> {
    if (!this.client.isOpen) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  async get(signature: string): Promise<CacheEntry | null> {
    try {
      const key = this.prefix + signature;
      const data = await this.client.get(key);

      if (data) {
        this.hits++;
        return JSON.parse(data);
      }

      this.misses++;
      return null;
    } catch (error) {
      console.error('Redis get error:', error);
      this.misses++;
      return null;
    }
  }

  async set(signature: string, entry: CacheEntry): Promise<void> {
    try {
      const key = this.prefix + signature;
      await this.client.setEx(key, this.ttl, JSON.stringify(entry));
    } catch (error) {
      console.error('Redis set error:', error);
    }
  }

  async has(signature: string): Promise<boolean> {
    try {
      const key = this.prefix + signature;
      return (await this.client.exists(key)) === 1;
    } catch (error) {
      console.error('Redis has error:', error);
      return false;
    }
  }

  async delete(signature: string): Promise<void> {
    try {
      const key = this.prefix + signature;
      await this.client.del(key);
    } catch (error) {
      console.error('Redis delete error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      const keys = await this.client.keys(this.prefix + '*');
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      console.error('Redis clear error:', error);
    }
  }

  async getStats(): Promise<CacheStats> {
    try {
      const keys = await this.client.keys(this.prefix + '*');
      const info = await this.client.info('memory');
      const memoryUsed = info.match(/used_memory_human:(.+)/)?.[1] || 'unknown';

      return {
        keys: keys.length,
        hits: this.hits,
        misses: this.misses,
        memory: memoryUsed
      };
    } catch (error) {
      console.error('Redis stats error:', error);
      return {
        keys: 0,
        hits: this.hits,
        misses: this.misses,
        memory: 'unknown'
      };
    }
  }
}

/**
 * In-memory cache for development and testing
 */
class MemoryCache {
  private cache: Map<string, { entry: CacheEntry; expiresAt: number }>;
  private ttl: number;
  private hits: number = 0;
  private misses: number = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: CacheConfig) {
    this.cache = new Map();
    this.ttl = config.ttl || 3600;

    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async connect(): Promise<void> {
    console.log('Memory cache initialized');
  }

  async disconnect(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    console.log('Memory cache disconnected');
  }

  async get(signature: string): Promise<CacheEntry | null> {
    const item = this.cache.get(signature);
    if (!item) {
      this.misses++;
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.cache.delete(signature);
      this.misses++;
      return null;
    }

    this.hits++;
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

  async clear(): Promise<void> {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now > value.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  async getStats(): Promise<CacheStats> {
    // Rough estimate of memory usage
    const avgEntrySize = 200; // bytes
    const estimatedMemory = this.cache.size * avgEntrySize;

    return {
      keys: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      memory: `~${(estimatedMemory / 1024).toFixed(2)} KB`
    };
  }
}