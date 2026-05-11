import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let tenantFindUnique: jest.Mock;
  let userFindMany: jest.Mock;
  let userFindFirst: jest.Mock;
  let userUpdate: jest.Mock;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    tenantFindUnique = jest.fn();
    userFindMany = jest.fn();
    userFindFirst = jest.fn();
    userUpdate = jest.fn();
    auditRecord = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      tenant: { findUnique: tenantFindUnique },
      user: {
        findMany: userFindMany,
        findFirst: userFindFirst,
        update: userUpdate,
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
          'actor-user-id',
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
          'actor-user-id',
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
          'actor-user-id',
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
        payload: { from: 'employee', to: 'company_admin', userId: 'user-id' },
      });
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
          'actor-user-id',
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
        service.disableUser('tenant-id', 'missing-user-id', 'actor-user-id'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('is idempotent when the user is already disabled', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });

      await expect(
        service.disableUser('tenant-id', 'user-id', 'actor-user-id'),
      ).resolves.toBeUndefined();

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('sets deletedAt and writes an audit row', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-id', deletedAt: null });
      userUpdate.mockResolvedValue({ id: 'user-id' });

      await expect(
        service.disableUser('tenant-id', 'user-id', 'actor-user-id'),
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
      });
    });
  });

  describe('enableUser', () => {
    it('throws 404 when the user is missing', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.enableUser('tenant-id', 'missing-user-id', 'actor-user-id'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('is idempotent when the user is already enabled', async () => {
      userFindFirst.mockResolvedValue({ id: 'user-id', deletedAt: null });

      await expect(
        service.enableUser('tenant-id', 'user-id', 'actor-user-id'),
      ).resolves.toBeUndefined();

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('clears deletedAt and writes an audit row', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });
      userUpdate.mockResolvedValue({ id: 'user-id' });

      await expect(
        service.enableUser('tenant-id', 'user-id', 'actor-user-id'),
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
      });
    });
  });
});

