import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { DbUserRequestContext, TenantRequestContext } from './request-context';
import { RolesGuard } from './roles.guard';

type RoleTestRequest = {
  user?: Partial<CognitoJwtPayload>;
  tenant?: TenantRequestContext;
  actingInTenant?: TenantRequestContext;
};

type DbUserRow = Omit<DbUserRequestContext, 'siteIds'> & {
  siteAssignments: { siteId: string }[];
};

describe('RolesGuard', () => {
  let reflectorGetAllAndOverride: jest.Mock;
  let userFindFirst: jest.Mock;
  let guard: RolesGuard;

  beforeEach(() => {
    reflectorGetAllAndOverride = jest.fn();
    userFindFirst = jest.fn();

    const reflector = {
      getAllAndOverride: reflectorGetAllAndOverride,
    } as unknown as Reflector;

    const prisma = {
      user: { findFirst: userFindFirst },
    } as unknown as PrismaService;

    guard = new RolesGuard(reflector, prisma);
  });

  function createContext(request: unknown): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  function dbUser(
    role: DbUserRequestContext['role'],
    tenantId: string | null,
  ): DbUserRow {
    return {
      id: `${role}-id`,
      cognitoId: 'cognito-sub',
      tenantId,
      siteId: null,
      role,
      siteAssignments: [],
    };
  }

  function tenant(id: string): TenantRequestContext {
    return {
      id,
      slug: `${id.toLowerCase()}-slug`,
      name: `${id} tenant`,
      sector: 'dental',
      enabledModules: [],
    };
  }

  it('allows routes with no role metadata', async () => {
    reflectorGetAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createContext({}))).resolves.toBe(true);
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('rejects requests with missing cognito sub', async () => {
    reflectorGetAllAndOverride.mockReturnValue(['verbilo_support']);

    await expect(guard.canActivate(createContext({ user: {} }))).resolves.toBe(
      false,
    );
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('queries only non-deleted users (deletedAt:null)', async () => {
    reflectorGetAllAndOverride.mockReturnValue(['verbilo_support']);
    userFindFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(createContext({ user: { sub: 'cognito-sub' } })),
    ).resolves.toBe(false);

    expect(userFindFirst).toHaveBeenCalledWith({
      where: { cognitoId: 'cognito-sub', deletedAt: null },
      select: {
        id: true,
        cognitoId: true,
        tenantId: true,
        siteId: true,
        role: true,
        siteAssignments: { select: { siteId: true } },
      },
    });
  });

  it('allows users whose role matches', async () => {
    reflectorGetAllAndOverride.mockReturnValue(['verbilo_support']);
    userFindFirst.mockResolvedValue({
      id: 'user-id',
      cognitoId: 'cognito-sub',
      tenantId: null,
      siteId: null,
      role: 'verbilo_support',
      siteAssignments: [],
    });

    await expect(
      guard.canActivate(createContext({ user: { sub: 'cognito-sub' } })),
    ).resolves.toBe(true);
  });

  it('rejects customer users scoping requests to a different tenant', async () => {
    reflectorGetAllAndOverride.mockReturnValue(undefined);
    userFindFirst.mockResolvedValue(dbUser('practice_manager', 'A'));

    await expect(
      guard.canActivate(
        createContext({
          user: { sub: 'cognito-sub' },
          tenant: tenant('B'),
        }),
      ),
    ).rejects.toThrow(
      new ForbiddenException('cannot scope request to a different tenant'),
    );
  });

  it('allows platform admins to act in a resolved tenant context', async () => {
    reflectorGetAllAndOverride.mockReturnValue(undefined);
    const requestTenant = tenant('B');
    const request: RoleTestRequest = {
      user: { sub: 'cognito-sub' },
      tenant: requestTenant,
    };
    userFindFirst.mockResolvedValue(dbUser('verbilo_super_admin', null));

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.actingInTenant).toBe(requestTenant);
  });

  it('allows customer users when the resolved tenant matches their tenant', async () => {
    reflectorGetAllAndOverride.mockReturnValue(undefined);
    const request: RoleTestRequest = {
      user: { sub: 'cognito-sub' },
      tenant: tenant('A'),
    };
    userFindFirst.mockResolvedValue(dbUser('practice_manager', 'A'));

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request).not.toHaveProperty('actingInTenant');
  });

  it('does not run a cross-tenant check when no tenant context is resolved', async () => {
    reflectorGetAllAndOverride.mockReturnValue(undefined);
    const request: RoleTestRequest = { user: { sub: 'cognito-sub' } };
    userFindFirst.mockResolvedValue(dbUser('practice_manager', 'A'));

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request).not.toHaveProperty('actingInTenant');
  });

  it('skips db user loading for anonymous requests without role metadata', async () => {
    reflectorGetAllAndOverride.mockReturnValue(undefined);

    await expect(
      guard.canActivate(createContext({ tenant: tenant('B') })),
    ).resolves.toBe(true);
    expect(userFindFirst).not.toHaveBeenCalled();
  });
});
