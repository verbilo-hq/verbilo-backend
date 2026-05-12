import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantRequestContext, TenantSlugSource } from './request-context';
import { TenantContextMiddleware } from './tenant-context.middleware';

type TenantTestRequest = {
  header(name: string): string | undefined;
  tenant?: TenantRequestContext;
  tenantSlugSource?: TenantSlugSource;
};

describe('TenantContextMiddleware', () => {
  let tenantFindUnique: jest.MockedFunction<
    (args: unknown) => Promise<TenantRequestContext | null>
  >;
  let middleware: TenantContextMiddleware;

  beforeEach(() => {
    tenantFindUnique = jest.fn();
    middleware = new TenantContextMiddleware({
      tenant: { findUnique: tenantFindUnique },
    } as unknown as PrismaService);
  });

  function requestWithHeaders(
    headers: Record<string, string>,
  ): TenantTestRequest {
    return {
      header: jest.fn((name: string) => headers[name.toLowerCase()]),
    };
  }

  function tenant(slug: string): TenantRequestContext {
    return {
      id: `${slug}-id`,
      slug,
      name: `${slug} tenant`,
      sector: 'dental',
      enabledModules: [],
    };
  }

  async function run(request: TenantTestRequest) {
    const next = jest.fn();
    await middleware.use(
      request as Parameters<TenantContextMiddleware['use']>[0],
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  }

  it('marks tenant slug source as header when only header is set', async () => {
    const resolvedTenant = tenant('smileco');
    tenantFindUnique.mockResolvedValue(resolvedTenant);
    const request = requestWithHeaders({ 'x-tenant-slug': 'smileco' });

    await run(request);

    expect(tenantFindUnique).toHaveBeenCalledWith({
      where: { slug: 'smileco' },
      select: {
        id: true,
        slug: true,
        name: true,
        sector: true,
        enabledModules: true,
      },
    });
    expect(request.tenant).toBe(resolvedTenant);
    expect(request.tenantSlugSource).toBe('header');
  });

  it('marks tenant slug source as host when only host is set', async () => {
    const resolvedTenant = tenant('riverside-vets');
    tenantFindUnique.mockResolvedValue(resolvedTenant);
    const request = requestWithHeaders({
      host: 'riverside-vets.verbilo.co.uk',
    });

    await run(request);

    expect(tenantFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'riverside-vets' } }),
    );
    expect(request.tenant).toBe(resolvedTenant);
    expect(request.tenantSlugSource).toBe('host');
  });

  it('keeps header precedence when both header and host are set', async () => {
    const resolvedTenant = tenant('smileco');
    tenantFindUnique.mockResolvedValue(resolvedTenant);
    const request = requestWithHeaders({
      'x-tenant-slug': 'SmileCo',
      host: 'riverside-vets.verbilo.co.uk',
    });

    await run(request);

    expect(tenantFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'smileco' } }),
    );
    expect(request.tenant).toBe(resolvedTenant);
    expect(request.tenantSlugSource).toBe('header');
  });
});
