import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CapabilityGuard } from '../common/capability.guard';
import { CAPABILITIES } from '../common/capabilities';
import { DbUserRequestContext } from '../common/request-context';
import { RequiresCapability } from '../common/requires-capability.decorator';
import { RolesGuard } from '../common/roles.guard';
import {
  DocumentsService,
  type DocumentUploadFile,
} from './documents.service';
import { ListDocumentsDto } from './dto/list-documents.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

type DocumentRequest = Request & {
  dbUser: DbUserRequestContext;
};

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard, CapabilityGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  @RequiresCapability(CAPABILITIES.DOCUMENTS_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Body() body: UploadDocumentDto,
    @UploadedFile() file: DocumentUploadFile | undefined,
    @Req() request: DocumentRequest,
  ) {
    return this.documents.upload(body, file, request.dbUser);
  }

  @Get()
  @RequiresCapability(CAPABILITIES.DOCUMENTS_LIST)
  list(
    @Query() query: ListDocumentsDto,
    @Req() request: DocumentRequest,
  ) {
    return this.documents.list(query, request.dbUser);
  }

  @Get(':id/download')
  @RequiresCapability(CAPABILITIES.DOCUMENTS_LIST)
  getDownloadUrl(
    @Param('id') id: string,
    @Req() request: DocumentRequest,
  ) {
    return this.documents.getDownloadUrl(id, request.dbUser);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresCapability(CAPABILITIES.DOCUMENTS_DELETE)
  softDelete(
    @Param('id') id: string,
    @Req() request: DocumentRequest,
  ): Promise<void> {
    return this.documents.softDelete(id, request.dbUser);
  }
}
