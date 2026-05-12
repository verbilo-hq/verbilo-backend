import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CapabilityGuard } from '../common/capability.guard';
import { RolesGuard } from '../common/roles.guard';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuditModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, RolesGuard, CapabilityGuard],
})
export class AdminUsersModule {}
