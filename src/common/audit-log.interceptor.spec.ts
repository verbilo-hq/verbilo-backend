import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { of, throwError } from 'rxjs';
import { AuditService } from '../audit/audit.service';
import { AuditLogInterceptor } from './audit-log.interceptor';

type AuditTestRequest = Partial<Request> & {
  method: string;
  baseUrl?: string;
  route?: {
    path?: string;
  };
  user?: {
    sub: string;
  };
  tenant?: {
    id: string;
  };
  actingInTenant?: {
    id: string;
    slug: string;
    name: string;
    sector: string;
    enabledModules: string[];
  };
};

describe('AuditLogInterceptor', () => {
  const makeContext = (request: AuditTestRequest): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  const makeHandler = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'records audit log for %s',
    async (method) => {
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
      const interceptor = new AuditLogInterceptor(
        audit as unknown as AuditService,
        reflector as unknown as Reflector,
      );

      const request = {
        method,
        baseUrl: '/admin/tenants',
        route: { path: '/' },
        user: { sub: 'cognito-sub' },
        tenant: { id: 'tenant-id' },
      };

      await new Promise<void>((resolve, reject) => {
        interceptor
          .intercept(makeContext(request), makeHandler({ id: 'entity-id' }))
          .subscribe({
            next: () => resolve(),
            error: reject,
          });
      });

      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: `${method.toLowerCase()}.admin/tenants`,
          entityType: 'tenants',
          entityId: 'entity-id',
          actorUserId: 'cognito-sub',
          tenantId: 'tenant-id',
          payload: {},
        }),
      );
    },
  );

  it('does not record for GET requests', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const interceptor = new AuditLogInterceptor(
      audit as unknown as AuditService,
      reflector as unknown as Reflector,
    );

    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(
          makeContext({
            method: 'GET',
            baseUrl: '/admin/tenants',
            route: { path: '/' },
          }),
          makeHandler({ id: 'entity-id' }),
        )
        .subscribe({
          next: () => resolve(),
          error: reject,
        });
    });

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('does not record when handler throws', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const interceptor = new AuditLogInterceptor(
      audit as unknown as AuditService,
      reflector as unknown as Reflector,
    );

    const context = makeContext({
      method: 'POST',
      baseUrl: '/admin/tenants',
      route: { path: '/' },
    });

    const handler: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    await expect(
      new Promise<void>((resolve, reject) => {
        interceptor.intercept(context, handler).subscribe({
          next: () => resolve(),
          error: reject,
        });
      }),
    ).rejects.toThrow('boom');

    expect(audit.record).not.toHaveBeenCalled();
  });

  it('adds platform-admin acting tenant context to the audit payload', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    const interceptor = new AuditLogInterceptor(
      audit as unknown as AuditService,
      reflector as unknown as Reflector,
    );

    const request = {
      method: 'POST',
      baseUrl: '/admin/users',
      route: { path: '/' },
      user: { sub: 'cognito-sub' },
      tenant: { id: 'tenant-id' },
      actingInTenant: {
        id: 'tenant-id',
        slug: 'riverside-vets',
        name: 'Riverside Vets',
        sector: 'vets',
        enabledModules: [],
      },
    };

    await new Promise<void>((resolve, reject) => {
      interceptor
        .intercept(makeContext(request), makeHandler({ id: 'entity-id' }))
        .subscribe({
          next: () => resolve(),
          error: reject,
        });
    });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-id',
        payload: {
          actorIsPlatformAdmin: true,
          actingInTenantSlug: 'riverside-vets',
          actingInTenantName: 'Riverside Vets',
        },
      }),
    );
  });
});
