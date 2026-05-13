import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CAPABILITIES } from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';
import {
  CognitoAdminClient,
  CognitoUserAlreadyExistsError,
  CognitoUserNotFoundError,
} from '../integrations/aws/cognito-admin.client';
import { PrismaService } from '../prisma/prisma.service';
import { AdminUsersService } from './admin-users.service';

jest.mock(
  '@aws-sdk/client-cognito-identity-provider',
  () => ({
    CognitoIdentityProviderClient: jest.fn(),
    AdminCreateUserCommand: jest.fn(),
  }),
  { virtual: true },
);

describe('AdminUsersService', () => {
  let service: AdminUsersService;
  let tenantFindUnique: jest.Mock;
  let prismaTransaction: jest.Mock;
  let userFindMany: jest.Mock;
  let userFindFirst: jest.Mock;
  let userCreate: jest.Mock;
  let userUpdate: jest.Mock;
  let userDelete: jest.Mock;
  let siteFindFirst: jest.Mock;
  let userSiteAssignmentCreate: jest.Mock;
  let userSiteAssignmentUpsert: jest.Mock;
  let userSiteAssignmentDeleteMany: jest.Mock;
  let auditRecord: jest.Mock;
  let cognitoAdminCreateUser: jest.Mock;
  let cognitoAdminDisableUser: jest.Mock;
  let cognitoAdminEnableUser: jest.Mock;
  let cognitoAdminDeleteUser: jest.Mock;
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
    prismaTransaction = jest.fn(async (callback) =>
      callback({
        user: { create: userCreate },
        userSiteAssignment: { create: userSiteAssignmentCreate },
      }),
    );
    userFindMany = jest.fn();
    userFindFirst = jest.fn();
    userCreate = jest.fn();
    userUpdate = jest.fn();
    userDelete = jest.fn();
    siteFindFirst = jest.fn();
    userSiteAssignmentCreate = jest.fn();
    userSiteAssignmentUpsert = jest.fn();
    userSiteAssignmentDeleteMany = jest.fn();
    auditRecord = jest.fn().mockResolvedValue(undefined);
    cognitoAdminCreateUser = jest.fn().mockResolvedValue({
      status: 'created',
      cognitoSub: 'created-cognito-sub',
    });
    cognitoAdminDisableUser = jest.fn().mockResolvedValue(undefined);
    cognitoAdminEnableUser = jest.fn().mockResolvedValue(undefined);
    cognitoAdminDeleteUser = jest.fn().mockResolvedValue(undefined);

    const prisma = {
      $transaction: prismaTransaction,
      tenant: { findUnique: tenantFindUnique },
      user: {
        findMany: userFindMany,
        findFirst: userFindFirst,
        create: userCreate,
        update: userUpdate,
        delete: userDelete,
      },
      site: { findFirst: siteFindFirst },
      userSiteAssignment: {
        create: userSiteAssignmentCreate,
        upsert: userSiteAssignmentUpsert,
        deleteMany: userSiteAssignmentDeleteMany,
      },
    } as unknown as PrismaService;

    const audit = { record: auditRecord } as unknown as AuditService;
    const cognitoAdmin = {
      adminCreateUser: cognitoAdminCreateUser,
      adminDisableUser: cognitoAdminDisableUser,
      adminEnableUser: cognitoAdminEnableUser,
      adminDeleteUser: cognitoAdminDeleteUser,
    } as unknown as CognitoAdminClient;

    service = new AdminUsersService(prisma, audit, cognitoAdmin);
  });

  describe('listUsers', () => {
    it('throws 404 when the tenant does not exist', async () => {
      tenantFindUnique.mockResolvedValue(null);

      await expect(
        service.listUsers('missing-tenant-id'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(tenantFindUnique).toHaveBeenCalledWith({
        where: { id: 'missing-tenant-id' },
        select: { id: true },
      });
      expect(userFindMany).not.toHaveBeenCalled();
    });

    it('rejects customer actors targeting another tenant', async () => {
      const companyAdmin: DbUserRequestContext = {
        ...actor,
        role: 'company_admin',
        tenantId: 'tenant-a-id',
      };

      await expect(
        service.listUsers('tenant-b-id', companyAdmin),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tenantFindUnique).not.toHaveBeenCalled();
      expect(userFindMany).not.toHaveBeenCalled();
    });

    it('allows customer actors to list users in their own tenant', async () => {
      const createdAt = new Date('2026-05-10T10:00:00.000Z');
      const companyAdmin: DbUserRequestContext = {
        ...actor,
        role: 'company_admin',
        tenantId: 'tenant-id',
      };

      tenantFindUnique.mockResolvedValue({ id: 'tenant-id' });
      userFindMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          role: 'employee',
          siteId: null,
          createdAt,
          deletedAt: null,
          site: null,
        },
      ]);

      await expect(
        service.listUsers('tenant-id', companyAdmin),
      ).resolves.toEqual([
        {
          id: 'user-1',
          username: 'alice',
          role: 'employee',
          siteId: null,
          siteName: null,
          createdAt,
          deletedAt: null,
        },
      ]);
    });

    it('allows platform actors to list users in any tenant', async () => {
      const createdAt = new Date('2026-05-10T10:00:00.000Z');

      tenantFindUnique.mockResolvedValue({ id: 'tenant-b-id' });
      userFindMany.mockResolvedValue([
        {
          id: 'user-1',
          username: 'alice',
          role: 'employee',
          siteId: null,
          createdAt,
          deletedAt: null,
          site: null,
        },
      ]);

      await expect(service.listUsers('tenant-b-id', actor)).resolves.toEqual([
        {
          id: 'user-1',
          username: 'alice',
          role: 'employee',
          siteId: null,
          siteName: null,
          createdAt,
          deletedAt: null,
        },
      ]);
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

  describe('createTenantUser', () => {
    const createdAt = new Date('2026-05-13T10:00:00.000Z');
    const companyAdmin: DbUserRequestContext = {
      ...actor,
      role: 'company_admin',
      tenantId: 'tenant-id',
    };

    beforeEach(() => {
      tenantFindUnique.mockResolvedValue({ id: 'tenant-id', slug: 'smileco' });
      siteFindFirst.mockResolvedValue({ id: 'site-id' });
      userCreate.mockResolvedValue({
        id: 'new-user-id',
        username: 's.jenkins',
        displayName: 'Sam Jenkins',
        role: 'employee',
        siteId: null,
        createdAt,
      });
      userSiteAssignmentCreate.mockResolvedValue({
        id: 'assignment-id',
        userId: 'new-user-id',
        siteId: 'site-id',
      });
    });

    it('creates an employee in the actor tenant, calls Cognito, and writes audit', async () => {
      await expect(
        service.createTenantUser(companyAdmin, 'tenant-id', {
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
          email: 's.jenkins@example.com',
        }),
      ).resolves.toEqual({
        user: {
          id: 'new-user-id',
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
          siteId: null,
          createdAt,
        },
        temporaryPassword: expect.stringMatching(
          /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12}$/,
        ),
      });

      expect(cognitoAdminCreateUser).toHaveBeenCalledWith({
        username: 's.jenkins',
        email: 's.jenkins@example.com',
        temporaryPassword: expect.stringMatching(
          /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12}$/,
        ),
      });
      expect(userCreate).toHaveBeenCalledWith({
        data: {
          cognitoId: 'created-cognito-sub',
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          tenantId: 'tenant-id',
          role: 'employee',
          siteId: undefined,
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          siteId: true,
          createdAt: true,
        },
      });
      expect(userSiteAssignmentCreate).not.toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'user.created',
        entityType: 'user',
        entityId: 'new-user-id',
        payload: {
          targetUserId: 'new-user-id',
          targetUsername: 's.jenkins',
          targetRole: 'employee',
          targetSiteId: null,
        },
      });
    });

    it('rejects rank escalation above the actor role', async () => {
      const practiceManager: DbUserRequestContext = {
        ...actor,
        role: 'practice_manager',
        tenantId: 'tenant-id',
        siteId: 'site-id',
        siteIds: ['site-id'],
      };

      await expect(
        service.createTenantUser(practiceManager, 'tenant-id', {
          username: 'admin.user',
          displayName: 'Admin User',
          role: 'company_admin',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(cognitoAdminCreateUser).not.toHaveBeenCalled();
      expect(userCreate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('rejects cross-tenant creates for non-platform actors', async () => {
      await expect(
        service.createTenantUser(companyAdmin, 'tenant-b-id', {
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(cognitoAdminCreateUser).not.toHaveBeenCalled();
      expect(userCreate).not.toHaveBeenCalled();
    });

    it('allows site-scoped actors to create users in their assigned site', async () => {
      const practiceManager: DbUserRequestContext = {
        ...actor,
        role: 'practice_manager',
        tenantId: 'tenant-id',
        siteId: 'site-x',
        siteIds: ['site-x'],
      };

      siteFindFirst.mockResolvedValue({ id: 'site-x' });
      userCreate.mockResolvedValue({
        id: 'new-user-id',
        username: 's.jenkins',
        displayName: 'Sam Jenkins',
        role: 'employee',
        siteId: 'site-x',
        createdAt,
      });

      await expect(
        service.createTenantUser(practiceManager, 'tenant-id', {
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
          siteId: 'site-x',
        }),
      ).resolves.toEqual({
        user: {
          id: 'new-user-id',
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
          siteId: 'site-x',
          createdAt,
        },
        temporaryPassword: expect.any(String),
      });

      expect(siteFindFirst).toHaveBeenCalledWith({
        where: { id: 'site-x', tenantId: 'tenant-id' },
        select: { id: true },
      });
      expect(userSiteAssignmentCreate).toHaveBeenCalledWith({
        data: { userId: 'new-user-id', siteId: 'site-x' },
      });
      expect(cognitoAdminCreateUser).toHaveBeenCalledWith({
        username: 's.jenkins',
        email: 's.jenkins@smileco.placeholder.invalid',
        temporaryPassword: expect.any(String),
      });
    });

    it('rejects site-scoped actors outside their assigned sites', async () => {
      const practiceManager: DbUserRequestContext = {
        ...actor,
        role: 'practice_manager',
        tenantId: 'tenant-id',
        siteId: 'site-x',
        siteIds: ['site-x'],
      };

      siteFindFirst.mockResolvedValue({ id: 'site-y' });

      await expect(
        service.createTenantUser(practiceManager, 'tenant-id', {
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
          siteId: 'site-y',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(cognitoAdminCreateUser).not.toHaveBeenCalled();
      expect(userCreate).not.toHaveBeenCalled();
    });

    it('allows platform admins to create tenant-level admins in any tenant', async () => {
      userCreate.mockResolvedValue({
        id: 'new-user-id',
        username: 'admin.user',
        displayName: 'Admin User',
        role: 'company_admin',
        siteId: null,
        createdAt,
      });

      await expect(
        service.createTenantUser(actor, 'tenant-id', {
          username: 'admin.user',
          displayName: 'Admin User',
          role: 'company_admin',
        }),
      ).resolves.toEqual({
        user: {
          id: 'new-user-id',
          username: 'admin.user',
          displayName: 'Admin User',
          role: 'company_admin',
          siteId: null,
          createdAt,
        },
        temporaryPassword: expect.any(String),
      });

      expect(cognitoAdminCreateUser).toHaveBeenCalled();
      expect(userCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'company_admin' }),
        }),
      );
    });

    it('propagates duplicate Cognito user errors before creating a DB user', async () => {
      cognitoAdminCreateUser.mockRejectedValue(
        new CognitoUserAlreadyExistsError('s.jenkins'),
      );

      await expect(
        service.createTenantUser(companyAdmin, 'tenant-id', {
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
        }),
      ).rejects.toBeInstanceOf(CognitoUserAlreadyExistsError);

      expect(userCreate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
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
        service.updateUserRole('tenant-id', 'user-id', 'company_admin', actor),
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
        service.updateUserRole('tenant-id', 'user-id', 'employee', actor),
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
      expect(cognitoAdminDisableUser).not.toHaveBeenCalled();
    });

    it('is idempotent when the user is already disabled', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });

      await expect(
        service.disableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
      expect(cognitoAdminDisableUser).not.toHaveBeenCalled();
    });

    it('disables the Cognito user, sets deletedAt, and writes an audit row', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: null,
      });
      userUpdate.mockResolvedValue({ id: 'user-id' });

      await expect(
        service.disableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(cognitoAdminDisableUser).toHaveBeenCalledWith('alice');
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

    it('soft-deletes when Cognito user is already missing', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: null,
      });
      cognitoAdminDisableUser.mockRejectedValue(
        new CognitoUserNotFoundError('alice'),
      );

      await expect(
        service.disableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.disabled' }),
      );
    });

    it('does not soft-delete when Cognito disable fails unexpectedly', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: null,
      });
      cognitoAdminDisableUser.mockRejectedValue(new Error('Access denied'));

      await expect(
        service.disableUser('tenant-id', 'user-id', actor),
      ).rejects.toThrow('Access denied');

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
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
      expect(cognitoAdminEnableUser).not.toHaveBeenCalled();
    });

    it('is idempotent when the user is already enabled', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: null,
      });

      await expect(
        service.enableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
      expect(cognitoAdminEnableUser).not.toHaveBeenCalled();
    });

    it('enables the Cognito user, clears deletedAt, and writes an audit row', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });
      userUpdate.mockResolvedValue({ id: 'user-id' });

      await expect(
        service.enableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(cognitoAdminEnableUser).toHaveBeenCalledWith('alice');
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

    it('restores the DB user when Cognito user is already missing', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });
      cognitoAdminEnableUser.mockRejectedValue(
        new CognitoUserNotFoundError('alice'),
      );

      await expect(
        service.enableUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { deletedAt: null },
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.enabled' }),
      );
    });

    it('does not restore the DB user when Cognito enable fails unexpectedly', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });
      cognitoAdminEnableUser.mockRejectedValue(new Error('Access denied'));

      await expect(
        service.enableUser('tenant-id', 'user-id', actor),
      ).rejects.toThrow('Access denied');

      expect(userUpdate).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('throws 404 when the user is missing', async () => {
      userFindFirst.mockResolvedValue(null);

      await expect(
        service.deleteUser('tenant-id', 'missing-user-id', actor),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(cognitoAdminDeleteUser).not.toHaveBeenCalled();
      expect(userDelete).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('rejects users that have not been disabled first', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: null,
      });

      await expect(
        service.deleteUser('tenant-id', 'user-id', actor),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(cognitoAdminDeleteUser).not.toHaveBeenCalled();
      expect(userDelete).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });

    it('deletes the Cognito user, hard-deletes the row, and writes audit', async () => {
      const deletedAt = new Date('2026-05-10T12:00:00.000Z');
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: 'site-id',
        deletedAt,
      });
      userDelete.mockResolvedValue({ id: 'user-id' });

      await expect(
        service.deleteUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(cognitoAdminDeleteUser).toHaveBeenCalledWith('alice');
      expect(userDelete).toHaveBeenCalledWith({ where: { id: 'user-id' } });
      expect(auditRecord).toHaveBeenCalledWith({
        actorUserId: 'actor-user-id',
        tenantId: 'tenant-id',
        action: 'user.deleted',
        entityType: 'user',
        entityId: 'user-id',
        payload: {
          actorRole: 'verbilo_super_admin',
          actorScope: { kind: 'platform' },
          capability: CAPABILITIES.USERS_DELETE,
          targetSnapshot: {
            tenantId: 'tenant-id',
            userId: 'user-id',
            username: 'alice',
            role: 'employee',
            siteId: 'site-id',
            deletedAt: '2026-05-10T12:00:00.000Z',
          },
        },
      });
    });

    it('hard-deletes when Cognito user is already missing', async () => {
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });
      cognitoAdminDeleteUser.mockRejectedValue(
        new CognitoUserNotFoundError('alice'),
      );

      await expect(
        service.deleteUser('tenant-id', 'user-id', actor),
      ).resolves.toBeUndefined();

      expect(userDelete).toHaveBeenCalledWith({ where: { id: 'user-id' } });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'user.deleted' }),
      );
    });

    it('rejects actors outside the target user scope', async () => {
      const companyAdmin: DbUserRequestContext = {
        ...actor,
        role: 'company_admin',
        tenantId: 'tenant-b-id',
      };
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'alice',
        role: 'employee',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });

      await expect(
        service.deleteUser('tenant-id', 'user-id', companyAdmin),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(cognitoAdminDeleteUser).not.toHaveBeenCalled();
      expect(userDelete).not.toHaveBeenCalled();
    });

    it('rejects actors below the target user rank', async () => {
      const companyAdmin: DbUserRequestContext = {
        ...actor,
        role: 'company_admin',
        tenantId: 'tenant-id',
      };
      userFindFirst.mockResolvedValue({
        id: 'user-id',
        username: 'owner',
        role: 'company_owner',
        siteId: null,
        deletedAt: new Date('2026-05-10T12:00:00.000Z'),
      });

      await expect(
        service.deleteUser('tenant-id', 'user-id', companyAdmin),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(cognitoAdminDeleteUser).not.toHaveBeenCalled();
      expect(userDelete).not.toHaveBeenCalled();
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
        service.assignUserSite(
          'tenant-id',
          'missing-user-id',
          'site-id',
          actor,
        ),
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
        service.assignUserSite('tenant-id', 'user-id', 'site-3', areaManager),
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
        service.unassignUserSite('tenant-id', 'user-id', 'site-2', areaManager),
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
        service.unassignUserSite('tenant-id', 'user-id', 'site-2', areaManager),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(userSiteAssignmentDeleteMany).not.toHaveBeenCalled();
      expect(auditRecord).not.toHaveBeenCalled();
    });
  });
});
