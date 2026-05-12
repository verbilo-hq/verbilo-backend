import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantRequestContext, TenantSlugSource } from './request-context';
import { isReservedSubdomain, isValidSlug, normalizeSlug } from './slug';

const VERBILO_DOMAIN = 'verbilo.co.uk';
const VERBILO_DOMAIN_SUFFIX = `.${VERBILO_DOMAIN}`;

type TenantContextRequest = Request & {
  tenant?: TenantRequestContext;
  tenantSlugSource?: TenantSlugSource;
};

type TenantSlugResolution = {
  slug: string;
  source: TenantSlugSource;
};

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  async use(
    request: TenantContextRequest,
    _response: Response,
    next: NextFunction,
  ) {
    const tenantSlug = this.getTenantSlug(request);

    if (
      !tenantSlug ||
      isReservedSubdomain(tenantSlug.slug) ||
      !isValidSlug(tenantSlug.slug)
    ) {
      next();
      return;
    }

    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: tenantSlug.slug },
        select: {
          id: true,
          slug: true,
          name: true,
          sector: true,
          enabledModules: true,
        },
      });

      if (tenant) {
        request.tenant = tenant;
        request.tenantSlugSource = tenantSlug.source;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown tenant context error';
      this.logger.warn(`Tenant context lookup failed: ${message}`);
    }

    next();
  }

  private getTenantSlug(request: Request): TenantSlugResolution | undefined {
    const headerSlug = request.header('x-tenant-slug');

    if (headerSlug) {
      return { slug: normalizeSlug(headerSlug), source: 'header' };
    }

    const hostSlug = this.getSlugFromHost(request.header('host'));
    return hostSlug ? { slug: hostSlug, source: 'host' } : undefined;
  }

  private getSlugFromHost(hostHeader: string | undefined): string | undefined {
    if (!hostHeader) {
      return undefined;
    }

    const host = hostHeader.split(':')[0].toLowerCase();

    if (!host.endsWith(VERBILO_DOMAIN_SUFFIX)) {
      return undefined;
    }

    const subdomain = host.slice(0, -VERBILO_DOMAIN_SUFFIX.length);

    if (!subdomain || subdomain.includes('.')) {
      return undefined;
    }

    return normalizeSlug(subdomain);
  }
}
