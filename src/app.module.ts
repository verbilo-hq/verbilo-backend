import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { AuditLogInterceptor } from './common/audit-log.interceptor';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { TenantContextMiddleware } from './common/tenant-context.middleware';
import { TenantsModule } from './tenants/tenants.module';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    AuditModule,
    UsersModule,
    TenantsModule,
    StaffModule,
    HealthModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware, TenantContextMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
