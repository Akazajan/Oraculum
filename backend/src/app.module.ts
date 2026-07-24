import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/guard/jwt.auth.guard';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { NewsletterModule } from './newsletter/newsletter.module';
import { EmailModule } from './email/email.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ContactModule } from './contact/contact.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { InvoicesModule } from './invoices/invoices.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WorkspaceTrackingModule } from './workspace-tracking/workspace-tracking.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    // Throttler tiers — BE-07 acceptance: harder limits on anonymous
    // traffic, generous limits on authenticated traffic. The actual
    // tracker key (user vs IP) is decided by AppThrottlerGuard so the
    // same global config applies to everyone.
    ThrottlerModule.forRoot([
      // Burst protection shared by every caller.
      { name: 'short', ttl: 1_000, limit: 3 },
      { name: 'medium', ttl: 10_000, limit: 20 },

      // Per-minute limits. The "long" tier is shared by everyone.
      { name: 'long', ttl: 60_000, limit: 100 },

      // Authenticated users get a more generous cap (1.5x by default)
      // thanks to env overrides via THROTTLE_AUTH_LIMIT_LONG.
      {
        name: 'long-auth',
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_AUTH_LIMIT_LONG ?? 150),
      },

      // Per-route named throttlers — applied via @Throttle({ name: {...} })
      { name: 'newsletter', ttl: 60_000, limit: 10 },
      { name: 'contact', ttl: 60_000, limit: 5 },
      { name: 'feedback', ttl: 60_000, limit: 10 },

      // Per-IP stricter limits for unauthenticated traffic (default tier).
      {
        name: 'default-anon',
        ttl: 60_000,
        limit: Number(process.env.THROTTLE_ANON_LIMIT_LONG ?? 60),
      },
    ]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const tls = configService.get<string>('REDIS_TLS') === 'true';
        return {
          redis: {
            host: configService.get<string>('REDIS_HOST') || 'localhost',
            port: configService.get<number>('REDIS_PORT') || 6379,
            password: configService.get<string>('REDIS_PASSWORD'),
            db: configService.get<number>('REDIS_DB') || 0,
            ...(tls && { tls: {} }),
          },
        };
      },
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('DATABASE_HOST');
        const sslRequired =
          configService.get<string>('NODE_ENV') === 'production' ||
          configService.get<string>('PGSSLMODE') === 'require' ||
          configService.get<string>('DATABASE_SSL') === 'true' ||
          (host ? host.includes('neon.tech') : false);

        return {
          type: 'postgres',
          database: configService.get('DATABASE_NAME'),
          password: configService.get('DATABASE_PASSWORD'),
          username: configService.get('DATABASE_USERNAME'),
          port: +configService.get('DATABASE_PORT'),
          host,
          autoLoadEntities: true,
          synchronize: true,
          ssl: sslRequired ? { rejectUnauthorized: false } : false,
        };
      },
    }),
    EmailModule,
    AuthModule,
    AuditModule,
    UsersModule,
    NewsletterModule,
    ContactModule,
    DashboardModule,
    WorkspacesModule,
    BookingsModule,
    PaymentsModule,
    InvoicesModule,
    NotificationsModule,
    WorkspaceTrackingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      // AppThrottlerGuard tracks by authenticated user id when
      // available, else by request IP, and emits a standardized 429.
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },
  ],
})
export class AppModule {}
