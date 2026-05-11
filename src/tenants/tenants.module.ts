import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { VercelModule } from '../integrations/vercel/vercel.module';
import { RolesGuard } from '../common/roles.guard';
import { AdminTenantsController } from './admin-tenants.controller';
import { PublicTenantsController } from './public-tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AuditModule, VercelModule],
  controllers: [AdminTenantsController, PublicTenantsController],
  providers: [TenantsService, RolesGuard],
})
export class TenantsModule {}
