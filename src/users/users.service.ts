import { Injectable, NotFoundException } from '@nestjs/common';
import { StaffMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type UserMeExport = {
  exportedAt: string;
  user: {
    id: string;
    username: string;
    cognitoId: string | null;
    role: string;
    tenantId: string | null;
    siteId: string | null;
    createdAt: Date;
    deletedAt: Date | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    sector: string;
  } | null;
  site: {
    id: string;
    name: string;
  } | null;
  staffMember: StaffMember | null;
  auditLog: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: Date;
  }>;
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(cognitoId: string, tenantId?: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        cognitoId,
        ...(tenantId ? { tenantId } : {}),
      },
      include: { tenant: true, site: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async exportMyData(cognitoId: string, tenantId?: string): Promise<UserMeExport> {
    const user = await this.prisma.user.findFirst({
      where: {
        cognitoId,
        ...(tenantId ? { tenantId } : {}),
      },
      include: { tenant: true, site: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [staffMember, auditLog] = await Promise.all([
      this.prisma.staffMember.findFirst({
        where: { userId: user.id },
      }),
      this.prisma.auditLog.findMany({
        where: { actorUserId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        username: user.username,
        cognitoId: user.cognitoId,
        role: user.role,
        tenantId: user.tenantId,
        siteId: user.siteId,
        createdAt: user.createdAt,
        deletedAt: user.deletedAt ?? null,
      },
      tenant: user.tenant
        ? {
            id: user.tenant.id,
            name: user.tenant.name,
            slug: user.tenant.slug,
            sector: user.tenant.sector,
          }
        : null,
      site: user.site
        ? {
            id: user.site.id,
            name: user.site.name,
          }
        : null,
      staffMember,
      auditLog,
    };
  }

  async deleteMyData(cognitoId: string, tenantId?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({
        where: {
          cognitoId,
          ...(tenantId ? { tenantId } : {}),
        },
        select: { id: true, tenantId: true, deletedAt: true },
      });

      if (!user || user.deletedAt) {
        return;
      }

      const now = new Date();

      await tx.user.update({
        where: { id: user.id },
        data: {
          deletedAt: now,
          cognitoId: null,
          username: `deleted-${user.id}`,
          siteId: null,
        },
      });

      const staffMember = await tx.staffMember.findFirst({
        where: { userId: user.id },
        select: { id: true },
      });

      if (staffMember) {
        await tx.staffMember.update({
          where: { id: staffMember.id },
          data: {
            archivedAt: now,
            email: `deleted+${staffMember.id}@verbilo.invalid`,
            phone: null,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'user.deleted',
          entityType: 'User',
          entityId: user.id,
          actorUserId: user.id,
          tenantId: user.tenantId,
          payloadJson: { reason: 'gdpr_self_delete' },
        },
      });
    });
  }
}
