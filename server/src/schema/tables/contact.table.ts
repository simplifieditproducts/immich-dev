import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { ContactStatus } from 'src/enum';
import { contact_status_enum } from 'src/schema/enums';
import { UserTable } from 'src/schema/tables/user.table';
import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from 'src/sql-tools';

@Table({ name: 'contact' })
@UpdatedAtTrigger('contact_updatedAt')
@Index({ columns: ['ownerId', 'vcardHash'], unique: true })
@Index({ columns: ['ownerId', 'contentHash'], where: `("status" = 'active')` })
export class ContactTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  // The leading column of the unique (ownerId, vcardHash) index already serves
  // ownerId-only lookups, so we don't need a separate FK index here.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, index: false })
  ownerId!: string;

  @Column({ type: 'character varying' })
  vcardHash!: string;

  @Column({ type: 'character varying', nullable: true })
  contentHash!: string | null;

  @Column({ enum: contact_status_enum, default: ContactStatus.Active })
  status!: Generated<ContactStatus>;

  @Column({ default: '' })
  displayName!: Generated<string>;

  @Column({ default: '' })
  firstName!: Generated<string>;

  @Column({ default: '' })
  lastName!: Generated<string>;

  @Column({ nullable: true })
  organization!: string | null;

  @Column({ nullable: true })
  title!: string | null;

  @Column({ nullable: true })
  birthday!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ type: 'text', nullable: true })
  avatar!: string | null;

  @Column({ type: 'jsonb', default: '[]' })
  phones!: Generated<object>;

  @Column({ type: 'jsonb', default: '[]' })
  emails!: Generated<object>;

  @Column({ type: 'jsonb', default: '[]' })
  addresses!: Generated<object>;

  @Column({ type: 'text' })
  vcardBlock!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
