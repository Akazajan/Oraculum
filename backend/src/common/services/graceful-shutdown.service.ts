import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Server as HttpServerType } from 'http';
import { Server as HttpsServerType } from 'https';

@Injectable()
export class GracefulShutdownService implements OnModuleDestroy {
  private readonly logger = new Logger(GracefulShutdownService.name);
  private shutdownInProgress = false;
  private readonly forceShutdownTimeoutMs: number;
  private httpServer: HttpServerType | HttpsServerType | null = null;

  constructor(private readonly moduleRef: ModuleRef) {
    this.forceShutdownTimeoutMs = Number(
      process.env.SHUTDOWN_TIMEOUT_MS ?? 30_000,
    );
  }

  setHttpServer(server: HttpServerType | HttpsServerType): void {
    this.httpServer = server;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.shutdownInProgress) return;
    this.shutdownInProgress = true;

    this.logger.log('Graceful shutdown initiated');

    const forceExitTimer = setTimeout(() => {
      this.logger.error(
        `Forced shutdown after ${this.forceShutdownTimeoutMs}ms`,
      );
      process.exit(1);
    }, this.forceShutdownTimeoutMs);

    forceExitTimer.unref();

    try {
      await this.drainHttpServer();
      this.logger.log('HTTP server drained');
    } catch (err) {
      this.logger.error('Error draining HTTP server', (err as Error).stack);
    }

    try {
      await this.closeTypeOrmConnections();
      this.logger.log('TypeORM connections closed');
    } catch (err) {
      this.logger.error('Error closing TypeORM connections', (err as Error).stack);
    }

    try {
      await this.closeRedisConnections();
      this.logger.log('Redis connections closed');
    } catch (err) {
      this.logger.error('Error closing Redis connections', (err as Error).stack);
    }

    try {
      await this.closeWebSocketServers();
      this.logger.log('WebSocket servers closed');
    } catch (err) {
      this.logger.error('Error closing WebSocket servers', (err as Error).stack);
    }

    clearTimeout(forceExitTimer);
    this.logger.log('Graceful shutdown completed');
  }

  private drainHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.httpServer) {
        resolve();
        return;
      }
      this.httpServer.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  private async closeTypeOrmConnections(): Promise<void> {
    try {
      const { DataSource } = await import('typeorm');
      const connections = DataSource.connections;
      for (const connection of connections) {
        if (connection.isInitialized) {
          await connection.destroy();
          this.logger.log(`TypeORM connection "${connection.name}" destroyed`);
        }
      }
    } catch {
      // typeorm may not be available or have no connections
    }
  }

  private async closeRedisConnections(): Promise<void> {
    try {
      const ioredis = await import('ioredis');
      const clients = (ioredis as any).default?.instances ?? [];
      for (const client of clients) {
        if (client?.disconnect) {
          await client.disconnect();
          this.logger.log('Redis client disconnected');
        }
      }
    } catch {
      // ioredis not available or no connections
    }
  }

  private async closeWebSocketServers(): Promise<void> {
    try {
      const gatewayRegistry = (this.moduleRef as any).container?.modules;
      if (!gatewayRegistry) return;
      for (const [, mod] of gatewayRegistry) {
        const providers = mod?.providers;
        if (!providers) continue;
        for (const [, wrapper] of providers) {
          const instance = wrapper?.instance;
          if (instance?.server?.close) {
            await new Promise<void>((resolve, reject) => {
              instance.server.close((err: Error | undefined) => {
                if (err) return reject(err);
                resolve();
              });
            });
            this.logger.log('WebSocket server closed');
          }
        }
      }
    } catch {
      // WebSocket gateway not available
    }
  }

  registerSignalHandlers(): void {
    const handler = async (signal: string) => {
      if (this.shutdownInProgress) return;
      this.logger.log(`Received ${signal} - starting graceful shutdown`);
      await this.onModuleDestroy();
      process.exit(0);
    };
    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGINT', () => handler('SIGINT'));
  }
}
