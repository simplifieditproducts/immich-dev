import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Request } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  ContactBulkRequestDto,
  ContactDevicesResponseDto,
  ContactDto,
  ContactsResponseDto,
} from 'src/dtos/contacts.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { ContactsService } from 'src/services/contacts.service';
import { asStreamableFile } from 'src/utils/file';
import { UUIDParamDto } from 'src/validation';

// Synthetic deviceId used by legacy mobile clients that hit `PUT /contacts`
// without a deviceId.
const LEGACY_DEVICE_ID = 'legacy';

class DeviceIdParamDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty()
  deviceId!: string;
}

@ApiTags(ApiTag.Contacts)
@Controller('contacts')
export class ContactsController {
  constructor(private service: ContactsService) {}

  @Put('devices/:deviceId')
  @Authenticated({ permission: Permission.ContactUpload })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Upload contacts from a device',
    description:
      'Upload a VCF file for the given device. Replaces only that device\'s contributions; other devices are unaffected.',
    history: new HistoryBuilder().added('v1'),
  })
  async uploadContacts(
    @Auth() auth: AuthDto,
    @Param() { deviceId }: DeviceIdParamDto,
    @Req() req: Request,
  ): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    await this.service.upload(auth, deviceId, Buffer.concat(chunks));
  }

  // Legacy shim: pre-multi-device mobile clients PUT a VCF directly to
  // `/contacts`. Route those uploads to a synthetic `LEGACY_DEVICE_ID` so they
  // share the same per-device replace semantics as the new endpoint.
  @Put()
  @Authenticated({ permission: Permission.ContactUpload })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiExcludeEndpoint()
  async uploadLegacyContacts(@Auth() auth: AuthDto, @Req() req: Request): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    await this.service.upload(auth, LEGACY_DEVICE_ID, Buffer.concat(chunks));
  }

  @Get('devices')
  @Authenticated({ permission: Permission.ContactRead })
  @ApiOkResponse({ type: ContactDevicesResponseDto })
  @Endpoint({
    summary: 'List devices that have uploaded contacts',
    history: new HistoryBuilder().added('v1'),
  })
  async getDevices(@Auth() auth: AuthDto): Promise<ContactDevicesResponseDto> {
    return this.service.listDevices(auth);
  }

  @Delete('devices/:deviceId')
  @Authenticated({ permission: Permission.ContactDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove all contacts contributed by one device',
    history: new HistoryBuilder().added('v1'),
  })
  async deleteDevice(@Auth() auth: AuthDto, @Param() { deviceId }: DeviceIdParamDto): Promise<void> {
    await this.service.deleteDevice(auth, deviceId);
  }

  @Get('devices/:deviceId/vcf')
  @Authenticated({ permission: Permission.ContactRead })
  @Endpoint({
    summary: 'Download a device\'s contacts as a VCF file',
    description: 'Returns the original raw VCARD blocks contributed by this device, concatenated.',
    history: new HistoryBuilder().added('v1'),
  })
  async getDeviceVcf(
    @Auth() auth: AuthDto,
    @Param() { deviceId }: DeviceIdParamDto,
  ): Promise<StreamableFile> {
    const stream = await this.service.getDeviceVcf(auth, deviceId);
    return asStreamableFile(stream);
  }

  @Get()
  @Authenticated({ permission: Permission.ContactRead })
  @ApiOkResponse({ type: ContactsResponseDto })
  @Endpoint({
    summary: 'List contacts',
    description: 'Returns the full deduplicated list of the user\'s contacts with only the fields needed to render the list view (id, displayName, organization, title, avatar). Heavy fields are loaded on demand by the single-contact endpoint.',
    history: new HistoryBuilder().added('v1'),
  })
  async getContacts(@Auth() auth: AuthDto): Promise<ContactsResponseDto> {
    return this.service.list(auth);
  }

  @Get('vcf')
  @Authenticated({ permission: Permission.ContactRead })
  @Endpoint({
    summary: 'Download all contacts as a VCF file',
    description:
      'Streams every stored vCard block for the user — across all devices, including unparsed entries — concatenated into a single VCF.',
    history: new HistoryBuilder().added('v1'),
  })
  async getAllVcf(@Auth() auth: AuthDto): Promise<StreamableFile> {
    const stream = await this.service.getOwnerVcf(auth);
    return asStreamableFile(stream);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.ContactRead })
  @ApiOkResponse({ type: ContactDto })
  @Endpoint({
    summary: 'Retrieve a single contact',
    history: new HistoryBuilder().added('v1'),
  })
  async getContact(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<ContactDto> {
    return this.service.getOne(auth, id);
  }

  @Post('export')
  @Authenticated({ permission: Permission.ContactRead })
  @Endpoint({
    summary: 'Export selected contacts as a VCF file',
    history: new HistoryBuilder().added('v1'),
  })
  async exportContacts(@Auth() auth: AuthDto, @Body() dto: ContactBulkRequestDto): Promise<StreamableFile> {
    const stream = await this.service.export(auth, dto);
    return asStreamableFile(stream);
  }

  @Post('delete')
  @Authenticated({ permission: Permission.ContactDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete the given contacts',
    history: new HistoryBuilder().added('v1'),
  })
  async deleteContacts(@Auth() auth: AuthDto, @Body() dto: ContactBulkRequestDto): Promise<void> {
    await this.service.deleteMany(auth, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.ContactDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a single contact',
    history: new HistoryBuilder().added('v1'),
  })
  async deleteContact(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    await this.service.deleteOne(auth, id);
  }

  @Delete()
  @Authenticated({ permission: Permission.ContactDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete all contacts for the user',
    history: new HistoryBuilder().added('v1'),
  })
  async deleteAllContacts(@Auth() auth: AuthDto): Promise<void> {
    await this.service.deleteAll(auth);
  }
}
