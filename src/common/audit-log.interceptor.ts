import type { Request } from 'express';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuditService } from '../audit/audit.service';
import type { CognitoJwtPayload } from '../auth/jwt.strategy';
import type {
  ActingInTenantContext,
  DbUserRequestContext,
  TenantRequestContext,
} from './request-context';
import { SKIP_AUDIT_LOG_KEY } from './skip-audit-log.decorator';

type AuditRequest = Omit<Request, 'route'> & {
  user?: CognitoJwtPayload;
  tenant?: TenantRequestContext;
  actingInTenant?: ActingInTenantContext;
  dbUser?: DbUserRequestContext;
  route?: {
    path?: unknown;
  };
};

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skipAuditLog = this.reflector.getAllAndOverride<boolean>(
      SKIP_AUDIT_LOG_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipAuditLog) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuditRequest>();

    if (!MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      mergeMap(async (responseBody: unknown) => {
        await this.tryRecord(request, responseBody);
        return responseBody;
      }),
    );
  }

  private async tryRecord(request: AuditRequest, responseBody: unknown) {
    try {
      const route = this.getAuditRoute(request);
      const action = `${request.method.toLowerCase()}.${route}`;
      const entityType = this.getEntityType(route);
      const entityId = this.getEntityId(responseBody);
      const actorUserId = request.dbUser?.id ?? request.user?.sub ?? null;
      const tenantId = request.tenant?.id ?? null;

      await this.audit.record({
        action,
        entityType,
        entityId: entityId ?? undefined,
        actorUserId: actorUserId ?? undefined,
        tenantId: tenantId ?? undefined,
        payload: this.buildPayload(request),
      });
    } catch {
      // Never crash the request path for audit logging failures.
    }
  }

  private buildPayload(request: AuditRequest): Prisma.InputJsonObject {
    if (!request.actingInTenant) {
      return {};
    }

    return {
      actorIsPlatformAdmin: true,
      actingInTenantSlug: request.actingInTenant.slug,
      actingInTenantName: request.actingInTenant.name,
    };
  }

  private getAuditRoute(request: AuditRequest): string {
    const routePath = request.route?.path;

    if (typeof routePath === 'string') {
      return this.normalizePath(`${request.baseUrl ?? ''}${routePath}`);
    }

    return this.normalizePath(request.path ?? request.originalUrl ?? '');
  }

  private normalizePath(path: string): string {
    const withoutQuery = path.split('?')[0];
    return withoutQuery.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  private getEntityType(route: string): string {
    const segments = route.split('/').filter(Boolean);
    const candidate = segments.length > 1 ? segments[1] : segments[0];
    return candidate ?? 'unknown';
  }

  private getEntityId(responseBody: unknown): string | null {
    if (
      responseBody &&
      typeof responseBody === 'object' &&
      'id' in responseBody
    ) {
      const id = (responseBody as { id?: unknown }).id;
      return typeof id === 'string' ? id : null;
    }

    return null;
  }
}
