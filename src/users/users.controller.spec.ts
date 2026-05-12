import {
  CanActivate,
  ExecutionContext,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DbUserRequestContext } from '../common/request-context';
import { ROLES_KEY } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { USER_ROLES } from '../common/user-roles';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: {
    getMe: jest.Mock;
    getMyPermissions: jest.Mock;
    exportMyData: jest.Mock;
    deleteMyData: jest.Mock;
  };

  const dbUser: DbUserRequestContext = {
    id: 'user-1',
    cognitoId: 'cognito-sub-1',
    tenantId: 'tenant-1',
    siteId: null,
    siteIds: ['site-2', 'site-1'],
    role: 'area_manager',
  };

  beforeEach(() => {
    usersService = {
      getMe: jest.fn(),
      getMyPermissions: jest.fn(),
      exportMyData: jest.fn(),
      deleteMyData: jest.fn(),
    };

    controller = new UsersController(
      usersService as unknown as UsersService,
    );
  });

  it('wires GET /users/me/permissions behind JwtAuthGuard and RolesGuard', () => {
    const handler = UsersController.prototype.getMyPermissions;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'me/permissions',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(USER_ROLES);
  });

  it('returns 401 for GET /users/me/permissions without auth', () => {
    expect(() =>
      new TestJwtAuthGuard().canActivate(
        executionContext({ headers: {} }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('returns current actor permissions for GET /users/me/permissions with auth', async () => {
    const request = {
      headers: { authorization: 'Bearer valid-token' },
    } as any;

    expect(
      new TestJwtAuthGuard().canActivate(executionContext(request)),
    ).toBe(true);
    expect(
      new TestRolesGuard().canActivate(executionContext(request)),
    ).toBe(true);

    usersService.getMyPermissions.mockResolvedValueOnce({
      role: 'area_manager',
      capabilities: ['users.create', 'users.list'],
      scope: {
        kind: 'sites',
        tenantId: 'tenant-1',
        siteIds: ['site-1', 'site-2'],
      },
      isPlatformAdmin: false,
    });

    await expect(
      controller.getMyPermissions(request),
    ).resolves.toEqual({
      role: 'area_manager',
      capabilities: ['users.create', 'users.list'],
      scope: {
        kind: 'sites',
        tenantId: 'tenant-1',
        siteIds: ['site-1', 'site-2'],
      },
      isPlatformAdmin: false,
    });

    expect(usersService.getMyPermissions).toHaveBeenCalledWith(dbUser);
  });

  class TestJwtAuthGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest();

      if (request.headers.authorization !== 'Bearer valid-token') {
        throw new UnauthorizedException();
      }

      request.user = { sub: dbUser.cognitoId };
      return true;
    }
  }

  class TestRolesGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      context.switchToHttp().getRequest().dbUser = dbUser;
      return true;
    }
  }
});

function executionContext(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
