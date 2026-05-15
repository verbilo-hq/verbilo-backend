import {
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { type DbUserRequestContext } from '../common/request-context';
import { DocumentsService, type DocumentUploadFile } from './documents.service';

describe('DocumentsService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const uploaderId = '33333333-3333-4333-8333-333333333333';
  const siteOneId = '55555555-5555-4555-8555-555555555555';
  const siteTwoId = '66666666-6666-4666-8666-666666666666';
  const documentId = '77777777-7777-4777-8777-777777777777';
  const now = new Date('2026-05-15T10:00:00.000Z');

  function service() {
    const prisma = {
      document: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const s3Docs = {
      uploadObject: jest.fn(),
      deleteObject: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
    };

    return {
      prisma,
      s3Docs,
      documentsService: new DocumentsService(prisma as never, s3Docs as never),
    };
  }

  function dbUser(
    role: DbUserRequestContext['role'],
    overrides: Partial<DbUserRequestContext> = {},
  ): DbUserRequestContext {
    return {
      id: uploaderId,
      cognitoId: 'cognito-sub-1',
      tenantId,
      siteId: null,
      siteIds: [],
      role,
      ...overrides,
    };
  }

  function file(overrides: Partial<DocumentUploadFile> = {}): DocumentUploadFile {
    return {
      buffer: Buffer.from('pdf'),
      size: 1024,
      mimetype: 'application/pdf',
      originalname: 'Policy Pack #1.pdf',
      ...overrides,
    };
  }

  function document(overrides = {}) {
    return {
      id: documentId,
      tenantId,
      uploaderId,
      title: 'Policy Pack',
      category: 'hr-policy',
      visibilityScope: 'site',
      scopeSiteIds: [siteOneId],
      s3Key: `tenants/${tenantId}/documents/${documentId}/Policy_Pack__1.pdf`,
      fileName: 'Policy Pack #1.pdf',
      mimeType: 'application/pdf',
      byteSize: 1024,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists company-wide and assigned-site documents for site-scoped callers', async () => {
    const { prisma, documentsService } = service();

    prisma.document.findMany.mockResolvedValue([
      document({ visibilityScope: 'company', scopeSiteIds: [] }),
      document({
        id: '88888888-8888-4888-8888-888888888888',
        scopeSiteIds: [siteOneId],
      }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: uploaderId,
        username: 'uploader',
        displayName: 'Uploader User',
      },
    ]);

    const result = await documentsService.list(
      { limit: 20 },
      dbUser('employee', { siteIds: [siteOneId] }),
    );

    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { tenantId },
          { deletedAt: null },
          {
            OR: [
              { visibilityScope: 'company' },
              { scopeSiteIds: { hasSome: [siteOneId] } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].uploader).toEqual({
      id: uploaderId,
      username: 'uploader',
      displayName: 'Uploader User',
    });
    expect(result.nextCursor).toBeNull();
  });

  it('lists tenant documents without visibility filter for tenant-wide callers', async () => {
    const { prisma, documentsService } = service();

    prisma.document.findMany.mockResolvedValue([]);
    prisma.user.findMany.mockResolvedValue([]);

    await documentsService.list(
      { limit: 20, category: 'clinical-protocol' },
      dbUser('company_admin'),
    );

    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { tenantId },
          { deletedAt: null },
          { category: 'clinical-protocol' },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 21,
    });
  });

  it('requires platform callers to pass tenantId for list', async () => {
    const { documentsService } = service();

    await expect(
      documentsService.list(
        { limit: 20 },
        dbUser('verbilo_support', { tenantId: null }),
      ),
    ).rejects.toThrow('tenantId is required for platform admins');
  });

  it('rejects site-scoped uploads outside the actor site assignments', async () => {
    const { documentsService } = service();

    await expect(
      documentsService.upload(
        {
          title: 'Policy Pack',
          category: 'hr-policy',
          visibilityScope: 'site',
          scopeSiteIds: [siteTwoId],
        },
        file(),
        dbUser('practice_manager', { siteIds: [siteOneId] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unsupported upload MIME types', async () => {
    const { documentsService } = service();

    await expect(
      documentsService.upload(
        {
          title: 'Policy Pack',
          category: 'hr-policy',
          visibilityScope: 'company',
        },
        file({ mimetype: 'text/plain' }),
        dbUser('company_admin'),
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects uploads larger than 50 MB', async () => {
    const { documentsService } = service();

    await expect(
      documentsService.upload(
        {
          title: 'Policy Pack',
          category: 'hr-policy',
          visibilityScope: 'company',
        },
        file({ size: 50 * 1024 * 1024 + 1 }),
        dbUser('company_admin'),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('returns 503 and does not create a row when S3 is not configured', async () => {
    const { prisma, s3Docs, documentsService } = service();

    s3Docs.uploadObject.mockResolvedValue({ kind: 's3-not-configured' });

    await expect(
      documentsService.upload(
        {
          title: 'Policy Pack',
          category: 'hr-policy',
          visibilityScope: 'company',
        },
        file(),
        dbUser('company_admin'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(prisma.document.create).not.toHaveBeenCalled();
  });

  it('uploads to a sanitised S3 key and creates the document row', async () => {
    const { prisma, s3Docs, documentsService } = service();

    s3Docs.uploadObject.mockResolvedValue({ kind: 'uploaded', key: 'key' });
    prisma.document.create.mockImplementation(({ data }) =>
      Promise.resolve(document(data)),
    );
    prisma.user.findUnique.mockResolvedValue({
      id: uploaderId,
      username: 'uploader',
      displayName: 'Uploader User',
    });

    const result = await documentsService.upload(
      {
        title: 'Policy Pack',
        category: 'hr-policy',
        visibilityScope: 'site',
        scopeSiteIds: [siteOneId],
      },
      file(),
      dbUser('practice_manager', { siteIds: [siteOneId] }),
    );

    const uploadArg = s3Docs.uploadObject.mock.calls[0][0];
    expect(uploadArg.key).toMatch(
      /^tenants\/11111111-1111-4111-8111-111111111111\/documents\/[0-9a-f-]+\/Policy_Pack__1\.pdf$/,
    );
    expect(prisma.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        uploaderId,
        title: 'Policy Pack',
        category: 'hr-policy',
        visibilityScope: 'site',
        scopeSiteIds: [siteOneId],
        s3Key: uploadArg.key,
        fileName: 'Policy Pack #1.pdf',
        mimeType: 'application/pdf',
        byteSize: 1024,
      }),
    });
    expect(result.uploader).toEqual({
      id: uploaderId,
      username: 'uploader',
      displayName: 'Uploader User',
    });
  });

  it('soft-deletes the document without deleting the S3 object', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    const { prisma, s3Docs, documentsService } = service();

    prisma.document.findFirst.mockResolvedValue(document());
    prisma.document.update.mockResolvedValue(document({ deletedAt: now }));

    await documentsService.softDelete(documentId, dbUser('company_admin'));

    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: documentId },
      data: { deletedAt: now },
    });
    expect(s3Docs.deleteObject).not.toHaveBeenCalled();
  });

  it('returns 404 for download when the caller cannot see the document', async () => {
    const { prisma, documentsService } = service();

    prisma.document.findFirst.mockResolvedValue(
      document({ scopeSiteIds: [siteTwoId] }),
    );

    await expect(
      documentsService.getDownloadUrl(
        documentId,
        dbUser('employee', { siteIds: [siteOneId] }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
