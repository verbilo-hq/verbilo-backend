import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { RequestLoggerMiddleware } from './request-logger.middleware';

describe('RequestLoggerMiddleware', () => {
  it('generates x-request-id, echoes it back, and logs on finish', () => {
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const middleware = new RequestLoggerMiddleware();
    const request = {
      method: 'GET',
      originalUrl: '/users/me',
      headers: {},
    } as any;

    const emitter = new EventEmitter();
    const response = Object.assign(emitter, {
      statusCode: 200,
      setHeader: jest.fn(),
      on: emitter.on.bind(emitter),
    }) as any;

    const next = jest.fn();
    middleware.use(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.setHeader).toHaveBeenCalledTimes(1);

    const [headerName, requestId] = response.setHeader.mock.calls[0];
    expect(headerName).toBe('x-request-id');
    expect(typeof requestId).toBe('string');
    expect(requestId.length).toBeGreaterThan(0);

    response.emit('finish');

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logPayload = JSON.parse(logSpy.mock.calls[0][0]);
    expect(logPayload).toMatchObject({
      type: 'request',
      method: 'GET',
      path: '/users/me',
      status: 200,
      requestId,
    });
    expect(typeof logPayload.durationMs).toBe('number');

    logSpy.mockRestore();
  });
});

