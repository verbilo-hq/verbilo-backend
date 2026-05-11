import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { TenantContextMiddleware } from './common/tenant-context.middleware';
import { TenantsModule } from './tenants/tenants.module';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    AuditModule,
    UsersModule,
    TenantsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.ALL,
    });
  }
}
