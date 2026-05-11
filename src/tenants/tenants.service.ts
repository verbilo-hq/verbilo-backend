import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import {
  isReservedSubdomain,
  isValidSlug,
  normalizeSlug,
} from '../common/slug';
import { Route53DomainsClient } from '../integrations/aws/route53.client';
import { VercelDomainsClient } from '../integrations/vercel/vercel-domains.client';
import { PrismaService } from '../prisma/prisma.service';

const ENABLED_MODULE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

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

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly vercelDomains: VercelDomainsClient,
    private readonly route53Domains: Route53DomainsClient,
  ) {}

  async createTenant(input: CreateTenantInput, actorUserId?: string) {
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
        actorUserId,
        tenantId: tenant.id,
        action: 'tenant.created',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          name: tenant.name,
          slug: tenant.slug,
          sector: tenant.sector,
          enabledModules: tenant.enabledModules,
        },
      });

      try {
        const result = await this.vercelDomains.provisionTenantDomain(
          tenant.slug,
          'main',
        );

        await this.audit.record({
          actorUserId,
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
          actorUserId,
          tenantId: tenant.id,
          action: 'tenant.domain.provision_failed',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: {
            hostname,
            error: message,
          } as Prisma.InputJsonValue,
        });
      }

      try {
        const result = await this.route53Domains.createTenantCname(tenant.slug);

        await this.audit.record({
          actorUserId,
          tenantId: tenant.id,
          action: 'tenant.dns.created',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: {
            outcome: result,
          } as Prisma.InputJsonValue,
        });
      } catch (error) {
        const hostname = this.route53Domains.hostnameForSlug(tenant.slug);
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Route 53 CNAME create failed for ${hostname}: ${message}`,
        );

        await this.audit.record({
          actorUserId,
          tenantId: tenant.id,
          action: 'tenant.dns.create_failed',
          entityType: 'tenant',
          entityId: tenant.id,
          payload: {
            hostname,
            error: message,
          } as Prisma.InputJsonValue,
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
    actorUserId?: string,
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
      actorUserId,
      tenantId: updatedTenant.id,
      action: 'tenant.settings.updated',
      entityType: 'tenant',
      entityId: updatedTenant.id,
      payload: { diff } as Prisma.InputJsonValue,
    });

    return this.withTenantUrl(updatedTenant);
  }

  async deleteTenant(id: string, actorUserId?: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

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
          actorUserId,
          tenantId: tenant.id,
          action: 'tenant.deleted',
          entityType: 'tenant',
          entityId: tenant.id,
          payloadJson: { snapshot } as Prisma.InputJsonValue,
        },
      });

      await tx.tenant.delete({ where: { id } });
    });

    try {
      const result = await this.route53Domains.removeTenantCname(tenant.slug);

      await this.audit.record({
        actorUserId,
        action: 'tenant.dns.removed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          outcome: result,
          slug: tenant.slug,
        } as Prisma.InputJsonValue,
      });
    } catch (error) {
      const hostname = this.route53Domains.hostnameForSlug(tenant.slug);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Route 53 CNAME removal failed for ${hostname}: ${message}`,
      );

      await this.audit.record({
        actorUserId,
        action: 'tenant.dns.remove_failed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          hostname,
          slug: tenant.slug,
          error: message,
        } as Prisma.InputJsonValue,
      });
    }

    try {
      const result = await this.vercelDomains.removeTenantDomain(tenant.slug);

      await this.audit.record({
        actorUserId,
        action: 'tenant.domain.removed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: {
          outcome: result,
          slug: tenant.slug,
        } as Prisma.InputJsonValue,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Vercel domain removal failed for ${tenant.slug}: ${message}`,
      );

      await this.audit.record({
        actorUserId,
        action: 'tenant.domain.remove_failed',
        entityType: 'tenant',
        entityId: tenant.id,
        payload: { slug: tenant.slug, error: message } as Prisma.InputJsonValue,
      });
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
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return tenant;
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
