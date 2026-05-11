import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestLoggerMiddleware.name);

  use(request: Request, response: Response, next: NextFunction) {
    const headerValue = request.headers['x-request-id'];
    const existingRequestId = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;
    const requestId =
      typeof existingRequestId === 'string' && existingRequestId.trim()
        ? existingRequestId.trim()
        : randomUUID();

    response.setHeader('x-request-id', requestId);

    const method = request.method;
    const path = request.originalUrl ?? request.url;
    const startedAt = Date.now();

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      const status = response.statusCode;

      this.logger.log(
        JSON.stringify({
          type: 'request',
          method,
          path,
          status,
          durationMs,
          requestId,
        }),
      );
    });

    next();
  }
}

