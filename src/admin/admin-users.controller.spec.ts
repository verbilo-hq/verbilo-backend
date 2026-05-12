import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CAPABILITIES } from '../common/capabilities';
import { REQUIRES_CAPABILITY_KEY } from '../common/requires-capability.decorator';
import { ROLES_KEY } from '../common/roles.decorator';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { UpdateTenantUserDto } from './dto/update-tenant-user.dto';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let service: {
    listUsers: jest.Mock;
    updateUserRole: jest.Mock;
    disableUser: jest.Mock;
    enableUser: jest.Mock;
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
      updateUserRole: jest.fn(),
      disableUser: jest.fn(),
      enableUser: jest.fn(),
      assignUserSite: jest.fn(),
      unassignUserSite: jest.fn(),
    };

    controller = new AdminUsersController(service as unknown as AdminUsersService);
  });

  it('declares read roles at the controller level', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsersController)).toEqual([
      'verbilo_super_admin',
      'verbilo_support',
    ]);
  });

  it('declares write handler role restrictions', () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.updateUserRole,
      ),
    ).toEqual(['verbilo_super_admin']);
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminUsersController.prototype.disableUser),
    ).toEqual(['verbilo_super_admin']);
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminUsersController.prototype.enableUser),
    ).toEqual(['verbilo_super_admin']);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.assignUserSite,
      ),
    ).toEqual([
      'verbilo_super_admin',
      'verbilo_support',
      'company_owner',
      'company_admin',
      'area_manager',
    ]);
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        AdminUsersController.prototype.unassignUserSite,
      ),
    ).toEqual([
      'verbilo_super_admin',
      'verbilo_support',
      'company_owner',
      'company_admin',
      'area_manager',
    ]);
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

  it('forwards listUsers to the service', async () => {
    service.listUsers.mockResolvedValue([{ id: 'user-id' }]);

    await expect(controller.listUsers('tenant-id')).resolves.toEqual([
      { id: 'user-id' },
    ]);

    expect(service.listUsers).toHaveBeenCalledWith('tenant-id');
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
