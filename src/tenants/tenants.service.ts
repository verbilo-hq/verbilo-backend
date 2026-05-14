import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  CAPABILITIES,
  hasCapability,
  type Capability,
} from '../common/capabilities';
import { type DbUserRequestContext } from '../common/request-context';
import { canActOnTarget, resolveActorScope } from '../common/scope';
import {
  isReservedSubdomain,
  isValidSlug,
  normalizeSlug,
} from '../common/slug';
import {
  CognitoAdminClient,
  CognitoUserNotFoundError,
} from '../integrations/aws/cognito-admin.client';
import { Route53DomainsClient } from '../integrations/aws/route53.client';
import { S3Client } from '../integrations/aws/s3.client';
import { VercelDomainsClient } from '../integrations/vercel/vercel-domains.client';
import { PrismaService } from '../prisma/prisma.service';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_CACHE_CONTROL = 'public, max-age=86400';
const TENANT_LOGO_PUBLIC_BASE_URL =
  'https://verbilo-tenant-logos.s3.eu-west-2.amazonaws.com/';
const ENABLED_MODULE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const BRANDING_FIELDS = [
  'logoUrl',
  'primaryColor',
  'secondaryColor',
  'accentColor',
] as const;

type TenantBrandingField = (typeof BRANDING_FIELDS)[number];

type SlugAvailability =
  | { available: true }
  | { available: false; reason: 'invalid' | 'reserved' | 'taken' };

export type CreateTenantInput = {
  name?: unknown;
  slug?: unknown;
  sector?: unknown;
  enabledModules?: unknown;
};

export type UpdateTenantInput = {
  name?: unknown;
  slug?: unknown;
  sector?: unknown;
  enabledModules?: unknown;
  settings?: unknown;
};

export type UpdateTenantBrandingInput = Partial<
  Record<TenantBrandingField, string | null>
>;

export type TenantLogoUploadFile = {
  buffer: Buffer;
  size: number;
};

type LogoImageFormat = {
  ext: 'png' | 'jpg' | 'webp' | 'svg';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
};

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vercelDomains: VercelDomainsClient,
    private readonly route53Domains: Route53DomainsClient,
    private readonly s3: S3Client,
    // VER-76: tenant delete now also tears down Cognito accounts for
    // the tenant's users. Same client we use to create them on the
    // way in.
    private readonly cognitoAdmin: CognitoAdminClient,
  ) {}

  async createTenant(input: CreateTenantInput, actor?: DbUserRequestContext) {
    const name = this.readRequiredString(input.name, 'name');
    const slug = await this.validateNewSlug(input.slug);
    // Defaults to 'healthcare' (sector-agnostic) when none is provided — see
    // VER-47. The CreateTenantDto requires sector at the API boundary; this
    // fallback only fires for non-HTTP callers (e.g. seeds, internal tooling).
    const sector =
      this.readOptionalString(input.sector, 'sector') ?? 'healthcare';
    const enabledModules = this.readEnabledModules(input.enabledModules) ?? [];

    try {
      const tenant = await this.prisma.tenant.create({
        data: {
          name,
          slug,
          sector,
          enabledModules,
        },
      });

      await this.audit.record({
        actorUserId: actor?.id,
        tenantId: tenant.id,
        action: 'tenant.created',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          name: tenant.name,
          slug: tenant.slug,
          sector: tenant.sector,
          enabledModules: tenant.enabledModules,
          ...this.authorizationAuditPayload(actor, CAPABILITIES.TENANT_CREATE, {
            tenantId: tenant.id,
          }),
        } as Prisma.InputJsonValue,
      });

      try {
        const result = await this.vercelDomains.provisionTenantDomain(
          tenant.slug,
          'main',
        );

        await this.audit.record({
          actorUserId: actor?.id,
          tenantId: tenant.id,
          action: 'tenant.domain.provisioned',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: {
            outcome: result,
          } as Prisma.InputJsonValue,
        });
      } catch (error) {
        const hostname = this.vercelDomains.hostnameForSlug(tenant.slug);
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Vercel domain provision failed for ${hostname}: ${message}`,
        );

        await this.audit.record({
          actorUserId: actor?.id,
          tenantId: tenant.id,
          action: 'tenant.domain.provision_failed',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: {
            hostname,
            error: message,
          },
        });
      }

      try {
        const result = await this.route53Domains.createTenantCname(tenant.slug);

        await this.audit.record({
          actorUserId: actor?.id,
          tenantId: tenant.id,
          action: 'tenant.dns.created',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: {
            outcome: result,
          },
        });
      } catch (error) {
        const hostname = this.route53Domains.hostnameForSlug(tenant.slug);
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Route 53 CNAME create failed for ${hostname}: ${message}`,
        );

        await this.audit.record({
          actorUserId: actor?.id,
          tenantId: tenant.id,
          action: 'tenant.dns.create_failed',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: {
            hostname,
            error: message,
          },
        });
      }

      return this.withTenantUrl(tenant);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Tenant slug is already taken');
      }

      throw error;
    }
  }

  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return tenants.map((tenant) => this.withTenantUrl(tenant));
  }

  async checkSlug(rawSlug: string | undefined): Promise<SlugAvailability> {
    const slug = normalizeSlug(rawSlug ?? '');

    if (!isValidSlug(slug)) {
      return { available: false, reason: 'invalid' };
    }

    if (isReservedSubdomain(slug)) {
      return { available: false, reason: 'reserved' };
    }

    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existingTenant) {
      return { available: false, reason: 'taken' };
    }

    return { available: true };
  }

  async getTenant(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return this.withTenantUrl(tenant);
  }

  async updateTenant(
    id: string,
    input: UpdateTenantInput,
    actor?: DbUserRequestContext,
  ) {
    if (input.slug !== undefined) {
      throw new BadRequestException('Tenant slug cannot be changed here');
    }

    const existingTenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!existingTenant) {
      throw new NotFoundException('Tenant not found');
    }

    const data: Prisma.TenantUpdateInput = {};
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    let hasUpdateField = false;

    const name = this.readOptionalString(input.name, 'name');
    if (name !== undefined) {
      hasUpdateField = true;
      if (name !== existingTenant.name) {
        data.name = name;
        diff.name = { from: existingTenant.name, to: name };
      }
    }

    const sector = this.readOptionalString(input.sector, 'sector');
    if (sector !== undefined) {
      hasUpdateField = true;
      if (sector !== existingTenant.sector) {
        // VER-70: sector drives enabledModules defaults + customer-facing
        // UI copy. Restrict edits to verbilo_super_admin so support
        // engineers (or buggy code paths exposing the dropdown) can't
        // accidentally flip a dental tenant to vets and orphan their
        // modules. Other UpdateTenant fields stay open for support.
        if (
          !actor ||
          !hasCapability(actor.role, CAPABILITIES.TENANT_UPDATE_SECTOR)
        ) {
          throw new ForbiddenException(
            'Only verbilo_super_admin can change tenant sector',
          );
        }
        data.sector = sector;
        diff.sector = { from: existingTenant.sector, to: sector };
      }
    }

    const enabledModules = this.readEnabledModules(input.enabledModules);
    if (enabledModules !== undefined) {
      hasUpdateField = true;
      if (
        !this.stringArraysEqual(enabledModules, existingTenant.enabledModules)
      ) {
        data.enabledModules = enabledModules;
        diff.enabledModules = {
          from: existingTenant.enabledModules,
          to: enabledModules,
        };
      }
    }

    const settings = this.readSettings(input.settings);
    if (settings !== undefined) {
      hasUpdateField = true;
      if (!this.jsonEqual(settings, existingTenant.settings)) {
        data.settings = settings as Prisma.InputJsonValue;
        diff.settings = {
          from: existingTenant.settings,
          to: settings,
        };
      }
    }

    if (!hasUpdateField) {
      throw new BadRequestException('No tenant updates provided');
    }

    if (!Object.keys(data).length) {
      return this.withTenantUrl(existingTenant);
    }

    const updatedTenant = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId: updatedTenant.id,
      action: 'tenant.settings.updated',
      entityType: 'tenant',
      entityId: updatedTenant.id,
      payload: {
        diff,
        ...this.authorizationAuditPayload(actor, CAPABILITIES.TENANT_UPDATE, {
          tenantId: updatedTenant.id,
        }),
      } as Prisma.InputJsonValue,
    });

    return this.withTenantUrl(updatedTenant);
  }

  /**
   * Applies tenant branding changes.
   *
   * Undefined fields are unchanged. Null clears that branding field. Empty or
   * whitespace-only strings are treated as "leave unchanged" so frontend forms
   * can submit blank inputs without clearing existing branding accidentally.
   */
  async updateBranding(
    id: string,
    branding: UpdateTenantBrandingInput,
    actor?: DbUserRequestContext,
  ) {
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!existingTenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.assertActorCanActOnTenant(actor, id);

    const data: Prisma.TenantUpdateInput = {};
    const diff: Record<
      TenantBrandingField,
      { from: string | null; to: string | null }
    > = {} as Record<
      TenantBrandingField,
      { from: string | null; to: string | null }
    >;

    for (const field of BRANDING_FIELDS) {
      const value = branding[field];

      if (value === undefined) {
        continue;
      }

      const nextValue = value === null ? null : value.trim();

      if (nextValue === '') {
        continue;
      }

      if (nextValue !== existingTenant[field]) {
        data[field] = nextValue;
        diff[field] = { from: existingTenant[field], to: nextValue };
      }
    }

    if (!Object.keys(diff).length) {
      throw new BadRequestException('No tenant branding changes provided');
    }

    const updatedTenant = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    // VER-77: if logoUrl is changing AND the previous value pointed at
    // a CDN-hosted logo, clean up that S3 object. Covers two flows:
    //   - "Remove" on the branding chip       (from: CDN, to: null)
    //   - Paste an external URL over an upload (from: CDN, to: other)
    // The upload endpoint already deletes the previous CDN key on
    // REPLACE, so a CDN→CDN transition never reaches this branch.
    // Best-effort — don't fail the branding update if S3 misbehaves.
    if (diff.logoUrl && typeof diff.logoUrl.from === 'string') {
      const previousKey = this.s3LogoKeyFromUrl(id, diff.logoUrl.from);
      if (previousKey) {
        try {
          await this.s3.deleteObject({ key: previousKey });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `S3 logo removal failed for ${previousKey} during branding update: ${message}`,
          );
        }
      }
    }

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId: updatedTenant.id,
      action: 'tenant.branding.updated',
      entityType: 'tenant',
      entityId: updatedTenant.id,
      payload: {
        diff,
        ...this.authorizationAuditPayload(
          actor,
          CAPABILITIES.TENANT_UPDATE_BRANDING,
          {
            tenantId: updatedTenant.id,
          },
        ),
      } as Prisma.InputJsonValue,
    });

    return this.withTenantUrl(updatedTenant);
  }

  async uploadLogo(
    id: string,
    file: TenantLogoUploadFile | undefined,
    actor?: DbUserRequestContext,
  ): Promise<{ logoUrl: string }> {
    if (!file) {
      throw new BadRequestException('Logo file is required');
    }

    if (file.size > LOGO_MAX_BYTES) {
      throw new PayloadTooLargeException('Logo file must be 2 MB or smaller');
    }

    const format = this.detectLogoFormat(file.buffer);
    if (!format) {
      throw new UnsupportedMediaTypeException('Unsupported image format');
    }

    const existingTenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: { id: true, logoUrl: true },
    });

    if (!existingTenant) {
      throw new NotFoundException('Tenant not found');
    }

    this.assertActorCanActOnTenant(actor, id);

    const previousKey = this.s3LogoKeyFromUrl(id, existingTenant.logoUrl);
    const key = `tenants/${id}/logo-${Date.now()}.${format.ext}`;
    const uploadResult = await this.s3.uploadObject({
      key,
      body: file.buffer,
      contentType: format.contentType,
      cacheControl: LOGO_CACHE_CONTROL,
    });

    if (uploadResult.kind === 's3-not-configured') {
      throw new ServiceUnavailableException(
        'Tenant logo uploads are not configured',
      );
    }

    await this.prisma.tenant.update({
      where: { id },
      data: { logoUrl: uploadResult.url },
    });

    if (previousKey) {
      try {
        await this.s3.deleteObject({ key: previousKey });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Failed to delete previous tenant logo ${previousKey}: ${message}`,
        );
      }
    }

    await this.audit.record({
      actorUserId: actor?.id,
      tenantId: id,
      action: 'tenant.logo_uploaded',
      entityType: 'tenant',
      entityId: id,
      payload: {
        newKey: key,
        previousKey,
        sizeBytes: file.size,
        contentType: format.contentType,
        ...this.authorizationAuditPayload(
          actor,
          CAPABILITIES.TENANT_UPDATE_BRANDING,
          {
            tenantId: id,
          },
        ),
      } as Prisma.InputJsonValue,
    });

    return { logoUrl: uploadResult.url };
  }

  async deleteTenant(id: string, actor?: DbUserRequestContext): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // VER-76: snapshot Cognito usernames before the cascade removes
    // the User rows — we need them to call AdminDeleteUser after the
    // DB commit. Customer users only; platform admins are tenantId=null
    // and aren't touched by this delete.
    const tenantUsers = await this.prisma.user.findMany({
      where: { tenantId: id },
      select: { username: true },
    });
    const cognitoUsernames = tenantUsers.map((u) => u.username);

    const snapshot = {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      sector: tenant.sector,
      enabledModules: tenant.enabledModules,
      createdAt: tenant.createdAt,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          actorUserId: actor?.id,
          tenantId: tenant.id,
          action: 'tenant.deleted',
          entityType: 'tenant',
          entityId: tenant.id,
          payloadJson: {
            snapshot,
            // VER-76: capture the cohort of Cognito usernames we'll
            // attempt to clean up below. Persisted before the cleanup
            // tries to run so we have a trail even if the process
            // crashes mid-iteration.
            cognitoUsernames,
            ...this.authorizationAuditPayload(
              actor,
              CAPABILITIES.TENANT_DELETE,
              {
                tenantId: tenant.id,
              },
            ),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.tenant.delete({ where: { id } });
    });

    // VER-76: best-effort Cognito cleanup for each of the tenant's
    // customer users. Same pattern as the Vercel + Route53 cleanups
    // below — never throw, since the DB delete has already committed
    // and a failure here would lie about what happened to the caller.
    for (const username of cognitoUsernames) {
      try {
        await this.cognitoAdmin.adminDeleteUser(username);
        await this.audit.record({
          actorUserId: actor?.id,
          action: 'tenant.user.cognito_deleted',
          entityType: 'user',
          entityId: username,
          payload: { username, tenantId: tenant.id },
        });
      } catch (error) {
        // Idempotent: if the Cognito row was already gone (e.g. the
        // user was hard-deleted in a prior session) treat it as a
        // no-op and stay quiet in the audit log.
        if (error instanceof CognitoUserNotFoundError) {
          continue;
        }
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Cognito delete failed for ${username} during tenant delete: ${message}`,
        );
        await this.audit.record({
          actorUserId: actor?.id,
          action: 'tenant.user.cognito_delete_failed',
          entityType: 'user',
          entityId: username,
          payload: { username, tenantId: tenant.id, error: message },
        });
      }
    }

    try {
      const result = await this.route53Domains.removeTenantCname(tenant.slug);

      await this.audit.record({
        actorUserId: actor?.id,
        action: 'tenant.dns.removed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          outcome: result,
          slug: tenant.slug,
        },
      });
    } catch (error) {
      const hostname = this.route53Domains.hostnameForSlug(tenant.slug);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Route 53 CNAME removal failed for ${hostname}: ${message}`,
      );

      await this.audit.record({
        actorUserId: actor?.id,
        action: 'tenant.dns.remove_failed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          hostname,
          slug: tenant.slug,
          error: message,
        },
      });
    }

    try {
      const result = await this.vercelDomains.removeTenantDomain(tenant.slug);

      await this.audit.record({
        actorUserId: actor?.id,
        action: 'tenant.domain.removed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          outcome: result,
          slug: tenant.slug,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Vercel domain removal failed for ${tenant.slug}: ${message}`,
      );

      await this.audit.record({
        actorUserId: actor?.id,
        action: 'tenant.domain.remove_failed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: { slug: tenant.slug, error: message },
      });
    }

    // VER-77: also tear down the tenant's logo from S3 if it lived on
    // our CDN. Best-effort, same pattern as the other external-resource
    // cleanups above. Tenants whose logoUrl was external (or absent)
    // skip silently — s3LogoKeyFromUrl returns null for non-CDN URLs.
    const tenantLogoKey = this.s3LogoKeyFromUrl(tenant.id, tenant.logoUrl);
    if (tenantLogoKey) {
      try {
        await this.s3.deleteObject({ key: tenantLogoKey });
        await this.audit.record({
          actorUserId: actor?.id,
          action: 'tenant.logo.removed',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: { key: tenantLogoKey, slug: tenant.slug },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `S3 logo removal failed for ${tenantLogoKey} during tenant delete: ${message}`,
        );
        await this.audit.record({
          actorUserId: actor?.id,
          action: 'tenant.logo.remove_failed',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: { key: tenantLogoKey, slug: tenant.slug, error: message },
        });
      }
    }
  }

  async getPublicTenantBySlug(rawSlug: string) {
    const slug = normalizeSlug(rawSlug);

    if (!isValidSlug(slug) || isReservedSubdomain(slug)) {
      throw new NotFoundException('Tenant not found');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        sector: true,
        enabledModules: true,
        logoUrl: true,
        primaryColor: true,
        secondaryColor: true,
        accentColor: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
  }

  private assertActorCanActOnTenant(
    actor: DbUserRequestContext | undefined,
    tenantId: string,
  ) {
    if (!actor) {
      throw new ForbiddenException('Actor unresolved');
    }

    const actorScope = resolveActorScope(actor);
    if (!actorScope) {
      throw new ForbiddenException('Actor scope unresolved');
    }

    if (!canActOnTarget(actorScope, { tenantId })) {
      throw new ForbiddenException('Actor scope cannot target tenant');
    }
  }

  private detectLogoFormat(buffer: Buffer): LogoImageFormat | null {
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return { ext: 'png', contentType: 'image/png' };
    }

    if (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return { ext: 'jpg', contentType: 'image/jpeg' };
    }

    if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { ext: 'webp', contentType: 'image/webp' };
    }

    const svgPrefix = buffer
      .toString('utf8', 0, Math.min(buffer.length, 256))
      .trimStart()
      .toLowerCase();

    if (svgPrefix.startsWith('<?xml') || svgPrefix.startsWith('<svg')) {
      return { ext: 'svg', contentType: 'image/svg+xml' };
    }

    return null;
  }

  private s3LogoKeyFromUrl(
    tenantId: string,
    logoUrl: string | null,
  ): string | null {
    const tenantPrefix = `${TENANT_LOGO_PUBLIC_BASE_URL}tenants/${tenantId}/`;
    if (!logoUrl?.startsWith(tenantPrefix)) {
      return null;
    }

    return logoUrl.slice(TENANT_LOGO_PUBLIC_BASE_URL.length);
  }

  private authorizationAuditPayload(
    actor: DbUserRequestContext | undefined,
    capability: Capability,
    targetSnapshot: Record<string, unknown>,
  ) {
    return {
      ...(actor ? { actorRole: actor.role } : {}),
      actorScope: actor ? resolveActorScope(actor) : null,
      capability,
      targetSnapshot,
    };
  }

  private async validateNewSlug(rawSlug: unknown): Promise<string> {
    if (typeof rawSlug !== 'string') {
      throw new BadRequestException('Tenant slug is required');
    }

    const slug = normalizeSlug(rawSlug);

    if (!isValidSlug(slug)) {
      throw new BadRequestException('Tenant slug is invalid');
    }

    if (isReservedSubdomain(slug)) {
      throw new BadRequestException('Tenant slug is reserved');
    }

    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existingTenant) {
      throw new ConflictException('Tenant slug is already taken');
    }

    return slug;
  }

  private readRequiredString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return value.trim();
  }

  private readOptionalString(
    value: unknown,
    fieldName: string,
  ): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${fieldName} must be a non-empty string`);
    }

    return value.trim();
  }

  private readEnabledModules(value: unknown): string[] | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!Array.isArray(value)) {
      throw new BadRequestException('enabledModules must be an array');
    }

    if (value.length > 32) {
      throw new BadRequestException(
        'enabledModules cannot contain more than 32 modules',
      );
    }

    return value.map((moduleName) => {
      if (typeof moduleName !== 'string') {
        throw new BadRequestException('enabledModules values must be strings');
      }

      const trimmedModuleName = moduleName.trim();

      if (!ENABLED_MODULE_PATTERN.test(trimmedModuleName)) {
        throw new BadRequestException(`Invalid enabled module: ${moduleName}`);
      }

      return trimmedModuleName;
    });
  }

  private readSettings(value: unknown): Record<string, unknown> | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('settings must be a JSON object');
    }

    return value as Record<string, unknown>;
  }

  private stringArraysEqual(left: string[], right: string[]) {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    );
  }

  private jsonEqual(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private withTenantUrl<T extends { slug: string }>(tenant: T) {
    return {
      ...tenant,
      url: `https://${this.vercelDomains.hostnameForSlug(tenant.slug)}`,
    };
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
