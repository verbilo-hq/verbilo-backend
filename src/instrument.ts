/**
 * Sentry must be initialized before any other imports which may be instrumented.
 *
 * Note: We intentionally avoid importing optional profiling support here to keep
 * dependencies light. Error capture is the must-have; performance/profiling can
 * be added later if needed.
 */

if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Sentry = require('@sentry/nestjs');

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.NODE_ENV ?? process.env.RENDER_SERVICE_TYPE ?? 'unknown',
    release: process.env.RENDER_GIT_COMMIT ?? undefined,
  });
}

