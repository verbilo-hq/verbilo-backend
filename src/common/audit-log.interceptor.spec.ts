import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { AuditLogInterceptor } from './audit-log.interceptor';

describe('AuditLogInterceptor', () => {
  const makeContext = (request: any): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as unknown as ExecutionContext;

  const makeHandler = (value: unknown): CallHandler =>
    ({
      handle: () => of(value),
    }) as unknown as CallHandler;

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'records audit log for %s',
    async (method) => {
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const interceptor = new AuditLogInterceptor(audit as any);

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
    const interceptor = new AuditLogInterceptor(audit as any);

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
    const interceptor = new AuditLogInterceptor(audit as any);

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
});

