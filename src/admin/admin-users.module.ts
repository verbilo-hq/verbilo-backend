import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CapabilityGuard } from '../common/capability.guard';
import { RolesGuard } from '../common/roles.guard';
import { AwsModule } from '../integrations/aws/aws.module';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuditModule, AwsModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, RolesGuard, CapabilityGuard],
})
export class AdminUsersModule {}
