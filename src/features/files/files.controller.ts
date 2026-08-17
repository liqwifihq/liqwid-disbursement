import { Body, Controller, Headers, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FilesService } from './files.service';
import { requestActor, requireRole } from '../../security/actor';

@Controller('files')
@ApiTags('Files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload and validate a payout CSV' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async uploadFile(@UploadedFile() file?: Express.Multer.File) {
    return this.filesService.parseAndPreview(file);
  }

  @Post('create-batch')
  @ApiOperation({ summary: 'Create a payout batch from validated rows' })
  @ApiHeader({ name: 'x-admin-actor', description: 'Authenticated operator email', required: true })
  @ApiHeader({ name: 'x-admin-role', description: 'Operator role: maker or admin', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'rows'],
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 80, example: 'August vendor payouts' },
        rows: {
          type: 'array',
          maxItems: 5000,
          items: {
            type: 'object',
            required: ['recipient_name', 'recipient_email', 'account_number', 'bank_code', 'amount', 'currency', 'transaction_reference'],
            properties: {
              recipient_name: { type: 'string', example: 'Ada Okafor' },
              recipient_email: { type: 'string', format: 'email', example: 'ada@example.com' },
              account_number: { type: 'string', example: '0123456789', minLength: 10, maxLength: 10, pattern: '^\\d{10}$' },
              bank_code: { type: 'string', example: '058' },
              amount: { type: 'string', example: '5000.00' },
              currency: { type: 'string', example: 'NGN' },
              transaction_reference: { type: 'string', minLength: 3, maxLength: 40, example: 'Salary Payment' },
            },
          },
        },
      },
    },
  })
  async createBatch(
    @Body() body: { name?: string; rows?: Record<string, unknown>[] },
    @Headers('x-admin-actor') actorHeader?: string,
    @Headers('x-admin-role') roleHeader?: string,
  ) {
    const actor = requestActor(actorHeader, roleHeader);
    requireRole(actor, ['maker', 'admin']);
    return this.filesService.createBatch(actor.email, body.rows, body.name);
  }
}
