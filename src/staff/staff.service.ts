import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StaffRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffMemberDto } from './dto/create-staff-member.dto';
import { UpdateStaffMemberDto } from './dto/update-staff-member.dto';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async listStaffMembers(tenantId: string, siteId?: string) {
    return this.prisma.staffMember.findMany({
      where: {
        tenantId,
        archivedAt: null,
        ...(siteId ? { siteId } : {}),
      },
      orderBy: [{ surname: 'asc' }, { firstName: 'asc' }],
    });
  }

  async createStaffMember(tenantId: string, input: CreateStaffMemberDto) {
    const existingEmail = await this.prisma.staffMember.findFirst({
      where: { tenantId, email: input.email },
      select: { id: true },
    });

    if (existingEmail) {
      throw new ConflictException('Staff member email is already in use');
    }

    if (input.siteId) {
      await this.assertSiteInTenant(tenantId, input.siteId);
    }

    if (input.userId) {
      await this.assertUserInTenant(tenantId, input.userId);

      const existingUser = await this.prisma.staffMember.findFirst({
        where: { userId: input.userId },
        select: { id: true },
      });

      if (existingUser) {
        throw new ConflictException('User is already linked to a staff member');
      }
    }

    const data: Prisma.StaffMemberCreateInput = {
      tenant: { connect: { id: tenantId } },
      firstName: input.firstName,
      surname: input.surname,
      email: input.email,
      phone: input.phone ?? null,
      role: input.role as StaffRole,
      clinicalSpecialty: input.clinicalSpecialty ?? null,
      gdcNumber: input.gdcNumber ?? null,
      startedAt: input.startedAt ? new Date(input.startedAt) : null,
      endedAt: null,
      archivedAt: null,
      ...(input.siteId ? { site: { connect: { id: input.siteId } } } : {}),
      ...(input.userId ? { user: { connect: { id: input.userId } } } : {}),
    };

    try {
      return await this.prisma.staffMember.create({ data });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Staff member already exists');
      }
      throw error;
    }
  }

  async getStaffMember(tenantId: string, id: string) {
    const staffMember = await this.prisma.staffMember.findFirst({
      where: { tenantId, id, archivedAt: null },
    });

    if (!staffMember) {
      throw new NotFoundException('Staff member not found');
    }

    return staffMember;
  }

  async updateStaffMember(
    tenantId: string,
    id: string,
    input: UpdateStaffMemberDto,
  ) {
    const existing = await this.prisma.staffMember.findFirst({
      where: { tenantId, id, archivedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Staff member not found');
    }

    if (input.email) {
      const emailOwner = await this.prisma.staffMember.findFirst({
        where: { tenantId, email: input.email },
        select: { id: true },
      });

      if (emailOwner && emailOwner.id !== id) {
        throw new ConflictException('Staff member email is already in use');
      }
    }

    if (input.userId !== undefined) {
      if (input.userId) {
        await this.assertUserInTenant(tenantId, input.userId);

        const userOwner = await this.prisma.staffMember.findFirst({
          where: { userId: input.userId },
          select: { id: true },
        });

        if (userOwner && userOwner.id !== id) {
          throw new ConflictException(
            'User is already linked to a staff member',
          );
        }
      }
    }

    if (input.siteId !== undefined && input.siteId) {
      await this.assertSiteInTenant(tenantId, input.siteId);
    }

    const data: Prisma.StaffMemberUpdateInput = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.surname !== undefined ? { surname: input.surname } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
      ...(input.role !== undefined ? { role: input.role as StaffRole } : {}),
      ...(input.clinicalSpecialty !== undefined
        ? { clinicalSpecialty: input.clinicalSpecialty ?? null }
        : {}),
      ...(input.gdcNumber !== undefined
        ? { gdcNumber: input.gdcNumber ?? null }
        : {}),
      ...(input.startedAt !== undefined
        ? { startedAt: input.startedAt ? new Date(input.startedAt) : null }
        : {}),
      ...(input.endedAt !== undefined
        ? { endedAt: input.endedAt ? new Date(input.endedAt) : null }
        : {}),
      ...(input.archivedAt !== undefined
        ? { archivedAt: input.archivedAt ? new Date(input.archivedAt) : null }
        : {}),
      ...(input.siteId !== undefined
        ? input.siteId
          ? { site: { connect: { id: input.siteId } } }
          : { site: { disconnect: true } }
        : {}),
      ...(input.userId !== undefined
        ? input.userId
          ? { user: { connect: { id: input.userId } } }
          : { user: { disconnect: true } }
        : {}),
    };

    try {
      return await this.prisma.staffMember.update({
        where: { id },
        data,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Staff member already exists');
      }
      throw error;
    }
  }

  async archiveStaffMember(tenantId: string, id: string) {
    const existing = await this.prisma.staffMember.findFirst({
      where: { tenantId, id, archivedAt: null },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Staff member not found');
    }

    return this.prisma.staffMember.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private async assertSiteInTenant(tenantId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenantId },
      select: { id: true },
    });

    if (!site) {
      throw new NotFoundException('Site not found');
    }
  }

  private async assertUserInTenant(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }
}
