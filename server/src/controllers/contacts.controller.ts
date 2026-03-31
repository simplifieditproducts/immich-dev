import { Controller, Delete, Get, HttpCode, HttpStatus, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import { ContactsResponseDto } from 'src/dtos/contacts.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { ContactsService } from 'src/services/contacts.service';
import { asStreamableFile } from 'src/utils/file';

@ApiTags(ApiTag.Contacts)
@Controller('contacts')
export class ContactsController {
  constructor(private service: ContactsService) {}

  @Put()
  @Authenticated({ permission: Permission.ContactUpload })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Upload contacts backup',
    description: 'Upload a VCF file containing contacts data. Replaces any existing contacts backup.',
    history: new HistoryBuilder().added('v1'),
  })
  async uploadContacts(@Auth() auth: AuthDto, @Req() req: Request): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const data = Buffer.concat(chunks);
    await this.service.upload(auth, data);
  }

  @Get()
  @Authenticated({ permission: Permission.ContactRead })
  @ApiOkResponse({ type: ContactsResponseDto })
  @Endpoint({
    summary: 'Retrieve contacts',
    description:
      'Retrieve the contacts backup. Returns parsed JSON by default, or the raw VCF file when raw=true.',
    history: new HistoryBuilder().added('v1'),
  })
  async getContacts(
    @Auth() auth: AuthDto,
    @Query('raw') raw?: string,
  ): Promise<ContactsResponseDto | StreamableFile> {
    const isRaw = raw !== undefined && raw !== 'false' && raw !== '0';
    const result = await this.service.get(auth, isRaw);

    if ('stream' in result) {
      return asStreamableFile(result);
    }

    return result;
  }

  @Delete()
  @Authenticated({ permission: Permission.ContactDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete contacts backup',
    description: 'Delete the contacts backup file from the server.',
    history: new HistoryBuilder().added('v1'),
  })
  async deleteContacts(@Auth() auth: AuthDto): Promise<void> {
    await this.service.remove(auth);
  }
}
