import { Global, Module } from '@nestjs/common';
import { CapabilityGuard } from '../common/capability.guard';
import { RolesGuard } from '../common/roles.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, RolesGuard, CapabilityGuard],
  exports: [AuditService],
})
export class AuditModule {}
