import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from './roles.guard';

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

  function createContext(request: any): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
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
});
