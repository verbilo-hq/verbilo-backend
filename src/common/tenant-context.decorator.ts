import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { TenantRequestContext } from './request-context';

export const TenantContext = createParamDecorator(
  (
    _data: unknown,
    context: ExecutionContext,
  ): TenantRequestContext | undefined => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { tenant?: TenantRequestContext }>();

    return request.tenant;
  },
);
