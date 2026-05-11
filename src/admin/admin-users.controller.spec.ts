import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
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
  };

  beforeEach(() => {
    service = {
      listUsers: jest.fn(),
      updateUserRole: jest.fn(),
      disableUser: jest.fn(),
      enableUser: jest.fn(),
    };

    controller = new AdminUsersController(service as unknown as AdminUsersService);
  });

  it('declares read roles at the controller level', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AdminUsersController)).toEqual([
      'verbilo_super_admin',
      'verbilo_support',
    ]);
  });

  it('restricts write handlers to verbilo_super_admin', () => {
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
        { dbUser: { id: 'actor-user-id' } } as any,
      ),
    ).resolves.toEqual({ id: 'user-id' });

    expect(service.updateUserRole).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      'company_admin',
      'actor-user-id',
    );
  });

  it('forwards disableUser to the service with actor user id', async () => {
    service.disableUser.mockResolvedValue(undefined);

    await expect(
      controller.disableUser('tenant-id', 'user-id', {
        dbUser: { id: 'actor-user-id' },
      } as any),
    ).resolves.toBeUndefined();

    expect(service.disableUser).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      'actor-user-id',
    );
  });

  it('forwards enableUser to the service with actor user id', async () => {
    service.enableUser.mockResolvedValue(undefined);

    await expect(
      controller.enableUser('tenant-id', 'user-id', {
        dbUser: { id: 'actor-user-id' },
      } as any),
    ).resolves.toBeUndefined();

    expect(service.enableUser).toHaveBeenCalledWith(
      'tenant-id',
      'user-id',
      'actor-user-id',
    );
  });
});

