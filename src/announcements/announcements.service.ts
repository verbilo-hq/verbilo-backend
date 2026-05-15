import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Announcement, Prisma } from '@prisma/client';
import { type DbUserRequestContext } from '../common/request-context';
import { PLATFORM_ROLES } from '../common/user-roles';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AnnouncementVisibilityScope,
  CreateAnnouncementDto,
} from './dto/create-announcement.dto';
import { ListAnnouncementsDto } from './dto/list-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

export type AnnouncementReadDto = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  visibilityScope: AnnouncementVisibilityScope;
  scopeSiteIds: string[];
  pinned: boolean;
  publishedAt: Date;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    username: string;
    displayName: string;
  } | null;
};

export type ListAnnouncementsResponseDto = {
  items: AnnouncementReadDto[];
  nextCursor: string | null;
};

type AnnouncementCursor = {
  pinned: boolean;
  publishedAt: string;
  id: string;
};

type AnnouncementAuthor = {
  id: string;
  username: string;
  displayName: string;
};

const TENANT_WIDE_ROLES = new Set(['company_owner', 'company_admin']);
const EDIT_ANY_ROLES = new Set([
  'company_owner',
  'company_admin',
  'verbilo_support',
  'verbilo_super_admin',
]);

@Injectable()
export class AnnouncementsService {
  private readonly uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateAnnouncementDto,
    dbUser: DbUserRequestContext,
  ): Promise<AnnouncementReadDto> {
    const tenantId = this.requireActorTenantId(dbUser);
    const scopeSiteIds = this.normaliseAndValidateScope(
      dto.visibilityScope,
      dto.scopeSiteIds,
      dbUser,
    );

    const announcement = await this.prisma.announcement.create({
      data: {
        tenantId,
        authorId: dbUser.id,
        title: dto.title,
        body: dto.body,
        visibilityScope: dto.visibilityScope,
        scopeSiteIds,
        pinned: dto.pinned ?? false,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    const author = await this.findAuthor(dbUser.id);

    return this.toReadDto(announcement, author);
  }

  async list(
    query: ListAnnouncementsDto,
    dbUser: DbUserRequestContext,
  ): Promise<ListAnnouncementsResponseDto> {
    const limit = query.limit ?? 20;
    const tenantId = this.resolveListTenantId(query, dbUser);
    const filters: Prisma.AnnouncementWhereInput[] = [
      { tenantId },
      { deletedAt: null },
      { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
    ];

    if (!this.isPlatformAdmin(dbUser) && !TENANT_WIDE_ROLES.has(dbUser.role)) {
      const siteIds = this.actorSiteIds(dbUser);
      filters.push({
        OR: [
          { visibilityScope: 'company' },
          ...(siteIds.length > 0
            ? [{ scopeSiteIds: { hasSome: siteIds } }]
            : []),
        ],
      });
    }

    if (query.cursor) {
      filters.push(this.cursorFilter(this.decodeCursor(query.cursor)));
    }

    const rows = await this.prisma.announcement.findMany({
      where: { AND: filters },
      orderBy: [
        { pinned: 'desc' },
        { publishedAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
    });

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const authors = await this.findAuthors(items);
    const nextCursor =
      hasNextPage && items.length > 0
        ? this.encodeCursor(items[items.length - 1])
        : null;

    return {
      items: items.map((item) =>
        this.toReadDto(
          item,
          item.authorId ? (authors.get(item.authorId) ?? null) : null,
        ),
      ),
      nextCursor,
    };
  }

  async update(
    id: string,
    dto: UpdateAnnouncementDto,
    dbUser: DbUserRequestContext,
  ): Promise<AnnouncementReadDto> {
    const existing = await this.findMutableAnnouncement(id, dbUser);

    if (
      existing.authorId !== dbUser.id &&
      !EDIT_ANY_ROLES.has(dbUser.role)
    ) {
      throw new ForbiddenException('Only the author or tenant admins can edit');
    }

    const visibilityScope = dto.visibilityScope ?? existing.visibilityScope;
    const scopeSiteIds = this.normaliseAndValidateScope(
      visibilityScope as AnnouncementVisibilityScope,
      dto.scopeSiteIds ?? existing.scopeSiteIds,
      dbUser,
    );

    const announcement = await this.prisma.announcement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.visibilityScope !== undefined ? { visibilityScope } : {}),
        scopeSiteIds,
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
        ...(dto.expiresAt !== undefined
          ? { expiresAt: new Date(dto.expiresAt) }
          : {}),
      },
    });
    const author = announcement.authorId
      ? await this.findAuthor(announcement.authorId)
      : null;

    return this.toReadDto(announcement, author);
  }

  async softDelete(
    id: string,
    dbUser: DbUserRequestContext,
  ): Promise<void> {
    await this.findMutableAnnouncement(id, dbUser);

    await this.prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private requireActorTenantId(dbUser: DbUserRequestContext): string {
    if (!dbUser.tenantId) {
      throw new ForbiddenException('Announcement access requires tenant');
    }
    return dbUser.tenantId;
  }

  private resolveListTenantId(
    query: ListAnnouncementsDto,
    dbUser: DbUserRequestContext,
  ): string {
    if (this.isPlatformAdmin(dbUser)) {
      if (!query.tenantId) {
        throw new BadRequestException('tenantId is required for platform admins');
      }
      return query.tenantId;
    }

    if (query.tenantId) {
      throw new BadRequestException('tenantId is only available to platform admins');
    }

    return this.requireActorTenantId(dbUser);
  }

  private async findMutableAnnouncement(
    id: string,
    dbUser: DbUserRequestContext,
  ): Promise<Announcement> {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, deletedAt: null },
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    if (!this.isPlatformAdmin(dbUser)) {
      const tenantId = this.requireActorTenantId(dbUser);
      if (announcement.tenantId !== tenantId) {
        throw new ForbiddenException('Announcement belongs to another tenant');
      }
    }

    return announcement;
  }

  private normaliseAndValidateScope(
    visibilityScope: AnnouncementVisibilityScope,
    scopeSiteIds: string[] | undefined,
    dbUser: DbUserRequestContext,
  ): string[] {
    const siteIds = [...new Set(scopeSiteIds ?? [])];

    if (visibilityScope === 'company') {
      return [];
    }

    if (visibilityScope === 'site' && siteIds.length !== 1) {
      throw new BadRequestException(
        'site announcements must target exactly one site',
      );
    }
    if (visibilityScope === 'area' && siteIds.length < 1) {
      throw new BadRequestException(
        'area announcements must target at least one site',
      );
    }

    if (!this.isPlatformAdmin(dbUser) && !TENANT_WIDE_ROLES.has(dbUser.role)) {
      const actorSiteIds = this.actorSiteIds(dbUser);
      const outsideActorScope = siteIds.some(
        (siteId) => !actorSiteIds.includes(siteId),
      );

      if (outsideActorScope) {
        throw new ForbiddenException(
          'Announcement site scope exceeds actor scope',
        );
      }
    }

    return siteIds;
  }

  private actorSiteIds(dbUser: DbUserRequestContext): string[] {
    return dbUser.siteIds.length > 0
      ? dbUser.siteIds
      : dbUser.siteId
        ? [dbUser.siteId]
        : [];
  }

  private isPlatformAdmin(dbUser: DbUserRequestContext): boolean {
    return PLATFORM_ROLES.has(dbUser.role);
  }

  private async findAuthors(
    items: Announcement[],
  ): Promise<Map<string, AnnouncementAuthor>> {
    const authorIds = [
      ...new Set(
        items
          .map((item) => item.authorId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (!authorIds.length) {
      return new Map();
    }

    const authors = await this.prisma.user.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, username: true, displayName: true },
    });

    return new Map(authors.map((author) => [author.id, author]));
  }

  private async findAuthor(id: string): Promise<AnnouncementAuthor | null> {
    const author = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true },
    });

    return author ?? null;
  }

  private cursorFilter(
    cursor: { pinned: boolean; publishedAt: Date; id: string },
  ): Prisma.AnnouncementWhereInput {
    const samePinnedAfterCursor: Prisma.AnnouncementWhereInput[] = [
      { pinned: cursor.pinned, publishedAt: { lt: cursor.publishedAt } },
      {
        pinned: cursor.pinned,
        publishedAt: cursor.publishedAt,
        id: { lt: cursor.id },
      },
    ];

    if (cursor.pinned) {
      samePinnedAfterCursor.push({ pinned: false });
    }

    return { OR: samePinnedAfterCursor };
  }

  private decodeCursor(cursor: string): {
    pinned: boolean;
    publishedAt: Date;
    id: string;
  } {
    let parsed: Partial<AnnouncementCursor> | null;

    try {
      parsed = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8'),
      ) as Partial<AnnouncementCursor> | null;
    } catch {
      throw new BadRequestException('Invalid announcement cursor');
    }

    if (
      !parsed ||
      typeof parsed.pinned !== 'boolean' ||
      typeof parsed.publishedAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new BadRequestException('Invalid announcement cursor');
    }

    const publishedAt = new Date(parsed.publishedAt);

    if (
      Number.isNaN(publishedAt.getTime()) ||
      !this.uuidPattern.test(parsed.id)
    ) {
      throw new BadRequestException('Invalid announcement cursor');
    }

    return { pinned: parsed.pinned, publishedAt, id: parsed.id };
  }

  private encodeCursor(item: Announcement): string {
    return Buffer.from(
      JSON.stringify({
        pinned: item.pinned,
        publishedAt: item.publishedAt.toISOString(),
        id: item.id,
      }),
    ).toString('base64');
  }

  private toReadDto(
    announcement: Announcement,
    author: AnnouncementAuthor | null,
  ): AnnouncementReadDto {
    return {
      id: announcement.id,
      tenantId: announcement.tenantId,
      title: announcement.title,
      body: announcement.body,
      visibilityScope:
        announcement.visibilityScope as AnnouncementVisibilityScope,
      scopeSiteIds: announcement.scopeSiteIds,
      pinned: announcement.pinned,
      publishedAt: announcement.publishedAt,
      expiresAt: announcement.expiresAt,
      createdAt: announcement.createdAt,
      updatedAt: announcement.updatedAt,
      author,
    };
  }
}
