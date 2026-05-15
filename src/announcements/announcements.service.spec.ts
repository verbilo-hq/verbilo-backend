import { ForbiddenException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { type DbUserRequestContext } from '../common/request-context';

describe('AnnouncementsService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const authorId = '33333333-3333-4333-8333-333333333333';
  const otherAuthorId = '44444444-4444-4444-8444-444444444444';
  const siteOneId = '55555555-5555-4555-8555-555555555555';
  const siteTwoId = '66666666-6666-4666-8666-666666666666';
  const announcementId = '77777777-7777-4777-8777-777777777777';
  const now = new Date('2026-05-15T10:00:00.000Z');

  function service() {
    const prisma = {
      announcement: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    return {
      prisma,
      announcementsService: new AnnouncementsService(prisma as never),
    };
  }

  function dbUser(
    role: DbUserRequestContext['role'],
    overrides: Partial<DbUserRequestContext> = {},
  ): DbUserRequestContext {
    return {
      id: authorId,
      cognitoId: 'cognito-sub-1',
      tenantId,
      siteId: null,
      siteIds: [],
      role,
      ...overrides,
    };
  }

  function announcement(overrides = {}) {
    return {
      id: announcementId,
      tenantId,
      authorId,
      title: 'Update',
      body: 'Body',
      visibilityScope: 'site',
      scopeSiteIds: [siteOneId],
      pinned: false,
      publishedAt: now,
      expiresAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists company-wide and assigned-site announcements for site-scoped callers', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const { prisma, announcementsService } = service();

    prisma.announcement.findMany.mockResolvedValue([
      announcement({ visibilityScope: 'company', scopeSiteIds: [] }),
      announcement({
        id: '88888888-8888-4888-8888-888888888888',
        scopeSiteIds: [siteOneId],
      }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: authorId,
        username: 'author',
        displayName: 'Author User',
      },
    ]);

    const result = await announcementsService.list(
      { limit: 20 },
      dbUser('employee', { siteIds: [siteOneId] }),
    );

    expect(prisma.announcement.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { tenantId },
          { deletedAt: null },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
          {
            OR: [
              { visibilityScope: 'company' },
              { scopeSiteIds: { hasSome: [siteOneId] } },
            ],
          },
        ],
      },
      orderBy: [
        { pinned: 'desc' },
        { publishedAt: 'desc' },
        { id: 'desc' },
      ],
      take: 21,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].author).toEqual({
      id: authorId,
      username: 'author',
      displayName: 'Author User',
    });
    expect(result.nextCursor).toBeNull();
  });

  it('lists every active announcement in tenant for tenant-wide callers', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const { prisma, announcementsService } = service();

    prisma.announcement.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    await announcementsService.list({ limit: 20 }, dbUser('company_admin'));

    expect(prisma.announcement.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { tenantId },
          { deletedAt: null },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        ],
      },
      orderBy: [
        { pinned: 'desc' },
        { publishedAt: 'desc' },
        { id: 'desc' },
      ],
      take: 21,
    });
  });

  it('requires platform callers to pass tenantId for list', async () => {
    const { announcementsService } = service();

    await expect(
      announcementsService.list(
        { limit: 20 },
        dbUser('verbilo_support', { tenantId: null }),
      ),
    ).rejects.toThrow('tenantId is required for platform admins');
  });

  it('uses the explicit tenantId filter for platform list callers', async () => {
    const { prisma, announcementsService } = service();

    prisma.announcement.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    await announcementsService.list(
      { limit: 20, tenantId: otherTenantId },
      dbUser('verbilo_support', { tenantId: null }),
    );

    expect(prisma.announcement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ tenantId: otherTenantId }]),
        }),
      }),
    );
  });

  it('rejects site-scoped creates outside the actor site assignments', async () => {
    const { announcementsService } = service();

    await expect(
      announcementsService.create(
        {
          title: 'Update',
          body: 'Body',
          visibilityScope: 'site',
          scopeSiteIds: [siteTwoId],
        },
        dbUser('practice_manager', { siteIds: [siteOneId] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('forces company create scopeSiteIds to empty', async () => {
    const { prisma, announcementsService } = service();

    prisma.announcement.create.mockResolvedValue(
      announcement({ visibilityScope: 'company', scopeSiteIds: [] }),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: authorId,
      username: 'author',
      displayName: 'Author User',
    });

    await announcementsService.create(
      {
        title: 'Update',
        body: 'Body',
        visibilityScope: 'company',
        scopeSiteIds: [siteOneId],
      },
      dbUser('company_admin'),
    );

    expect(prisma.announcement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        visibilityScope: 'company',
        scopeSiteIds: [],
      }),
    });
  });

  it('rejects non-author updates unless caller can edit any announcement', async () => {
    const { prisma, announcementsService } = service();

    prisma.announcement.findFirst.mockResolvedValue(
      announcement({ authorId: otherAuthorId }),
    );

    await expect(
      announcementsService.update(
        announcementId,
        { title: 'Changed' },
        dbUser('practice_manager', { siteIds: [siteOneId] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows tenant admins to edit announcements by another author', async () => {
    const { prisma, announcementsService } = service();

    prisma.announcement.findFirst.mockResolvedValue(
      announcement({ authorId: otherAuthorId }),
    );
    prisma.announcement.update.mockResolvedValue(
      announcement({ authorId: otherAuthorId, title: 'Changed' }),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: otherAuthorId,
      username: 'other-author',
      displayName: 'Other Author',
    });

    const result = await announcementsService.update(
      announcementId,
      { title: 'Changed' },
      dbUser('company_admin'),
    );

    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: announcementId },
      data: expect.objectContaining({
        title: 'Changed',
        scopeSiteIds: [siteOneId],
      }),
    });
    expect(result.title).toBe('Changed');
    expect(result.author).toEqual({
      id: otherAuthorId,
      username: 'other-author',
      displayName: 'Other Author',
    });
  });

  it('soft deletes by setting deletedAt', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const { prisma, announcementsService } = service();

    prisma.announcement.findFirst.mockResolvedValue(announcement());
    prisma.announcement.update.mockResolvedValue(
      announcement({ deletedAt: now }),
    );

    await announcementsService.softDelete(announcementId, dbUser('company_admin'));

    expect(prisma.announcement.update).toHaveBeenCalledWith({
      where: { id: announcementId },
      data: { deletedAt: now },
    });
  });
});
