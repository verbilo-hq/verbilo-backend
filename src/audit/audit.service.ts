import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AuditRecordInput = {
  actorUserId?: string;
  tenantId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  payload?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          payloadJson: input.payload ?? {},
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown audit log error';
      this.logger.warn(`Failed to write audit log: ${message}`);
    }
  }
}
