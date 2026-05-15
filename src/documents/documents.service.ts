import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { type DbUserRequestContext } from '../common/request-context';
import { PLATFORM_ROLES } from '../common/user-roles';
import { S3DocsClient } from '../integrations/aws/s3-docs.client';
import { PrismaService } from '../prisma/prisma.service';
import { ListDocumentsDto } from './dto/list-documents.dto';
import {
  DOCUMENT_VISIBILITY_SCOPES,
  type DocumentVisibilityScope,
  UploadDocumentDto,
} from './dto/upload-document.dto';

export type DocumentUploadFile = {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
};

export type DocumentReadDto = {
  id: string;
  tenantId: string;
  title: string;
  category: string;
  visibilityScope: DocumentVisibilityScope;
  scopeSiteIds: string[];
  fileName: string;
  mimeType: string;
  byteSize: number;
  createdAt: Date;
  updatedAt: Date;
  uploader: {
    id: string;
    username: string;
    displayName: string;
  } | null;
};

export type ListDocumentsResponseDto = {
  items: DocumentReadDto[];
  nextCursor: string | null;
};

export type DownloadDocumentResponseDto = {
  url: string;
  expiresAt: string;
};

type DocumentCursor = {
  createdAt: string;
  id: string;
};

type DocumentUploader = {
  id: string;
  username: string;
  displayName: string;
};

const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
const SIGNED_DOWNLOAD_EXPIRY_SECONDS = 300;
const TENANT_WIDE_ROLES = new Set(['company_owner', 'company_admin']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);

@Injectable()
export class DocumentsService {
  private readonly uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Docs: S3DocsClient,
  ) {}

  async upload(
    dto: UploadDocumentDto,
    file: DocumentUploadFile | undefined,
    dbUser: DbUserRequestContext,
  ): Promise<DocumentReadDto> {
    if (!file) {
      throw new BadRequestException('Document file is required');
    }

    if (file.size > DOCUMENT_MAX_BYTES) {
      throw new PayloadTooLargeException(
        'Document file must be 50 MB or smaller',
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new UnsupportedMediaTypeException('Unsupported document format');
    }

    const tenantId = this.requireActorTenantId(dbUser);
    const title = this.readRequiredString(dto.title, 'title');
    const category = this.readRequiredString(dto.category, 'category');
    const visibilityScope = this.readVisibilityScope(dto.visibilityScope);
    const scopeSiteIds = this.normaliseAndValidateScope(
      visibilityScope,
      this.readScopeSiteIds(dto),
      dbUser,
    );
    const documentId = randomUUID();
    const fileName = file.originalname || 'document';
    const key = `tenants/${tenantId}/documents/${documentId}/${this.sanitiseFileName(fileName)}`;

    const uploadResult = await this.s3Docs.uploadObject({
      key,
      body: file.buffer,
      contentType: file.mimetype,
      contentDisposition: this.contentDisposition(fileName),
    });

    if (uploadResult.kind === 's3-not-configured') {
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'Document storage is not configured',
      });
    }

    const document = await this.prisma.document.create({
      data: {
        id: documentId,
        tenantId,
        uploaderId: dbUser.id,
        title,
        category,
        visibilityScope,
        scopeSiteIds,
        s3Key: key,
        fileName,
        mimeType: file.mimetype,
        byteSize: file.size,
      },
    });
    const uploader = await this.findUploader(dbUser.id);

    return this.toReadDto(document, uploader);
  }

  async list(
    query: ListDocumentsDto,
    dbUser: DbUserRequestContext,
  ): Promise<ListDocumentsResponseDto> {
    const limit = query.limit ?? 20;
    const tenantId = this.resolveListTenantId(query, dbUser);
    const filters: Prisma.DocumentWhereInput[] = [
      { tenantId },
      { deletedAt: null },
    ];

    if (query.category) {
      filters.push({ category: query.category });
    }

    const visibilityFilter = this.visibilityFilterForActor(dbUser);
    if (visibilityFilter) {
      filters.push(visibilityFilter);
    }

    if (query.cursor) {
      filters.push(this.cursorFilter(this.decodeCursor(query.cursor)));
    }

    const rows = await this.prisma.document.findMany({
      where: { AND: filters },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const uploaders = await this.findUploaders(items);
    const nextCursor =
      hasNextPage && items.length > 0
        ? this.encodeCursor(items[items.length - 1])
        : null;

    return {
      items: items.map((item) =>
        this.toReadDto(
          item,
          item.uploaderId ? (uploaders.get(item.uploaderId) ?? null) : null,
        ),
      ),
      nextCursor,
    };
  }

  async getDownloadUrl(
    id: string,
    dbUser: DbUserRequestContext,
  ): Promise<DownloadDocumentResponseDto> {
    const document = await this.findVisibleDocument(id, dbUser);
    const expiresAt = new Date(
      Date.now() + SIGNED_DOWNLOAD_EXPIRY_SECONDS * 1000,
    ).toISOString();
    const url = await this.s3Docs.getSignedDownloadUrl(document.s3Key, {
      fileName: document.fileName,
      expiresInSeconds: SIGNED_DOWNLOAD_EXPIRY_SECONDS,
    });

    if (!url) {
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: 'Document storage is not configured',
      });
    }

    return { url, expiresAt };
  }

  async softDelete(
    id: string,
    dbUser: DbUserRequestContext,
  ): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (!this.isPlatformAdmin(dbUser)) {
      const tenantId = this.requireActorTenantId(dbUser);
      if (document.tenantId !== tenantId) {
        throw new ForbiddenException('Document belongs to another tenant');
      }
    }

    await this.prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private async findVisibleDocument(
    id: string,
    dbUser: DbUserRequestContext,
  ): Promise<Document> {
    const document = await this.prisma.document.findFirst({
      where: { id, deletedAt: null },
    });

    if (!document || !this.canSeeDocument(document, dbUser)) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  private canSeeDocument(
    document: Document,
    dbUser: DbUserRequestContext,
  ): boolean {
    if (this.isPlatformAdmin(dbUser)) {
      return true;
    }

    const tenantId = this.requireActorTenantId(dbUser);
    if (document.tenantId !== tenantId) {
      return false;
    }

    if (TENANT_WIDE_ROLES.has(dbUser.role)) {
      return true;
    }

    if (document.visibilityScope === 'company') {
      return true;
    }

    const actorSiteIds = this.actorSiteIds(dbUser);
    return document.scopeSiteIds.some((siteId) =>
      actorSiteIds.includes(siteId),
    );
  }

  private requireActorTenantId(dbUser: DbUserRequestContext): string {
    if (!dbUser.tenantId) {
      throw new ForbiddenException('Document access requires tenant');
    }
    return dbUser.tenantId;
  }

  private resolveListTenantId(
    query: ListDocumentsDto,
    dbUser: DbUserRequestContext,
  ): string {
    if (this.isPlatformAdmin(dbUser)) {
      if (!query.tenantId) {
        throw new BadRequestException('tenantId is required for platform admins');
      }
      return query.tenantId;
    }

    if (query.tenantId) {
      throw new BadRequestException('tenantId is only available to platform admins');
    }

    return this.requireActorTenantId(dbUser);
  }

  private visibilityFilterForActor(
    dbUser: DbUserRequestContext,
  ): Prisma.DocumentWhereInput | null {
    if (this.isPlatformAdmin(dbUser) || TENANT_WIDE_ROLES.has(dbUser.role)) {
      return null;
    }

    const siteIds = this.actorSiteIds(dbUser);
    return {
      OR: [
        { visibilityScope: 'company' },
        ...(siteIds.length > 0
          ? [{ scopeSiteIds: { hasSome: siteIds } }]
          : []),
      ],
    };
  }

  private normaliseAndValidateScope(
    visibilityScope: DocumentVisibilityScope,
    scopeSiteIds: string[],
    dbUser: DbUserRequestContext,
  ): string[] {
    const siteIds = [...new Set(scopeSiteIds)];

    if (visibilityScope === 'company') {
      return [];
    }

    if (siteIds.length !== 1) {
      throw new BadRequestException('site documents must target exactly one site');
    }

    if (!this.isPlatformAdmin(dbUser) && !TENANT_WIDE_ROLES.has(dbUser.role)) {
      const actorSiteIds = this.actorSiteIds(dbUser);
      const outsideActorScope = siteIds.some(
        (siteId) => !actorSiteIds.includes(siteId),
      );

      if (outsideActorScope) {
        throw new ForbiddenException('Document site scope exceeds actor scope');
      }
    }

    return siteIds;
  }

  private readRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }

  private readVisibilityScope(value: unknown): DocumentVisibilityScope {
    if (
      typeof value !== 'string' ||
      !DOCUMENT_VISIBILITY_SCOPES.includes(value as DocumentVisibilityScope)
    ) {
      throw new BadRequestException('visibilityScope must be company or site');
    }

    return value as DocumentVisibilityScope;
  }

  private readScopeSiteIds(dto: UploadDocumentDto): string[] {
    const rawValues = [
      dto.scopeSiteIds,
      (dto as unknown as Record<string, unknown>)['scopeSiteIds[]'],
    ];

    return rawValues.flatMap((value) => {
      if (Array.isArray(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim() !== '') {
        return [value];
      }
      return [];
    });
  }

  private actorSiteIds(dbUser: DbUserRequestContext): string[] {
    return dbUser.siteIds.length > 0
      ? dbUser.siteIds
      : dbUser.siteId
        ? [dbUser.siteId]
        : [];
  }

  private isPlatformAdmin(dbUser: DbUserRequestContext): boolean {
    return PLATFORM_ROLES.has(dbUser.role);
  }

  private async findUploaders(
    items: Document[],
  ): Promise<Map<string, DocumentUploader>> {
    const uploaderIds = [
      ...new Set(
        items
          .map((item) => item.uploaderId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    if (!uploaderIds.length) {
      return new Map();
    }

    const uploaders = await this.prisma.user.findMany({
      where: { id: { in: uploaderIds } },
      select: { id: true, username: true, displayName: true },
    });

    return new Map(uploaders.map((uploader) => [uploader.id, uploader]));
  }

  private async findUploader(id: string): Promise<DocumentUploader | null> {
    const uploader = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true },
    });

    return uploader ?? null;
  }

  private cursorFilter(cursor: {
    createdAt: Date;
    id: string;
  }): Prisma.DocumentWhereInput {
    return {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }

  private decodeCursor(cursor: string): {
    createdAt: Date;
    id: string;
  } {
    let parsed: Partial<DocumentCursor> | null;

    try {
      parsed = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8'),
      ) as Partial<DocumentCursor> | null;
    } catch {
      throw new BadRequestException('Invalid document cursor');
    }

    if (
      !parsed ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new BadRequestException('Invalid document cursor');
    }

    const createdAt = new Date(parsed.createdAt);

    if (
      Number.isNaN(createdAt.getTime()) ||
      !this.uuidPattern.test(parsed.id)
    ) {
      throw new BadRequestException('Invalid document cursor');
    }

    return { createdAt, id: parsed.id };
  }

  private encodeCursor(item: Document): string {
    return Buffer.from(
      JSON.stringify({
        createdAt: item.createdAt.toISOString(),
        id: item.id,
      }),
    ).toString('base64');
  }

  private sanitiseFileName(fileName: string): string {
    const sanitised = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
    return sanitised || 'document';
  }

  private contentDisposition(fileName: string): string {
    const escaped = fileName
      .replace(/[\r\n]/g, '_')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    return `attachment; filename="${escaped}"`;
  }

  private toReadDto(
    document: Document,
    uploader: DocumentUploader | null,
  ): DocumentReadDto {
    return {
      id: document.id,
      tenantId: document.tenantId,
      title: document.title,
      category: document.category,
      visibilityScope: document.visibilityScope as DocumentVisibilityScope,
      scopeSiteIds: document.scopeSiteIds,
      fileName: document.fileName,
      mimeType: document.mimeType,
      byteSize: document.byteSize,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      uploader,
    };
  }
}
