import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { type Capability, hasCapability } from './capabilities';
import { type DbUserRequestContext } from './request-context';
import { REQUIRES_CAPABILITY_KEY } from './requires-capability.decorator';
import { type UserRole } from './user-roles';

type GuardRequest = Request & { dbUser?: DbUserRequestContext };

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const capability = this.reflector.getAllAndOverride<
      Capability | undefined
    >(REQUIRES_CAPABILITY_KEY, [context.getHandler(), context.getClass()]);

    if (!capability) return true;

    const req = context.switchToHttp().getRequest<GuardRequest>();
    const dbUser = req.dbUser;
    if (!dbUser) {
      throw new ForbiddenException('Actor unresolved');
    }

    if (!hasCapability(dbUser.role as UserRole, capability)) {
      throw new ForbiddenException(
        `Role ${dbUser.role} lacks capability ${capability}`,
      );
    }

    return true;
  }
}
