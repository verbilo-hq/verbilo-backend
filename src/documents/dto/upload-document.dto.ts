import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export const DOCUMENT_VISIBILITY_SCOPES = ['company', 'site'] as const;

export type DocumentVisibilityScope =
  (typeof DOCUMENT_VISIBILITY_SCOPES)[number];

export class UploadDocumentDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(100)
  category!: string;

  @IsString()
  @IsIn(DOCUMENT_VISIBILITY_SCOPES)
  visibilityScope!: DocumentVisibilityScope;

  @IsOptional()
  @IsUUID('4', { each: true })
  scopeSiteIds?: string | string[];

  @IsOptional()
  @IsUUID('4', { each: true })
  ['scopeSiteIds[]']?: string | string[];
}
