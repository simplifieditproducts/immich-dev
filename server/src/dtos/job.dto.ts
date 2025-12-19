import { ApiProperty } from '@nestjs/swagger';
import { ManualJobName } from 'src/enum';
import { ValidateEnum } from 'src/validation';

export class JobCreateDto {
  @ValidateEnum({ enum: ManualJobName, name: 'ManualJobName' })
  name!: ManualJobName;

  @ApiProperty({ required: false })
  ownerId?: string;
}
