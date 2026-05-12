import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { CognitoJwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { DbUserRequestContext } from './request-context';
import { ROLES_KEY } from './roles.decorator';
import { isUserRole, UserRole } from './user-roles';

type RoleGuardRequest = Request & {
  user?: CognitoJwtPayload;
  dbUser?: DbUserRequestContext;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RoleGuardRequest>();
    const cognitoId = request.user?.sub;

    if (!cognitoId) {
      return false;
    }

    const dbUser = request.dbUser ?? (await this.findDbUser(cognitoId));

    if (!dbUser) {
      return false;
    }

    request.dbUser = dbUser;

    return requiredRoles.includes(dbUser.role);
  }

  private async findDbUser(
    cognitoId: string,
  ): Promise<DbUserRequestContext | undefined> {
    const dbUser = await this.prisma.user.findFirst({
      where: { cognitoId, deletedAt: null },
      select: {
        id: true,
        cognitoId: true,
        tenantId: true,
        siteId: true,
        role: true,
        siteAssignments: { select: { siteId: true } },
      },
    });

    if (!dbUser || !dbUser.cognitoId || !isUserRole(dbUser.role)) {
      return undefined;
    }

    return {
      id: dbUser.id,
      cognitoId: dbUser.cognitoId,
      tenantId: dbUser.tenantId,
      siteId: dbUser.siteId,
      role: dbUser.role,
      siteIds: dbUser.siteAssignments.map((assignment) => assignment.siteId),
    };
  }
}
