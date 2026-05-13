import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  CAPABILITIES,
  type Capability,
  roleRanksAtOrAbove,
} from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';
import { canActOnTarget, resolveActorScope } from '../common/scope';
import { generateTemporaryPassword } from '../common/temporary-password';
import {
  isUserRole,
  PLATFORM_ROLES,
  UserRole,
  USER_ROLES,
} from '../common/user-roles';
import {
  CognitoAdminClient,
  CognitoUserNotFoundError,
} from '../integrations/aws/cognito-admin.client';
import { PrismaService } from '../prisma/prisma.service';

export type AdminUserSummary = {
  id: string;
  username: string;
  role: string;
  siteId: string | null;
  siteName: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type CreatedTenantUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  siteId: string | null;
  createdAt: Date;
};

export type CreateTenantUserPayload = {
  username: string;
  displayName: string;
  role: UserRole;
  siteId?: string;
  email?: string;
  // VER-74: when true, Cognito emails the invitation (with temp
  // password + sign-in URL) directly to the user instead of the API
  // returning the temp password to the caller. Requires `email`.
  sendInvitationEmail?: boolean;
};

// VER-74: discriminated union for the create response. Either the
// caller gets the temp password back to surface in the UI (legacy
// manual-share path), OR they get a confirmation of which email
// Cognito sent the invitation to. Never both — keeps the temp
// password out of logs / response bodies on the email path.
export type CreateTenantUserResult =
  | { user: CreatedTenantUser; temporaryPassword: string }
  | { user: CreatedTenantUser; invitationEmailedTo: string };

type UserWithSite = {
  id: string;
  username: string;
  role: string;
  siteId: string | null;
  createdAt: Date;
  deletedAt: Date | null;
  site: { id: string; name: string } | null;
};

type JsonActorScope =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'sites'; tenantId: string; siteIds: string[] };

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cognitoAdmin: CognitoAdminClient,
  ) {}

  async listUsers(
    tenantId: string,
    actor?: DbUserRequestContext,
  ): Promise<AdminUserSummary[]> {
    if (
      actor &&
      !PLATFORM_ROLES.has(actor.role) &&
      actor.tenantId !== tenantId
    ) {
      throw new ForbiddenException('Actor scope cannot target tenant');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    const users = await this.prisma.user.findMany({
      where: { tenantId },
      include: { site: { select: { id: true, name: true } } },
      orderBy: [{ deletedAt: 'asc' }, { username: 'asc' }],
    });

    return users.map((user) => this.toSummary(user));
  }

  async createTenantUser(
    actor: DbUserRequestContext | undefined,
    tenantId: string,
    payload: CreateTenantUserPayload,
  ): Promise<CreateTenantUserResult> {
    this.assertRole(payload.role);
    this.assertActorCanCreateTenantUser(actor, tenantId, payload.role);

    // VER-74: the email-invite path requires an actual email address —
    // Cognito will silently drop the message if we hand it the
    // `placeholder.invalid` fallback. Fail fast with a 400 so the
    // frontend can keep the operator on the same screen.
    if (payload.sendInvitationEmail && !payload.email) {
      throw new BadRequestException(
        'An email address is required to send an invitation email',
      );
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (payload.siteId) {
      await this.assertSiteCanBeAssigned(actor, tenantId, payload.siteId);
    } else {
      this.assertActorCanActOnUser(actor, tenantId, null);
    }

    const temporaryPassword = generateTemporaryPassword();
    const email =
      payload.email ?? `${payload.username}@${tenant.slug}.placeholder.invalid`;
    const sendInvitationEmail = payload.sendInvitationEmail === true;
    const cognitoResult = await this.cognitoAdmin.adminCreateUser({
      username: payload.username,
      email,
      temporaryPassword,
      suppressInviteEmail: !sendInvitationEmail,
    });

    if (cognitoResult.status === 'skipped') {
      throw new ServiceUnavailableException(
        'Cognito user creation is not configured for this environment',
      );
    }

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            cognitoId: cognitoResult.cognitoSub,
            username: payload.username,
            displayName: payload.displayName,
            tenantId,
            role: payload.role,
            siteId: payload.siteId,
          },
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            siteId: true,
            createdAt: true,
          },
        });

        if (payload.siteId) {
          await tx.userSiteAssignment.create({
            data: { userId: createdUser.id, siteId: payload.siteId },
          });
        }

        return createdUser;
      });

      await this.audit.record({
        actorUserId: actor?.id,
        tenantId,
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        payload: {
          targetUserId: user.id,
          targetUsername: user.username,
          targetRole: user.role,
          targetSiteId: user.siteId,
          // VER-74: trace which onboarding path was used per row.
          // Never include the temp password itself in the audit log.
          invitationEmailSent: sendInvitationEmail,
        },
      });

      // VER-74: discriminated response. On the email path we drop the
      // temp password from the response body entirely — Cognito has it,
      // the user received it, the operator never needs to see it.
      if (sendInvitationEmail && payload.email) {
        return { user, invitationEmailedTo: payload.email };
      }
      return { user, temporaryPassword };
    } catch (error) {
      await this.audit.record({
        actorUserId: actor?.id,
        tenantId,
        action: 'user.cognito_orphan',
        entityType: 'user',
        entityId: cognitoResult.cognitoSub,
        payload: {
          cognitoSub: cognitoResult.cognitoSub,
          intendedPayload: {
            username: payload.username,
            displayName: payload.displayName,
            role: payload.role,
            siteId: payload.siteId ?? null,
            email,
            tenantId,
            invitationEmailSent: sendInvitationEmail,
          },
        },
      });

      throw error;
    }
  }

  async updateUserRole(
    tenantId: string,
    userId: string,
    role: UserRole,
    actor?: DbUserRequestContext,
  ): Promise<AdminUserSummary> {
    this.assertRole(role);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: { site: { select: { id: true, name: true } } },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const previousRole = user.role;
    this.assertRole(previousRole);
    this.assertActorCanActOnUser(actor, tenantId, user.siteId);
    this.assertActorCanTargetRole(actor, previousRole);
    this.assertActorCanTargetRole(actor, role);

    if (previousRole === role) {
      return this.toSummary(user);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { role },
      include: { site: { select: { id: true, name: true } } },
    });

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId,
      action: 'user.role_changed',
      entityType: 'user',
      entityId: userId,
      payload: {
        from: previousRole,
        to: role,
        userId,
        ...this.authorizationAuditPayload(
          actor,
          CAPABILITIES.USERS_UPDATE_ROLE,
          {
            tenantId,
            userId,
          },
        ),
      } as Prisma.InputJsonValue,
    });

    return this.toSummary(updatedUser);
  }

  async disableUser(
    tenantId: string,
    userId: string,
    actor?: DbUserRequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        username: true,
        role: true,
        siteId: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.assertRole(user.role);
    this.assertActorCanActOnUser(actor, tenantId, user.siteId);
    this.assertActorCanTargetRole(actor, user.role);

    if (user.deletedAt) {
      return;
    }

    await this.disableCognitoUserIfPresent(user.username, user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId,
      action: 'user.disabled',
      entityType: 'user',
      entityId: userId,
      payload: this.authorizationAuditPayload(
        actor,
        CAPABILITIES.USERS_DISABLE,
        {
          tenantId,
          userId,
        },
      ) as Prisma.InputJsonValue,
    });
  }

  async enableUser(
    tenantId: string,
    userId: string,
    actor?: DbUserRequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        username: true,
        role: true,
        siteId: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.assertRole(user.role);
    this.assertActorCanActOnUser(actor, tenantId, user.siteId);
    this.assertActorCanTargetRole(actor, user.role);

    if (!user.deletedAt) {
      return;
    }

    await this.enableCognitoUserIfPresent(user.username, user.id);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: null },
    });

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId,
      action: 'user.enabled',
      entityType: 'user',
      entityId: userId,
      payload: this.authorizationAuditPayload(
        actor,
        CAPABILITIES.USERS_DISABLE,
        {
          tenantId,
          userId,
        },
      ) as Prisma.InputJsonValue,
    });
  }

  async deleteUser(
    tenantId: string,
    userId: string,
    actor?: DbUserRequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: {
        id: true,
        username: true,
        role: true,
        siteId: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.assertRole(user.role);
    this.assertActorCanActOnUser(actor, tenantId, user.siteId);
    this.assertActorCanTargetRole(actor, user.role);

    if (!user.deletedAt) {
      throw new ConflictException('user must be disabled before deletion');
    }

    await this.deleteCognitoUserIfPresent(user.username, user.id);

    await this.prisma.user.delete({ where: { id: user.id } });

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId,
      action: 'user.deleted',
      entityType: 'user',
      entityId: userId,
      payload: this.authorizationAuditPayload(
        actor,
        CAPABILITIES.USERS_DELETE,
        {
          tenantId,
          userId,
          username: user.username,
          role: user.role,
          siteId: user.siteId,
          deletedAt: user.deletedAt.toISOString(),
        },
      ) as Prisma.InputJsonValue,
    });
  }

  async assignUserSite(
    tenantId: string,
    userId: string,
    siteId: string,
    actor?: DbUserRequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenantId },
      select: { id: true },
    });

    if (!site) {
      throw new NotFoundException('Site not found');
    }

    this.assertActorCanActOnSite(actor, tenantId, siteId);

    await this.prisma.userSiteAssignment.upsert({
      where: { userId_siteId: { userId, siteId } },
      create: { userId, siteId },
      update: {},
    });

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId,
      action: 'user.site.assigned',
      entityType: 'user',
      entityId: userId,
      payload: this.authorizationAuditPayload(
        actor,
        CAPABILITIES.USERS_ASSIGN_SITE,
        {
          tenantId,
          userId,
          siteId,
        },
      ) as Prisma.InputJsonValue,
    });
  }

  async unassignUserSite(
    tenantId: string,
    userId: string,
    siteId: string,
    actor?: DbUserRequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenantId },
      select: { id: true },
    });

    if (!site) {
      throw new NotFoundException('Site not found');
    }

    this.assertActorCanActOnSite(actor, tenantId, siteId);

    const result = await this.prisma.userSiteAssignment.deleteMany({
      where: { userId, siteId },
    });

    if (result.count === 0) {
      return;
    }

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId,
      action: 'user.site.unassigned',
      entityType: 'user',
      entityId: userId,
      payload: this.authorizationAuditPayload(
        actor,
        CAPABILITIES.USERS_ASSIGN_SITE,
        {
          tenantId,
          userId,
          siteId,
        },
      ) as Prisma.InputJsonValue,
    });
  }

  private async disableCognitoUserIfPresent(
    username: string,
    userId: string,
  ): Promise<void> {
    // Cognito admin APIs require Username; Verbilo stores that same value in User.username.
    try {
      await this.cognitoAdmin.adminDisableUser(username);
    } catch (error) {
      if (error instanceof CognitoUserNotFoundError) {
        this.logger.warn(
          `Cognito user ${username} not found while disabling DB user ${userId}; continuing with DB soft delete`,
        );
        return;
      }

      throw error;
    }
  }

  private async enableCognitoUserIfPresent(
    username: string,
    userId: string,
  ): Promise<void> {
    // Cognito admin APIs require Username; Verbilo stores that same value in User.username.
    try {
      await this.cognitoAdmin.adminEnableUser(username);
    } catch (error) {
      if (error instanceof CognitoUserNotFoundError) {
        this.logger.warn(
          `Cognito user ${username} not found while enabling DB user ${userId}; continuing with DB restore`,
        );
        return;
      }

      throw error;
    }
  }

  private async deleteCognitoUserIfPresent(
    username: string,
    userId: string,
  ): Promise<void> {
    // Cognito admin APIs require Username; Verbilo stores that same value in User.username.
    try {
      await this.cognitoAdmin.adminDeleteUser(username);
    } catch (error) {
      if (error instanceof CognitoUserNotFoundError) {
        this.logger.warn(
          `Cognito user ${username} not found while deleting DB user ${userId}; continuing with DB hard delete`,
        );
        return;
      }

      throw error;
    }
  }

  private toSummary(user: UserWithSite): AdminUserSummary {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      siteId: user.siteId,
      siteName: user.site?.name ?? null,
      createdAt: user.createdAt,
      deletedAt: user.deletedAt,
    };
  }

  private assertRole(role: string): asserts role is UserRole {
    if (!isUserRole(role)) {
      throw new BadRequestException(
        `Invalid role. Expected one of: ${USER_ROLES.join(', ')}`,
      );
    }
  }

  private assertActorCanActOnUser(
    actor: DbUserRequestContext | undefined,
    tenantId: string,
    siteId: string | null,
  ) {
    if (!actor) {
      throw new ForbiddenException('Actor unresolved');
    }

    const actorScope = resolveActorScope(actor);
    if (!actorScope) {
      throw new ForbiddenException('Actor scope unresolved');
    }

    if (!canActOnTarget(actorScope, { tenantId, siteId })) {
      throw new ForbiddenException('Actor scope cannot target user');
    }
  }

  private assertActorCanActOnSite(
    actor: DbUserRequestContext | undefined,
    tenantId: string,
    siteId: string,
  ) {
    if (!actor) {
      throw new ForbiddenException('Actor unresolved');
    }

    const actorScope = resolveActorScope(actor);
    if (!actorScope) {
      throw new ForbiddenException('Actor scope unresolved');
    }

    if (!canActOnTarget(actorScope, { tenantId, siteId })) {
      throw new ForbiddenException('Actor scope cannot target site');
    }
  }

  private assertActorCanCreateTenantUser(
    actor: DbUserRequestContext | undefined,
    tenantId: string,
    role: UserRole,
  ) {
    if (!actor) {
      throw new ForbiddenException('Actor unresolved');
    }

    if (PLATFORM_ROLES.has(role)) {
      throw new ForbiddenException('Platform roles must be created manually');
    }

    const actorScope = resolveActorScope(actor);
    if (!actorScope) {
      throw new ForbiddenException('Actor scope unresolved');
    }

    if (actorScope.kind !== 'platform' && actorScope.tenantId !== tenantId) {
      throw new ForbiddenException('Actor scope cannot target tenant');
    }

    if (!roleRanksAtOrAbove(actor.role, role)) {
      throw new ForbiddenException(
        `Role ${actor.role} cannot create role ${role}`,
      );
    }
  }

  private async assertSiteCanBeAssigned(
    actor: DbUserRequestContext | undefined,
    tenantId: string,
    siteId: string,
  ) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenantId },
      select: { id: true },
    });

    if (!site) {
      throw new NotFoundException('Site not found');
    }

    this.assertActorCanActOnSite(actor, tenantId, siteId);
  }

  private assertActorCanTargetRole(
    actor: DbUserRequestContext | undefined,
    role: UserRole,
  ) {
    if (!actor) {
      throw new ForbiddenException('Actor unresolved');
    }

    if (!roleRanksAtOrAbove(actor.role, role)) {
      throw new ForbiddenException(
        `Role ${actor.role} cannot act on role ${role}`,
      );
    }
  }

  private authorizationAuditPayload(
    actor: DbUserRequestContext | undefined,
    capability: Capability,
    targetSnapshot: Record<string, unknown>,
  ) {
    return {
      ...(actor ? { actorRole: actor.role } : {}),
      actorScope: actor
        ? this.toJsonActorScope(resolveActorScope(actor))
        : null,
      capability,
      targetSnapshot,
    };
  }

  private toJsonActorScope(
    actorScope: ReturnType<typeof resolveActorScope>,
  ): JsonActorScope | null {
    if (!actorScope) {
      return null;
    }
    if (actorScope.kind !== 'sites') {
      return actorScope;
    }
    return {
      kind: 'sites',
      tenantId: actorScope.tenantId,
      siteIds: [...actorScope.siteIds],
    };
  }
}
