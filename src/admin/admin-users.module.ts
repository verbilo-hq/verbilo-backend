import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RolesGuard } from '../common/roles.guard';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [AuditModule],
  controllers: [AdminUsersController],
  providers: [AdminUsersService, RolesGuard],
})
export class AdminUsersModule {}

