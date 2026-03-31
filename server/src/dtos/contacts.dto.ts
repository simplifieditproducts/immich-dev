import { ApiProperty } from '@nestjs/swagger';

export class ContactPhoneDto {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  value!: string;
}

export class ContactEmailDto {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  value!: string;
}

export class ContactAddressDto {
  @ApiProperty()
  type!: string;

  @ApiProperty()
  street!: string;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  zip!: string;

  @ApiProperty()
  country!: string;
}

export class ContactDto {
  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: [ContactPhoneDto] })
  phones!: ContactPhoneDto[];

  @ApiProperty({ type: [ContactEmailDto] })
  emails!: ContactEmailDto[];

  @ApiProperty({ type: [ContactAddressDto] })
  addresses!: ContactAddressDto[];

  @ApiProperty({ required: false, nullable: true })
  organization!: string | null;

  @ApiProperty({ required: false, nullable: true })
  title!: string | null;

  @ApiProperty({ required: false, nullable: true })
  birthday!: string | null;

  @ApiProperty({ required: false, nullable: true })
  notes!: string | null;

  @ApiProperty({ required: false, nullable: true })
  avatar!: string | null;
}

export class ContactsResponseDto {
  @ApiProperty({ type: [ContactDto] })
  contacts!: ContactDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  lastModified!: string;
}
