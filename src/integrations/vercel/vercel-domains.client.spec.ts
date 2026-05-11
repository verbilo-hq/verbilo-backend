import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { VercelDomainsClient } from './vercel-domains.client';

describe('VercelDomainsClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = jest.fn() as unknown as typeof globalThis.fetch;
  });

  function createClient(env: Partial<Env>) {
    const configService = {
      get: (key: string) => (env as Record<string, unknown>)[key],
    } as unknown as ConfigService<Env, true>;

    return new VercelDomainsClient(configService);
  }

  it('disables auto-provision for staging base domains', () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'staging.verbilo.co.uk',
      VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'project',
    });

    expect(client.isAutoProvisionEnabled()).toBe(false);
  });

  it('disables auto-provision when API token is unset', () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      VERCEL_PROJECT_ID: 'project',
    });

    expect(client.isAutoProvisionEnabled()).toBe(false);
  });

  it('enables auto-provision when configured for prod', () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'project',
    });

    expect(client.isAutoProvisionEnabled()).toBe(true);
  });

  it('skips provisioning when auto-provision is disabled', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
    });

    await expect(client.provisionTenantDomain('acme', 'main')).resolves.toEqual({
      status: 'skipped',
      hostname: 'acme.verbilo.co.uk',
      reason: 'vercel-not-configured',
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('POSTs the Vercel domain provision request with auth headers', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'project',
    });

    (globalThis.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ verified: true }), { status: 200 }),
    );

    await expect(client.provisionTenantDomain('acme', 'main')).resolves.toMatchObject(
      {
        status: 'provisioned',
        hostname: 'acme.verbilo.co.uk',
        verified: true,
      },
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v10/projects/project/domains',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
        // VER-55: gitBranch intentionally omitted — Vercel rejects
        // gitBranch:"main" on production domains with
        // cannot_set_production_branch_as_preview.
        body: JSON.stringify({ name: 'acme.verbilo.co.uk' }),
      }),
    );
  });

  it('returns already-exists for 409 conflicts', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'project',
    });

    (globalThis.fetch as jest.Mock).mockResolvedValue(new Response('', { status: 409 }));

    await expect(client.provisionTenantDomain('acme', 'main')).resolves.toEqual({
      status: 'already-exists',
      hostname: 'acme.verbilo.co.uk',
    });
  });

  it('throws with the Vercel error code and message for non-200 responses', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'project',
    });

    (globalThis.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'forbidden', message: 'nope' } }),
        { status: 401, statusText: 'Unauthorized' },
      ),
    );

    await expect(client.provisionTenantDomain('acme', 'main')).rejects.toThrow(
      'Vercel provision failed (forbidden): nope',
    );
  });

  it('issues a DELETE request to remove a tenant domain', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'project',
    });

    (globalThis.fetch as jest.Mock).mockResolvedValue(new Response('', { status: 200 }));

    await expect(client.removeTenantDomain('acme')).resolves.toEqual({
      status: 'removed',
      hostname: 'acme.verbilo.co.uk',
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v10/projects/project/domains/acme.verbilo.co.uk',
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }),
    );
  });

  it('appends teamId when configured', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      VERCEL_API_TOKEN: 'token',
      VERCEL_PROJECT_ID: 'project',
      VERCEL_TEAM_ID: 'team-id',
    });

    (globalThis.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ verified: false }), { status: 200 }),
    );

    await client.provisionTenantDomain('acme', 'main');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.vercel.com/v10/projects/project/domains?teamId=team-id',
      expect.anything(),
    );
  });
});
