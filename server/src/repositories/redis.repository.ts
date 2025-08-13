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
}
