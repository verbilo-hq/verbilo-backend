import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ChangeResourceRecordSetsCommand,
  type ChangeAction,
  Route53Client as AwsRoute53Client,
} from '@aws-sdk/client-route-53';
import type { Env } from '../../config/env.schema';

const VERCEL_CNAME_TARGET = '39bd255adbcb8100.vercel-dns-017.com.';

@Injectable()
export class Route53DomainsClient {
  private readonly logger = new Logger(Route53DomainsClient.name);
  private readonly baseDomain: string;
  private readonly hostedZoneId?: string;
  private readonly accessKeyId?: string;
  private readonly secretAccessKey?: string;
  private readonly client?: AwsRoute53Client;

  constructor(config: ConfigService<Env, true>) {
    this.baseDomain = config.get('TENANT_BASE_DOMAIN', { infer: true });
    this.hostedZoneId = config.get('R53_HOSTED_ZONE_ID', { infer: true });
    this.accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
    this.secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', {
      infer: true,
    });

    if (this.hostedZoneId && this.accessKeyId && this.secretAccessKey) {
      this.client = new AwsRoute53Client({
        region: 'us-east-1',
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
      });
    }
  }

  hostnameForSlug(slug: string): string {
    return `${slug}.${this.baseDomain}`;
  }

  isAutoProvisionEnabled(): boolean {
    return Boolean(this.client) && !this.isStagingDomain();
  }

  async createTenantCname(slug: string): Promise<R53Result> {
    return this.upsertCname(slug, 'UPSERT');
  }

  async removeTenantCname(slug: string): Promise<R53Result> {
    return this.upsertCname(slug, 'DELETE');
  }

  private isStagingDomain(): boolean {
    return this.baseDomain.startsWith('staging.');
  }

  private async upsertCname(
    slug: string,
    action: ChangeAction,
  ): Promise<R53Result> {
    const hostname = this.hostnameForSlug(slug);
    if (!this.isAutoProvisionEnabled()) {
      const reason = this.isStagingDomain()
        ? 'staging-ns-delegated'
        : 'route53-not-configured';
      this.logger.log(`Skipping R53 ${action} for ${hostname}: ${reason}`);
      return { status: 'skipped', hostname, reason };
    }

    try {
      const response = await this.client!.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: this.hostedZoneId!,
          ChangeBatch: {
            Comment: `VER-55: tenant ${action.toLowerCase()} for ${hostname}`,
            Changes: [
              {
                Action: action,
                ResourceRecordSet: {
                  Name: hostname,
                  Type: 'CNAME',
                  TTL: 300,
                  ResourceRecords: [{ Value: VERCEL_CNAME_TARGET }],
                },
              },
            ],
          },
        }),
      );
      const changeId = response.ChangeInfo?.Id ?? null;
      this.logger.log(`R53 ${action} for ${hostname}: changeId=${changeId}`);
      return {
        status: action === 'DELETE' ? 'removed' : 'created',
        hostname,
        changeId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        action === 'DELETE' &&
        /not found|InvalidChangeBatch/i.test(message)
      ) {
        this.logger.log(`R53 DELETE for ${hostname}: record already gone`);
        return { status: 'not-found', hostname };
      }

      throw new Error(`Route 53 ${action} failed: ${message}`);
    }
  }
}

export type R53Result =
  | { status: 'created'; hostname: string; changeId: string | null }
  | { status: 'removed'; hostname: string; changeId: string | null }
  | { status: 'not-found'; hostname: string }
  | {
      status: 'skipped';
      hostname: string;
      reason: 'staging-ns-delegated' | 'route53-not-configured';
    };
