import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { Route53DomainsClient } from './route53.client';

jest.mock(
  '@aws-sdk/client-route-53',
  () => {
    const send = jest.fn();

    return {
      Route53Client: jest.fn(() => ({ send })),
      ChangeResourceRecordSetsCommand: jest.fn((input: unknown) => ({ input })),
      send,
    };
  },
  { virtual: true },
);

const route53Mocks = jest.requireMock('@aws-sdk/client-route-53') as {
  Route53Client: jest.Mock;
  ChangeResourceRecordSetsCommand: jest.Mock;
  send: jest.Mock;
};

describe('Route53DomainsClient', () => {
  beforeEach(() => {
    route53Mocks.send.mockReset();
    route53Mocks.Route53Client.mockClear();
    route53Mocks.ChangeResourceRecordSetsCommand.mockClear();
  });

  function createClient(env: Partial<Env>) {
    const configService = {
      get: (key: string) => (env as Record<string, unknown>)[key],
    } as unknown as ConfigService<Env, true>;

    return new Route53DomainsClient(configService);
  }

  it('disables auto-provision for staging base domains even when configured', () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'staging.verbilo.co.uk',
      R53_HOSTED_ZONE_ID: 'zone-id',
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    expect(client.isAutoProvisionEnabled()).toBe(false);
  });

  it.each([
    [
      'hosted zone id',
      { AWS_ACCESS_KEY_ID: 'key', AWS_SECRET_ACCESS_KEY: 'secret' },
    ],
    [
      'access key',
      { R53_HOSTED_ZONE_ID: 'zone-id', AWS_SECRET_ACCESS_KEY: 'secret' },
    ],
    ['secret key', { R53_HOSTED_ZONE_ID: 'zone-id', AWS_ACCESS_KEY_ID: 'key' }],
  ])('disables auto-provision when %s is unset', (_label, env) => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      ...env,
    });

    expect(client.isAutoProvisionEnabled()).toBe(false);
  });

  it('enables auto-provision when configured for prod', () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      R53_HOSTED_ZONE_ID: 'zone-id',
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    expect(client.isAutoProvisionEnabled()).toBe(true);
    expect(route53Mocks.Route53Client).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'access-key-id',
        secretAccessKey: 'secret-access-key',
      },
    });
  });

  it('skips create paths when auto-provision is disabled', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
    });

    await expect(client.createTenantCname('acme')).resolves.toEqual({
      status: 'skipped',
      hostname: 'acme.verbilo.co.uk',
      reason: 'route53-not-configured',
    });

    expect(route53Mocks.send).not.toHaveBeenCalled();
    expect(route53Mocks.ChangeResourceRecordSetsCommand).not.toHaveBeenCalled();
  });

  it('skips staging paths without AWS calls', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'staging.verbilo.co.uk',
      R53_HOSTED_ZONE_ID: 'zone-id',
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    await expect(client.createTenantCname('acme')).resolves.toEqual({
      status: 'skipped',
      hostname: 'acme.staging.verbilo.co.uk',
      reason: 'staging-ns-delegated',
    });

    expect(route53Mocks.send).not.toHaveBeenCalled();
    expect(route53Mocks.ChangeResourceRecordSetsCommand).not.toHaveBeenCalled();
  });

  it('issues an UPSERT with the right hostname, target, and TTL', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      R53_HOSTED_ZONE_ID: 'zone-id',
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    route53Mocks.send.mockResolvedValue({ ChangeInfo: { Id: '/change/C123' } });

    await expect(client.createTenantCname('acme')).resolves.toEqual({
      status: 'created',
      hostname: 'acme.verbilo.co.uk',
      changeId: '/change/C123',
    });

    expect(route53Mocks.ChangeResourceRecordSetsCommand).toHaveBeenCalledWith({
      HostedZoneId: 'zone-id',
      ChangeBatch: {
        Comment: 'VER-55: tenant upsert for acme.verbilo.co.uk',
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: 'acme.verbilo.co.uk',
              Type: 'CNAME',
              TTL: 300,
              ResourceRecords: [
                { Value: '39bd255adbcb8100.vercel-dns-017.com.' },
              ],
            },
          },
        ],
      },
    });
    expect(route53Mocks.send).toHaveBeenCalledWith({
      input: expect.objectContaining({ HostedZoneId: 'zone-id' }),
    });
  });

  it('issues a DELETE for removals', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      R53_HOSTED_ZONE_ID: 'zone-id',
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    route53Mocks.send.mockResolvedValue({ ChangeInfo: { Id: '/change/C456' } });

    await expect(client.removeTenantCname('acme')).resolves.toEqual({
      status: 'removed',
      hostname: 'acme.verbilo.co.uk',
      changeId: '/change/C456',
    });

    expect(route53Mocks.ChangeResourceRecordSetsCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ChangeBatch: expect.objectContaining({
          Changes: [
            expect.objectContaining({
              Action: 'DELETE',
            }),
          ],
        }),
      }),
    );
  });

  it('returns not-found for DELETE when the record is already gone', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      R53_HOSTED_ZONE_ID: 'zone-id',
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    route53Mocks.send.mockRejectedValue(
      new Error(
        'InvalidChangeBatch: Tried to delete resource record set but it was not found',
      ),
    );

    await expect(client.removeTenantCname('acme')).resolves.toEqual({
      status: 'not-found',
      hostname: 'acme.verbilo.co.uk',
    });
  });

  it('throws with the AWS message for non-recoverable errors', async () => {
    const client = createClient({
      TENANT_BASE_DOMAIN: 'verbilo.co.uk',
      R53_HOSTED_ZONE_ID: 'zone-id',
      AWS_ACCESS_KEY_ID: 'access-key-id',
      AWS_SECRET_ACCESS_KEY: 'secret-access-key',
    });

    route53Mocks.send.mockRejectedValue(new Error('AccessDenied'));

    await expect(client.createTenantCname('acme')).rejects.toThrow(
      'Route 53 UPSERT failed: AccessDenied',
    );
  });
});
