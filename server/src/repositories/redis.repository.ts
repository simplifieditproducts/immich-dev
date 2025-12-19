import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigRepository } from 'src/repositories/config.repository';

@Injectable()
export class RedisRepository implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;

  onModuleInit() {
    const { redis } = new ConfigRepository().getEnv();
    this.client = new Redis(redis);
  }

  onModuleDestroy() {
    this.client.quit();
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
    let result = '';
    if (ttlSeconds) {
      result = await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      result = await this.client.set(key, value);
    }
    return result === 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  /**
   * Try to acquire a distributed lock with a timeout
   * @param key Lock key
   * @param ttlSeconds Time to live in seconds (lock will auto-expire)
   * @param maxWaitSeconds Maximum time to wait for lock acquisition (0 = no wait)
   * @returns true if lock acquired, false if not
   */
  async tryAcquireLock(key: string, ttlSeconds: number, maxWaitSeconds: number = 0): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    while (true) {
      // Try to set the lock key with NX (only if not exists) and EX (expiration)
      const result = await this.client.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
      if (result === 'OK') {
        return true;
      }

      // If no wait time specified, return immediately
      if (maxWaitSeconds === 0) {
        return false;
      }

      // Check if we've exceeded max wait time
      const elapsed = Date.now() - startTime;
      if (elapsed >= maxWaitMs) {
        return false;
      }

      // Wait a bit before retrying (100ms)
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Release a distributed lock
   * @param key Lock key
   */
  async releaseLock(key: string): Promise<void> {
    const lockKey = `lock:${key}`;
    await this.client.del(lockKey);
  }
}
