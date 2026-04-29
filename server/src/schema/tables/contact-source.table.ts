import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { ContactTable } from 'src/schema/tables/contact.table';
import {
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from 'src/sql-tools';

@Table({ name: 'contact_source' })
@UpdatedAtTrigger('contact_source_updatedAt')
@Index({ columns: ['deviceId'] })
export class ContactSourceTable {
  // The composite primary key (contactId, deviceId) already provides a
  // contactId-leading index, so we skip the auto-generated FK index here.
  @ForeignKeyColumn(() => ContactTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    index: false,
  })
  contactId!: string;

  @PrimaryColumn({ type: 'character varying' })
  deviceId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
