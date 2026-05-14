import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';
import { RequiresCapability } from '../common/requires-capability.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { USER_ROLES } from '../common/user-roles';
import { OnboardingService } from './onboarding.service';

type OnboardingRequest = Request & {
  dbUser: DbUserRequestContext;
};

@Controller()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('admin/tenants/:id/onboarding')
  @UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
  @Roles(
    'verbilo_super_admin',
    'verbilo_support',
    'company_owner',
    'company_admin',
  )
  @RequiresCapability(CAPABILITIES.TENANT_UPDATE)
  getTenantOnboarding(
    @Param('id') tenantId: string,
    @Req() request: OnboardingRequest,
  ) {
    return this.onboarding.getStateForTenant(tenantId, request.dbUser);
  }

  @Post('admin/tenants/:id/onboarding/handover-complete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('verbilo_super_admin', 'verbilo_support')
  markHandoverComplete(
    @Param('id') tenantId: string,
    @Req() request: OnboardingRequest,
  ) {
    return this.onboarding.markHandoverComplete(tenantId, request.dbUser);
  }

  @Get('users/me/onboarding-actions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...USER_ROLES)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  getMyOnboardingActions(@Req() request: OnboardingRequest) {
    return this.onboarding.getActionsForUser(request.dbUser);
  }
}
