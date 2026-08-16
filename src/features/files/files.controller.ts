import { Body, Controller, Headers, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { requestActor, requireRole } from '../../security/actor';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async uploadFile(@UploadedFile() file?: Express.Multer.File) {
    return this.filesService.parseAndPreview(file);
  }

  @Post('create-batch')
  async createBatch(
    @Body() body: { rows?: Record<string, unknown>[] },
    @Headers('x-admin-actor') actorHeader?: string,
    @Headers('x-admin-role') roleHeader?: string,
  ) {
    const actor = requestActor(actorHeader, roleHeader);
    requireRole(actor, ['maker', 'admin']);
    return this.filesService.createBatch(actor.email, body.rows);
  }
}
