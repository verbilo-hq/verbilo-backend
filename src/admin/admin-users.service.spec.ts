import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CAPABILITIES } from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let tenantFindUnique: jest.Mock;
  let userFindMany: jest.Mock;
  let userFindFirst: jest.Mock;
  let userUpdate: jest.Mock;
  let siteFindFirst: jest.Mock;
  let userSiteAssignmentUpsert: jest.Mock;
  let userSiteAssignmentDeleteMany: jest.Mock;
  let auditRecord: jest.Mock;
  const actor: DbUserRequestContext = {
    id: 'actor-user-id',
    cognitoId: 'actor-cognito-id',
    tenantId: null,
    siteId: null,
    siteIds: [],
    role: 'verbilo_super_admin',
  };

  beforeEach(() => {
    tenantFindUnique = jest.fn();
    userFindMany = jest.fn();
    userFindFirst = jest.fn();
    userUpdate = jest.fn();
    siteFindFirst = jest.fn();
    userSiteAssignmentUpsert = jest.fn();
    userSiteAssignmentDeleteMany = jest.fn();
    auditRecord = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      tenant: { findUnique: tenantFindUnique },
      user: {
        findMany: userFindMany,
        findFirst: userFindFirst,
        update: userUpdate,
      },
      site: { findFirst: siteFindFirst },
      userSiteAssignment: {
        upsert: userSiteAssignmentUpsert,
        deleteMany: userSiteAssignmentDeleteMany,
      },
    } as unknown as PrismaService;

    const audit = { record: auditRecord } as unknown as AuditService;

    service = new AdminUsersService(prisma, audit);
  });

  describe('listUsers', () => {
    it('throws 404 when the tenant does not exist', async () => {
      tenantFindUnique.mockResolvedValue(null);

      await expect(service.listUsers('missing-tenant-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(tenantFindUnique).toHaveBeenCalledWith({
        where: { id: 'missing-tenant-id' },
        select: { id: true },
      });
      expect(userFindMany).not.toHaveBeenCalled();
    });

    it('returns user summaries ordered by deletedAt then username', async () => {
      const createdAt = new Date('2026-05-10T10:00:00.000Z');
      const deletedAt = new Date('2026-05-10T12:00:00.000Z');

      tenantFindUnique.mockResolvedValue({ id: 'tenant-id' });
      userFindMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          role: 'employee',
          siteId: 'site-1',
          createdAt,
          deletedAt: null,
          site: { id: 'site-1', name: 'Riverside' },
        },
        {
          id: 'user-2',
          username: 'bob',
          role: 'company_admin',
          siteId: null,
          createdAt,
          deletedAt,
          site: null,
        },
      ]);

      await expect(service.listUsers('tenant-id')).resolves.toEqual([
        {
          id: 'user-1',
          username: 'alice',
          role: 'employee',
          siteId: 'site-1',
          siteName: 'Riverside',
          createdAt,
          deletedAt: null,
        },
        {
          id: 'user-2',
          username: 'bob',
          role: 'company_admin',
          siteId: null,
          siteName: null,
          createdAt,
          deletedAt,
        },
      ]);

      expect(userFindMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-id' },
        include: { site: { select: { id: true, name: true } } },
        orderBy: [{ deletedAt: 'asc' }, { username: 'asc' }],
      });
    });
  });

  describe('updateUserRole', () => {
    it('rejects invalid roles', async () => {
      await expect(
        service.updateUserRole(
          'tenant-id',
          'user-id',
          'not-a-role' as any,
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(userFindFirst).not.toHaveBeenCalled();
      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('throws 404 when the user does not belong to the tenant', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.updateUserRole(
          'tenant-id',
          'missing-user-id',
          'employee',
          actor,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('updates the role, writes an audit row, and returns a summary', async () => {
      const createdAt = new Date('2026-05-10T10:00:00.000Z');

      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        createdAt,
        deletedAt: null,
        site: null,
      });

      userUpdate.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'company_admin',
        siteId: null,
        createdAt,
        deletedAt: null,
        site: null,
      });

      await expect(
        service.updateUserRole(
          'tenant-id',
          'user-id',
          'company_admin',
          actor,
        ),
      ).resolves.toEqual({
        id: 'user-id',
        username: 'alice',
        role: 'company_admin',
        siteId: null,
        siteName: null,
        createdAt,
        deletedAt: null,
      });

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { role: 'company_admin' },
        include: { site: { select: { id: true, name: true } } },
      });

      expect(auditRecord).toHaveBeenCalledWith({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'user.role_changed',
        entityType: 'user',
        entityId: 'user-id',
        payload: {
          from: 'employee',
          to: 'company_admin',
          userId: 'user-id',
          actorRole: 'verbilo_super_admin',
          actorScope: { kind: 'platform' },
          capability: CAPABILITIES.USERS_UPDATE_ROLE,
          targetSnapshot: { tenantId: 'tenant-id', userId: 'user-id' },
        },
      });
    });

    it('rejects role assignment above the actor rank', async () => {
      const createdAt = new Date('2026-05-10T10:00:00.000Z');
      const companyAdmin: DbUserRequestContext = {
        ...actor,
        role: 'company_admin',
        tenantId: 'tenant-id',
      };

      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        createdAt,
        deletedAt: null,
        site: null,
      });

      await expect(
        service.updateUserRole(
          'tenant-id',
          'user-id',
          'company_owner',
          companyAdmin,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('returns the existing summary when the role is unchanged', async () => {
      const createdAt = new Date('2026-05-10T10:00:00.000Z');

      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        createdAt,
        deletedAt: null,
        site: null,
      });

      await expect(
        service.updateUserRole(
          'tenant-id',
          'user-id',
          'employee',
          actor,
        ),
      ).resolves.toEqual({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        siteName: null,
        createdAt,
        deletedAt: null,
      });

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });

  describe('disableUser', () => {
    it('throws 404 when the user is missing', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.disableUser('tenant-id', 'missing-user-id', actor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('is idempotent when the user is already disabled', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });

      await expect(
        service.disableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('sets deletedAt and writes an audit row', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        role: 'employee',
        siteId: null,
        deletedAt: null,
      });
      userUpdate.mockResolvedValue({ id: 'user-id' });

      await expect(
        service.disableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { deletedAt: expect.any(Date) },
      });

      expect(auditRecord).toHaveBeenCalledWith({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'user.disabled',
        entityType: 'user',
        entityId: 'user-id',
        payload: {
          actorRole: 'verbilo_super_admin',
          actorScope: { kind: 'platform' },
          capability: CAPABILITIES.USERS_DISABLE,
          targetSnapshot: { tenantId: 'tenant-id', userId: 'user-id' },
        },
      });
    });
  });

  describe('enableUser', () => {
    it('throws 404 when the user is missing', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.enableUser('tenant-id', 'missing-user-id', actor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('is idempotent when the user is already enabled', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        role: 'employee',
        siteId: null,
        deletedAt: null,
      });

      await expect(
        service.enableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('clears deletedAt and writes an audit row', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });
      userUpdate.mockResolvedValue({ id: 'user-id' });

      await expect(
        service.enableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { deletedAt: null },
      });

      expect(auditRecord).toHaveBeenCalledWith({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'user.enabled',
        entityType: 'user',
        entityId: 'user-id',
        payload: {
          actorRole: 'verbilo_super_admin',
          actorScope: { kind: 'platform' },
          capability: CAPABILITIES.USERS_DISABLE,
          targetSnapshot: { tenantId: 'tenant-id', userId: 'user-id' },
        },
      });
    });
  });

  describe('assignUserSite', () => {
    beforeEach(() => {
      userFindFirst.mockResolvedValue({ id: 'user-id' });
      siteFindFirst.mockResolvedValue({ id: 'site-id' });
      userSiteAssignmentUpsert.mockResolvedValue({
        id: 'assignment-id',
        userId: 'user-id',
        siteId: 'site-id',
      });
    });

    it('upserts the assignment and writes an audit row', async () => {
      await expect(
        service.assignUserSite('tenant-id', 'user-id', 'site-id', actor),
      ).resolves.toBeUndefined();

      expect(userFindFirst).toHaveBeenCalledWith({
        where: { id: 'user-id', tenantId: 'tenant-id' },
        select: { id: true },
      });
      expect(siteFindFirst).toHaveBeenCalledWith({
        where: { id: 'site-id', tenantId: 'tenant-id' },
        select: { id: true },
      });
      expect(userSiteAssignmentUpsert).toHaveBeenCalledWith({
        where: { userId_siteId: { userId: 'user-id', siteId: 'site-id' } },
        create: { userId: 'user-id', siteId: 'site-id' },
        update: {},
      });
      expect(auditRecord).toHaveBeenCalledWith({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'user.site.assigned',
        entityType: 'user',
        entityId: 'user-id',
        payload: {
          actorRole: 'verbilo_super_admin',
          actorScope: { kind: 'platform' },
          capability: CAPABILITIES.USERS_ASSIGN_SITE,
          targetSnapshot: {
            tenantId: 'tenant-id',
            userId: 'user-id',
            siteId: 'site-id',
          },
        },
      });
    });

    it('is idempotent when re-assigning the same site', async () => {
      await expect(
        service.assignUserSite('tenant-id', 'user-id', 'site-id', actor),
      ).resolves.toBeUndefined();

      expect(userSiteAssignmentUpsert).toHaveBeenCalledTimes(1);
      expect(auditRecord).toHaveBeenCalledTimes(1);
    });

    it('throws 404 when the user does not belong to the tenant', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.assignUserSite('tenant-id', 'missing-user-id', 'site-id', actor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(siteFindFirst).not.toHaveBeenCalled();
      expect(userSiteAssignmentUpsert).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('throws 404 when the site does not belong to the tenant', async () => {
      siteFindFirst.mockResolvedValue(null);

      await expect(
        service.assignUserSite('tenant-id', 'user-id', 'wrong-site-id', actor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(userSiteAssignmentUpsert).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('rejects site-scoped actors outside their assigned sites', async () => {
      const areaManager: DbUserRequestContext = {
        ...actor,
        role: 'area_manager',
        tenantId: 'tenant-id',
        siteId: 'site-1',
        siteIds: ['site-1', 'site-2'],
      };

      await expect(
        service.assignUserSite(
          'tenant-id',
          'user-id',
          'site-3',
          areaManager,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(userSiteAssignmentUpsert).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });

  describe('unassignUserSite', () => {
    beforeEach(() => {
      userFindFirst.mockResolvedValue({ id: 'user-id' });
      siteFindFirst.mockResolvedValue({ id: 'site-id' });
      userSiteAssignmentDeleteMany.mockResolvedValue({ count: 1 });
    });

    it('deletes the assignment and writes an audit row', async () => {
      const areaManager: DbUserRequestContext = {
        ...actor,
        role: 'area_manager',
        tenantId: 'tenant-id',
        siteId: 'site-1',
        siteIds: ['site-1', 'site-2'],
      };

      await expect(
        service.unassignUserSite(
          'tenant-id',
          'user-id',
          'site-2',
          areaManager,
        ),
      ).resolves.toBeUndefined();

      expect(userSiteAssignmentDeleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-id', siteId: 'site-2' },
      });
      expect(auditRecord).toHaveBeenCalledWith({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'user.site.unassigned',
        entityType: 'user',
        entityId: 'user-id',
        payload: {
          actorRole: 'area_manager',
          actorScope: {
            kind: 'sites',
            tenantId: 'tenant-id',
            siteIds: ['site-1', 'site-2'],
          },
          capability: CAPABILITIES.USERS_ASSIGN_SITE,
          targetSnapshot: {
            tenantId: 'tenant-id',
            userId: 'user-id',
            siteId: 'site-2',
          },
        },
      });
    });

    it('is a 204-style no-op when the assignment is already missing', async () => {
      userSiteAssignmentDeleteMany.mockResolvedValue({ count: 0 });

      await expect(
        service.unassignUserSite('tenant-id', 'user-id', 'site-id', actor),
      ).resolves.toBeUndefined();

      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('throws 404 when the user does not belong to the tenant', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.unassignUserSite(
          'tenant-id',
          'missing-user-id',
          'site-id',
          actor,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(siteFindFirst).not.toHaveBeenCalled();
      expect(userSiteAssignmentDeleteMany).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('throws 404 when the site does not belong to the tenant', async () => {
      siteFindFirst.mockResolvedValue(null);

      await expect(
        service.unassignUserSite(
          'tenant-id',
          'user-id',
          'wrong-site-id',
          actor,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(userSiteAssignmentDeleteMany).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('rejects site-scoped actors outside their assigned sites', async () => {
      const areaManager: DbUserRequestContext = {
        ...actor,
        role: 'area_manager',
        tenantId: 'tenant-id',
        siteId: 'site-1',
        siteIds: ['site-1'],
      };

      await expect(
        service.unassignUserSite(
          'tenant-id',
          'user-id',
          'site-2',
          areaManager,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(userSiteAssignmentDeleteMany).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });
});
