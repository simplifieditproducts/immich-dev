import { ManualJobName } from 'src/enum';
import { ValidateEnum, ValidateUUID } from 'src/validation';

export class JobCreateDto {
  @ValidateEnum({ enum: ManualJobName, name: 'ManualJobName' })
  name!: ManualJobName;

  @ValidateUUID({ optional: true })
  ownerId?: string;
}
