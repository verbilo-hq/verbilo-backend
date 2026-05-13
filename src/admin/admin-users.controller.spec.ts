import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CAPABILITIES } from '../common/capabilities';
import { REQUIRES_CAPABILITY_KEY } from '../common/requires-capability.decorator';
import { ROLES_KEY } from '../common/roles.decorator';
import {
  CognitoOperationError,
  CognitoUserAlreadyExistsError,
} from '../integrations/aws/cognito-admin.client';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { CreateTenantUserDto } from './dto/create-tenant-user.dto';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';

jest.mock(
  '@aws-sdk/client-cognito-identity-provider',
  () => ({
    CognitoIdentityProviderClient: jest.fn(),
    AdminCreateUserCommand: jest.fn(),
  }),
  { virtual: true },
);

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let service: {
    listUsers: jest.Mock;
    createTenantUser: jest.Mock;
    updateUserRole: jest.Mock;
    disableUser: jest.Mock;
    enableUser: jest.Mock;
    deleteUser: jest.Mock;
    assignUserSite: jest.Mock;
    unassignUserSite: jest.Mock;
  };
  const actor = {
    id: 'actor-user-id',
    cognitoId: 'actor-cognito-id',
    tenantId: null,
    siteId: null,
    siteIds: [],
    role: 'verbilo_super_admin',
  };

  beforeEach(() => {
    service = {
      listUsers: jest.fn(),
      createTenantUser: jest.fn(),
      updateUserRole: jest.fn(),
      disableUser: jest.fn(),
      enableUser: jest.fn(),
      deleteUser: jest.fn(),
      assignUserSite: jest.fn(),
      unassignUserSite: jest.fn(),
    };

    controller = new AdminUsersController(
      service as unknown as AdminUsersService,
    );
  });

  it('declares controller roles for every role with users capabilities', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsersController)).toEqual([
      'verbilo_super_admin',
      'verbilo_support',
      'company_owner',
      'company_admin',
      'area_manager',
      'practice_manager',
    ]);
  });

  it('does not override controller roles on capability-gated handlers', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.createTenantUser,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.updateUserRole,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.disableUser,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminUsersController.prototype.enableUser),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminUsersController.prototype.deleteUser),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.assignUserSite,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.unassignUserSite,
      ),
    ).toBeUndefined();
  });

  it('declares capability requirements on protected handlers', () => {
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.listUsers,
      ),
    ).toBe(CAPABILITIES.USERS_LIST);
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.createTenantUser,
      ),
    ).toBe(CAPABILITIES.USERS_CREATE);
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.updateUserRole,
      ),
    ).toBe(CAPABILITIES.USERS_UPDATE_ROLE);
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.disableUser,
      ),
    ).toBe(CAPABILITIES.USERS_DISABLE);
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.deleteUser,
      ),
    ).toBe(CAPABILITIES.USERS_DELETE);
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.enableUser,
      ),
    ).toBe(CAPABILITIES.USERS_DISABLE);
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.assignUserSite,
      ),
    ).toBe(CAPABILITIES.USERS_ASSIGN_SITE);
    expect(
      Reflect.getMetadata(
        REQUIRES_CAPABILITY_KEY,
        AdminUsersController.prototype.unassignUserSite,
      ),
    ).toBe(CAPABILITIES.USERS_ASSIGN_SITE);
  });

  it('validates UpdateTenantUserDto roles against USER_ROLES', () => {
    const ok = validateSync(
      plainToInstance(UpdateTenantUserDto, { role: 'company_admin' }),
    );
    expect(ok).toHaveLength(0);

    const bad = validateSync(
      plainToInstance(UpdateTenantUserDto, { role: 'not-a-role' }),
    );
    expect(bad.length).toBeGreaterThan(0);
  });

  it('validates CreateTenantUserDto shape', () => {
    const ok = validateSync(
      plainToInstance(CreateTenantUserDto, {
        username: 's.jenkins_2',
        displayName: 'Sam Jenkins',
        role: 'employee',
        siteId: '7da01ef1-8465-4f94-9efb-41200e7a406e',
        email: 's.jenkins@example.com',
      }),
    );
    expect(ok).toHaveLength(0);

    const bad = validateSync(
      plainToInstance(CreateTenantUserDto, {
        username: 'Sam Jenkins',
        displayName: '',
        role: 'not-a-role',
        siteId: 'not-a-uuid',
        email: 'not-an-email',
      }),
    );
    expect(bad.length).toBeGreaterThan(0);
  });

  it('forwards listUsers to the service with actor', async () => {
    service.listUsers.mockResolvedValue([{ id: 'user-id' }]);

    await expect(
      controller.listUsers('tenant-id', { dbUser: actor } as any),
    ).resolves.toEqual([{ id: 'user-id' }]);

    expect(service.listUsers).toHaveBeenCalledWith('tenant-id', actor);
  });

  it('lets a company_admin list users through to the service', async () => {
    const companyAdmin = {
      ...actor,
      tenantId: 'tenant-id',
      role: 'company_admin',
    };
    service.listUsers.mockResolvedValue([{ id: 'user-id' }]);

    await expect(
      controller.listUsers('tenant-id', { dbUser: companyAdmin } as any),
    ).resolves.toEqual([{ id: 'user-id' }]);

    expect(service.listUsers).toHaveBeenCalledWith('tenant-id', companyAdmin);
  });

  it('forwards createTenantUser to the service with actor and body', async () => {
    service.createTenantUser.mockResolvedValue({
      user: { id: 'user-id' },
      temporaryPassword: 'TempPass1!',
    });

    const body = {
      username: 's.jenkins',
      displayName: 'Sam Jenkins',
      role: 'employee' as const,
      email: 's.jenkins@example.com',
    };

    await expect(
      controller.createTenantUser('tenant-id', body, {
        dbUser: actor,
      } as any),
    ).resolves.toEqual({
      user: { id: 'user-id' },
      temporaryPassword: 'TempPass1!',
    });

    expect(service.createTenantUser).toHaveBeenCalledWith(
      actor,
      'tenant-id',
      body,
    );
  });

  it('maps duplicate Cognito users to 409 Conflict', async () => {
    service.createTenantUser.mockRejectedValue(
      new CognitoUserAlreadyExistsError('s.jenkins'),
    );

    await expect(
      controller.createTenantUser(
        'tenant-id',
        {
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
        },
        { dbUser: actor } as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps Cognito operation failures to 503 Service Unavailable', async () => {
    service.createTenantUser.mockRejectedValue(
      new CognitoOperationError('AccessDeniedException'),
    );

    await expect(
      controller.createTenantUser(
        'tenant-id',
        {
          username: 's.jenkins',
          displayName: 'Sam Jenkins',
          role: 'employee',
        },
        { dbUser: actor } as any,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('forwards updateUserRole to the service with actor user id', async () => {
    service.updateUserRole.mockResolvedValue({ id: 'user-id' });

    await expect(
      controller.updateUserRole(
        'tenant-id',
        'user-id',
        { role: 'company_admin' },
        { dbUser: actor } as any,
      ),
    ).resolves.toEqual({ id: 'user-id' });

    expect(service.updateUserRole).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      'company_admin',
      actor,
    );
  });

  it('forwards disableUser to the service with actor user id', async () => {
    service.disableUser.mockResolvedValue(undefined);

    await expect(
      controller.disableUser('tenant-id', 'user-id', {
        dbUser: actor,
      } as any),
    ).resolves.toBeUndefined();

    expect(service.disableUser).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      actor,
    );
  });

  it('forwards enableUser to the service with actor user id', async () => {
    service.enableUser.mockResolvedValue(undefined);

    await expect(
      controller.enableUser('tenant-id', 'user-id', {
        dbUser: actor,
      } as any),
    ).resolves.toBeUndefined();

    expect(service.enableUser).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      actor,
    );
  });

  it('forwards deleteUser to the service with actor user id', async () => {
    service.deleteUser.mockResolvedValue(undefined);

    await expect(
      controller.deleteUser('tenant-id', 'user-id', {
        dbUser: actor,
      } as any),
    ).resolves.toBeUndefined();

    expect(service.deleteUser).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      actor,
    );
  });

  it('lets deleteUser ConflictException propagate as a 409', async () => {
    service.deleteUser.mockRejectedValue(
      new ConflictException('user must be disabled before deletion'),
    );

    await expect(
      controller.deleteUser('tenant-id', 'user-id', {
        dbUser: actor,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('forwards assignUserSite to the service with actor user id', async () => {
    service.assignUserSite.mockResolvedValue(undefined);

    await expect(
      controller.assignUserSite('tenant-id', 'user-id', 'site-id', {
        dbUser: actor,
      } as any),
    ).resolves.toBeUndefined();

    expect(service.assignUserSite).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      'site-id',
      actor,
    );
  });

  it('forwards unassignUserSite to the service with actor user id', async () => {
    service.unassignUserSite.mockResolvedValue(undefined);

    await expect(
      controller.unassignUserSite('tenant-id', 'user-id', 'site-id', {
        dbUser: actor,
      } as any),
    ).resolves.toBeUndefined();

    expect(service.unassignUserSite).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      'site-id',
      actor,
    );
  });
});
