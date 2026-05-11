import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
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
    actorUserId?: string,
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

    if (previousRole === role) {
      return this.toSummary(user);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { role },
      include: { site: { select: { id: true, name: true } } },
    });

    await this.audit.record({
      actorUserId,
      tenantId,
      action: 'user.role_changed',
      entityType: 'user',
      entityId: userId,
      payload: { from: previousRole, to: role, userId } as Prisma.InputJsonValue,
    });

    return this.toSummary(updatedUser);
  }

  async disableUser(
    tenantId: string,
    userId: string,
    actorUserId?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, deletedAt: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.deletedAt) {
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      actorUserId,
      tenantId,
      action: 'user.disabled',
      entityType: 'user',
      entityId: userId,
    });
  }

  async enableUser(
    tenantId: string,
    userId: string,
    actorUserId?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true, deletedAt: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.deletedAt) {
      return;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: null },
    });

    await this.audit.record({
      actorUserId,
      tenantId,
      action: 'user.enabled',
      entityType: 'user',
      entityId: userId,
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
}

