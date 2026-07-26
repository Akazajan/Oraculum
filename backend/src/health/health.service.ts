import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  latencyMs: number;
  details?: Record<string, unknown>;
  error?: string;
}

interface OverallHealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: {
    database: HealthCheckResult;
    redis: HealthCheckResult;
    payments: HealthCheckResult;
    storage: HealthCheckResult;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @InjectRepository('User')
    private readonly userRepo: Repository<any>,
    private readonly configService: ConfigService,
  ) {}

  async check(): Promise<OverallHealthResponse> {
    const [database, redis, payments, storage] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkPayments(),
      this.checkStorage(),
    ]);

    const getVal = (r: PromiseSettledResult<HealthCheckResult>) =>
      r.status === 'fulfilled' ? r.value : { status: 'unhealthy' as const, latencyMs: 0, error: (r.reason as Error)?.message };

    const dbResult = getVal(database);
    const redisResult = getVal(redis);
    const payResult = getVal(payments);
    const storResult = getVal(storage);

    const allHealthy = [dbResult, redisResult, payResult, storResult].every(
      (r) => r.status === 'healthy',
    );

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        database: dbResult,
        redis: redisResult,
        payments: payResult,
        storage: storResult,
      },
    };
  }

  async checkDatabase(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.userRepo.query('SELECT 1');
      return { status: 'healthy', latencyMs: Date.now() - start };
    } catch (err) {
      this.logger.error('Database health check failed', (err as Error).stack);
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  async checkRedis(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // Try to import ioredis and ping
      const IORedis = (await import('ioredis')).default;
      const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
      const port = this.configService.get<number>('REDIS_PORT') || 6379;
      const password = this.configService.get<string>('REDIS_PASSWORD');
      const client = new IORedis({ host, port, password, maxRetriesPerRequest: 1, connectTimeout: 3000 });
      const result = await client.ping();
      await client.quit();
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        details: { response: result },
      };
    } catch (err) {
      this.logger.error('Redis health check failed', (err as Error).stack);
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  async checkPayments(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
      if (!secretKey) {
        return {
          status: 'unhealthy',
          latencyMs: Date.now() - start,
          error: 'PAYSTACK_SECRET_KEY not configured',
        };
      }
      // Use Paystack balance endpoint as a lightweight connectivity check
      const { data } = await axios.get('https://api.paystack.co/balance', {
        headers: { Authorization: `Bearer ${secretKey}` },
        timeout: 5000,
      });
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        details: { message: data.message },
      };
    } catch (err) {
      this.logger.error('Paystack health check failed', (err as Error).stack);
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  async checkStorage(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // Ping Cloudinary by fetching account details
      const result = await cloudinary.api.ping();
      return {
        status: 'healthy',
        latencyMs: Date.now() - start,
        details: { status: result.status },
      };
    } catch (err) {
      this.logger.error('Cloudinary health check failed', (err as Error).stack);
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }
}
