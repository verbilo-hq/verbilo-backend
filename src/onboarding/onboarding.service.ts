import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { type DbUserRequestContext } from '../common/request-context';
import { PLATFORM_ROLES } from '../common/user-roles';
import { PrismaService } from '../prisma/prisma.service';

export type TenantOnboardingState = {
  sitesAdded: boolean;
  firstStaffInvited: boolean;
  brandingConfigured: boolean;
  starterTemplatesPublished: boolean;
  handoverComplete: boolean;
  handoverCompletedAt: string | null;
  handoverCompletedBy: string | null;
};

export type OnboardingAction = {
  id:
    | 'customise-branding'
    | 'invite-team'
    | 'publish-starter-content'
    | 'add-first-site';
  label: string;
  hint: string;
  done: boolean;
  nav?: string;
};

type TenantOnboardingRow = {
  id: string;
  logoUrl: string | null;
  primaryColor: string | null;
  onboardingState: Prisma.JsonValue;
};

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getStateForTenant(
    tenantId: string,
    actor?: DbUserRequestContext,
  ): Promise<TenantOnboardingState> {
    this.assertActorCanReadTenant(actor, tenantId);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        logoUrl: true,
        primaryColor: true,
        onboardingState: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const [siteCount, userCount] = await Promise.all([
      this.prisma.site.count({ where: { tenantId } }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    return this.toState(tenant, siteCount, userCount);
  }

  async markHandoverComplete(
    tenantId: string,
    actor: DbUserRequestContext,
  ): Promise<TenantOnboardingState> {
    this.assertOperatorActor(actor);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, onboardingState: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const existingState = this.readOnboardingObject(tenant.onboardingState);
    if (existingState.handoverComplete === true) {
      throw new ConflictException('Handover already marked complete');
    }

    const completedAt = new Date().toISOString();
    const nextState: Prisma.InputJsonObject = {
      ...existingState,
      handoverComplete: true,
      handoverCompletedAt: completedAt,
      handoverCompletedBy: actor.id,
    };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { onboardingState: nextState },
    });

    await this.audit.record({
      actorUserId: actor.id,
      tenantId,
      action: 'tenant.onboarding.handover_completed',
      entityType: 'tenant',
      entityId: tenantId,
      payload: {
        handoverCompletedAt: completedAt,
        handoverCompletedBy: actor.id,
        actorRole: actor.role,
      },
    });

    return this.getStateForTenant(tenantId, actor);
  }

  async getActionsForUser(
    actor: DbUserRequestContext,
  ): Promise<OnboardingAction[]> {
    if (!actor.tenantId) {
      return [];
    }

    const state = await this.getStateForTenant(actor.tenantId, actor);
    const actions: OnboardingAction[] = [
      {
        id: 'customise-branding',
        label: 'Customise branding',
        hint: 'Add your logo and brand colour.',
        done: state.brandingConfigured,
        nav: 'settings',
      },
      {
        id: 'invite-team',
        label: 'Invite your team',
        hint: 'Add the first staff member after the bootstrap admin.',
        done: state.firstStaffInvited,
        nav: 'users',
      },
      {
        id: 'publish-starter-content',
        label: 'Publish starter content',
        hint: 'Review and publish the starter templates for your modules.',
        done: state.starterTemplatesPublished,
        nav: 'clinical',
      },
      {
        id: 'add-first-site',
        label: 'Add your first site',
        hint: 'Create the first practice, clinic, or site.',
        done: state.sitesAdded,
        nav: 'settings',
      },
    ];

    return actions.sort((left, right) => Number(left.done) - Number(right.done));
  }

  private toState(
    tenant: TenantOnboardingRow,
    siteCount: number,
    userCount: number,
  ): TenantOnboardingState {
    const onboardingState = this.readOnboardingObject(tenant.onboardingState);

    return {
      sitesAdded: siteCount > 0,
      firstStaffInvited: userCount > 1,
      brandingConfigured: Boolean(tenant.logoUrl && tenant.primaryColor),
      // VER-91 v1: starter-template publishing is not persisted per module yet.
      // VER-87+ will replace this with the real module adoption signal.
      starterTemplatesPublished: false,
      handoverComplete: onboardingState.handoverComplete === true,
      handoverCompletedAt:
        typeof onboardingState.handoverCompletedAt === 'string'
          ? onboardingState.handoverCompletedAt
          : null,
      handoverCompletedBy:
        typeof onboardingState.handoverCompletedBy === 'string'
          ? onboardingState.handoverCompletedBy
          : null,
    };
  }

  private readOnboardingObject(
    value: Prisma.JsonValue | null | undefined,
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return value as Record<string, unknown>;
  }

  private assertActorCanReadTenant(
    actor: DbUserRequestContext | undefined,
    tenantId: string,
  ) {
    if (!actor || PLATFORM_ROLES.has(actor.role)) {
      return;
    }

    if (actor.tenantId !== tenantId) {
      throw new ForbiddenException('Actor scope cannot target tenant');
    }
  }

  private assertOperatorActor(actor: DbUserRequestContext | undefined) {
    if (!actor || !PLATFORM_ROLES.has(actor.role)) {
      throw new ForbiddenException('Only platform operators can mark handover');
    }
  }
}
