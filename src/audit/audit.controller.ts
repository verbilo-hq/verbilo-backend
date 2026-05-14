import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { DbUserRequestContext } from '../common/request-context';
import { RequiresCapability } from '../common/requires-capability.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PLATFORM_ROLES } from '../common/user-roles';
import { AuditService } from './audit.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

type AuditRequest = Request & {
  dbUser: DbUserRequestContext;
};

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequiresCapability(CAPABILITIES.AUDIT_READ)
  listAuditLogs(
    @Query() query: ListAuditLogsDto,
    @Req() request: AuditRequest,
  ) {
    return this.auditService.list({
      ...query,
      callerTenantId: request.dbUser.tenantId,
      isPlatformAdmin: PLATFORM_ROLES.has(request.dbUser.role),
    });
  }
}
