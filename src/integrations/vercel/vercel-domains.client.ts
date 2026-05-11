import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';

@Injectable()
export class VercelDomainsClient {
  private readonly logger = new Logger(VercelDomainsClient.name);
  private readonly baseDomain: string;
  private readonly apiToken?: string;
  private readonly projectId?: string;
  private readonly teamId?: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseDomain = config.get('TENANT_BASE_DOMAIN', { infer: true });
    this.apiToken = config.get('VERCEL_API_TOKEN', { infer: true });
    this.projectId = config.get('VERCEL_PROJECT_ID', { infer: true });
    this.teamId = config.get('VERCEL_TEAM_ID', { infer: true });
  }

  /** Returns the full hostname for a tenant: e.g. `acme.verbilo.co.uk`. */
  hostnameForSlug(slug: string): string {
    return `${slug}.${this.baseDomain}`;
  }

  /**
   * True iff this backend is configured to talk to Vercel and the base
   * domain is the production zone. Staging (`*.staging.verbilo.co.uk`) is
   * wildcard-covered so this returns false there, even if a token is set.
   */
  isAutoProvisionEnabled(): boolean {
    return Boolean(this.apiToken && this.projectId) && !this.isStagingDomain();
  }

  private isStagingDomain(): boolean {
    return this.baseDomain.startsWith('staging.');
  }

  /**
   * Provision `{slug}.{baseDomain}` on the Vercel project as a production
   * domain. We only reach this code path on prod (the staging path
   * short-circuits via `isAutoProvisionEnabled` since the wildcard cert
   * already covers `*.staging.verbilo.co.uk`), so the domain is always
   * registered against the project's production branch.
   *
   * The `branch` parameter is accepted for forward-compat but intentionally
   * NOT sent to Vercel — Vercel rejects `gitBranch: "main"` on prod domains
   * with `cannot_set_production_branch_as_preview`. Production domains on
   * Vercel ride the project's default production branch implicitly with
   * `gitBranch: null` (confirmed by inspecting the existing prod domains
   * `admin.verbilo.co.uk`, `www.verbilo.co.uk`, `verbilo.co.uk`). See
   * VER-55 for the regression history.
   *
   * Returns a structured outcome rather than throwing for "domain already
   * exists" — the caller wants to know if it was already there, not blow up
   * the tenant create flow over an idempotent re-run.
   *
   * Throws for unrecoverable API errors (auth fail, network down, 5xx).
   */
  async provisionTenantDomain(
    slug: string,
    _branch: 'main' | 'dev' = 'main',
  ): Promise<VercelProvisionResult> {
    const hostname = this.hostnameForSlug(slug);

    if (!this.isAutoProvisionEnabled()) {
      const reason = this.isStagingDomain()
        ? 'staging-wildcard-covered'
        : 'vercel-not-configured';
      this.logger.log(
        `Skipping Vercel domain provision for ${hostname}: ${reason}`,
      );
      return { status: 'skipped', hostname, reason };
    }

    const url = this.buildUrl(`/v10/projects/${this.projectId}/domains`);
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      // Body intentionally omits `gitBranch` — see method docstring + VER-55.
      body: JSON.stringify({ name: hostname }),
    });

    if (response.status === 409) {
      this.logger.log(`Vercel domain already exists: ${hostname}`);
      return { status: 'already-exists', hostname };
    }

    if (!response.ok) {
      const errBody = await safeReadJson(response);
      const errCode = errBody?.error?.code ?? `http_${response.status}`;
      const errMessage = errBody?.error?.message ?? response.statusText;
      throw new Error(`Vercel provision failed (${errCode}): ${errMessage}`);
    }

    const body = await response.json();
    this.logger.log(
      `Vercel domain provisioned: ${hostname} (verified=${String(body?.verified)})`,
    );
    return {
      status: 'provisioned',
      hostname,
      verified: Boolean(body?.verified),
      vercelDomain: body,
    };
  }

  /**
   * Remove a tenant's Vercel domain (for archive/delete flows).
   * Returns { status: 'skipped' | 'removed' | 'not-found' }.
   */
  async removeTenantDomain(slug: string): Promise<VercelRemovalResult> {
    const hostname = this.hostnameForSlug(slug);

    if (!this.isAutoProvisionEnabled()) {
      return { status: 'skipped', hostname };
    }

    const url = this.buildUrl(
      `/v10/projects/${this.projectId}/domains/${encodeURIComponent(hostname)}`,
    );
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers(),
    });

    if (response.status === 404) {
      return { status: 'not-found', hostname };
    }

    if (!response.ok) {
      const errBody = await safeReadJson(response);
      const errCode = errBody?.error?.code ?? `http_${response.status}`;
      const errMessage = errBody?.error?.message ?? response.statusText;
      throw new Error(`Vercel remove failed (${errCode}): ${errMessage}`);
    }

    return { status: 'removed', hostname };
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiToken}`,
    };
  }

  private buildUrl(path: string): string {
    const url = new URL(`https://api.vercel.com${path}`);
    if (this.teamId) {
      url.searchParams.set('teamId', this.teamId);
    }
    return url.toString();
  }
}

async function safeReadJson(res: Response): Promise<any | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export type VercelProvisionResult =
  | {
      status: 'provisioned';
      hostname: string;
      verified: boolean;
      vercelDomain: unknown;
    }
  | { status: 'already-exists'; hostname: string }
  | {
      status: 'skipped';
      hostname: string;
      reason: 'staging-wildcard-covered' | 'vercel-not-configured';
    };

export type VercelRemovalResult =
  | { status: 'removed'; hostname: string }
  | { status: 'not-found'; hostname: string }
  | { status: 'skipped'; hostname: string };
