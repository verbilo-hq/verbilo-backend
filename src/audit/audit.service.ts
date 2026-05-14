import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';

export type AuditRecordInput = {
  actorUserId?: string;
  tenantId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  payload?: Prisma.InputJsonValue;
};

export type AuditLogReadDto = {
  id: string;
  actorUserId: string | null;
  tenantId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  payload: Prisma.JsonValue;
  createdAt: Date;
  actor: {
    id: string;
    username: string;
    displayName: string;
  } | null;
};

export type ListAuditLogsResponseDto = {
  items: AuditLogReadDto[];
  nextCursor: string | null;
};

export type ListAuditLogsArgs = ListAuditLogsDto & {
  callerTenantId: string | null;
  isPlatformAdmin: boolean;
};

type AuditLogCursor = {
  createdAt: string;
  id: string;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  async list(args: ListAuditLogsArgs): Promise<ListAuditLogsResponseDto> {
    const limit = args.limit ?? 50;
    const filters: Prisma.AuditLogWhereInput[] = [];
    const tenantId = args.isPlatformAdmin ? args.tenantId : args.callerTenantId;

    if (!args.isPlatformAdmin && !tenantId) {
      throw new ForbiddenException(
        'Tenant-scoped audit access requires tenant',
      );
    }

    if (tenantId) {
      filters.push({ tenantId });
    }
    if (args.actorUserId) {
      filters.push({ actorUserId: args.actorUserId });
    }
    if (args.action) {
      filters.push({ action: args.action });
    }
    if (args.entityType) {
      filters.push({ entityType: args.entityType });
    }
    if (args.entityId) {
      filters.push({ entityId: args.entityId });
    }
    if (args.from || args.to) {
      filters.push({
        createdAt: {
          ...(args.from ? { gte: new Date(args.from) } : {}),
          ...(args.to ? { lte: new Date(args.to) } : {}),
        },
      });
    }
    if (args.cursor) {
      const cursor = this.decodeCursor(args.cursor);
      filters.push({
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      });
    }

    const rows = await this.prisma.auditLog.findMany({
      where: filters.length > 0 ? { AND: filters } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const actorIds = [
      ...new Set(
        items
          .map((item) => item.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, username: true, displayName: true },
        })
      : [];
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    const nextCursor =
      hasNextPage && items.length > 0
        ? this.encodeCursor(items[items.length - 1])
        : null;

    return {
      items: items.map((item) => {
        const actor = item.actorUserId
          ? (actorById.get(item.actorUserId) ?? null)
          : null;

        return {
          id: item.id,
          actorUserId: item.actorUserId,
          tenantId: item.tenantId,
          action: item.action,
          entityType: item.entityType,
          entityId: item.entityId,
          payload: item.payloadJson,
          createdAt: item.createdAt,
          actor,
        };
      }),
      nextCursor,
    };
  }

  private decodeCursor(cursor: string): { createdAt: Date; id: string } {
    let parsed: Partial<AuditLogCursor> | null;

    try {
      parsed = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8'),
      ) as Partial<AuditLogCursor> | null;
    } catch {
      throw new BadRequestException('Invalid audit log cursor');
    }

    if (
      !parsed ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new BadRequestException('Invalid audit log cursor');
    }

    const createdAt = new Date(parsed.createdAt);

    if (
      Number.isNaN(createdAt.getTime()) ||
      !this.uuidPattern.test(parsed.id)
    ) {
      throw new BadRequestException('Invalid audit log cursor');
    }

    return { createdAt, id: parsed.id };
  }

  private encodeCursor(item: { createdAt: Date; id: string }): string {
    return Buffer.from(
      JSON.stringify({ createdAt: item.createdAt.toISOString(), id: item.id }),
    ).toString('base64');
  }
}
