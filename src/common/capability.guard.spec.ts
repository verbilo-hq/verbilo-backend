import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CAPABILITIES } from './capabilities';
import { CapabilityGuard } from './capability.guard';

function executionContext(dbUser?: { role: string }) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ dbUser }),
    }),
  } as any;
}

describe('CapabilityGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: CapabilityGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new CapabilityGuard(reflector as unknown as Reflector);
  });

  it('returns true when no capability metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(executionContext())).toBe(true);
  });

  it('passes when the actor role has the required capability', () => {
    reflector.getAllAndOverride.mockReturnValue(CAPABILITIES.TENANT_CREATE);

    expect(
      guard.canActivate(
        executionContext({ role: 'verbilo_super_admin' }),
      ),
    ).toBe(true);
  });

  it('throws when the actor role lacks the required capability', () => {
    reflector.getAllAndOverride.mockReturnValue(CAPABILITIES.TENANT_DELETE);

    expect(() =>
      guard.canActivate(executionContext({ role: 'verbilo_support' })),
    ).toThrow(
      new ForbiddenException(
        'Role verbilo_support lacks capability tenant.delete',
      ),
    );
  });

  it('throws when a capability endpoint has no resolved actor', () => {
    reflector.getAllAndOverride.mockReturnValue(CAPABILITIES.USERS_LIST);

    expect(() => guard.canActivate(executionContext())).toThrow(
      new ForbiddenException('Actor unresolved'),
    );
  });
});
