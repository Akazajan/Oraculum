import {
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, seconds } from '@nestjs/throttler';
import { ContactService } from './contact.service';
import { SubmitContactDto } from './dto/submit-contact.dto';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorDto } from '../common/dto/api-error.dto';

type AnyRequest = { ip?: string; headers?: Record<string, unknown> };

@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Public()
  @Throttle({ contact: { ttl: seconds(60), limit: 5 } })
  @Post()
  @ApiOperation({ summary: 'Submit a contact-form message' })
  async submit(@Body() dto: SubmitContactDto, @Req() req: AnyRequest) {
    const ip = this.getClientIp(req);
    return this.contactService.submit(dto, ip);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Import contact records from a CSV or text file' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async importContacts(
    @UploadedFile() file: Express.Multer.File,
    @Body() body?: { source?: string },
  ) {
    return this.contactService.importContacts(file, body?.source);
  }

  private getClientIp(req: AnyRequest): string | null {
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
    return req.ip ?? null;
  }
}
