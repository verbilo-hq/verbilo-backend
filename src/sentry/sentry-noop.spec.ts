describe('Sentry instrument', () => {
  const originalSentryDsn = process.env.SENTRY_DSN;

  afterEach(() => {
    if (originalSentryDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalSentryDsn;
    }
  });

  it('loads without throwing when SENTRY_DSN is unset', () => {
    delete process.env.SENTRY_DSN;

    expect(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../instrument');
      });
    }).not.toThrow();
  });
});

