import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { RequiresCapability } from '../common/requires-capability.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { StarterTemplatesService } from './starter-templates.service';

@Controller('admin/tenants/:id/starter-templates')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
@Roles(
  'verbilo_super_admin',
  'verbilo_support',
  'company_owner',
  'company_admin',
)
export class StarterTemplatesController {
  constructor(private readonly starterTemplates: StarterTemplatesService) {}

  @Get()
  @RequiresCapability(CAPABILITIES.TENANT_UPDATE_BRANDING)
  getStarterTemplates(
    @Param('id') tenantId: string,
    @Query('module') moduleId: string | undefined,
  ) {
    return this.starterTemplates.getStarterTemplates(tenantId, moduleId);
  }
}
