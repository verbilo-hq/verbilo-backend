import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
import { isUserRole, UserRole, USER_ROLES } from '../common/user-roles';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listUsers(tenantId: string): Promise<AdminUserSummary[]> {
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
      select: { id: true, role: true, siteId: true, deletedAt: true },
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
      payload: this.authorizationAuditPayload(actor, CAPABILITIES.USERS_DISABLE, {
        tenantId,
        userId,
      }) as Prisma.InputJsonValue,
    });
  }

  async enableUser(
    tenantId: string,
    userId: string,
    actor?: DbUserRequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, role: true, siteId: true, deletedAt: true },
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
      payload: this.authorizationAuditPayload(actor, CAPABILITIES.USERS_DISABLE, {
        tenantId,
        userId,
      }) as Prisma.InputJsonValue,
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
      actorScope: actor ? this.toJsonActorScope(resolveActorScope(actor)) : null,
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
