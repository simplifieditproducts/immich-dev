import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { columns } from 'src/database';
import { ContactStatus } from 'src/enum';
import { DB } from 'src/schema';
import { ContactTable } from 'src/schema/tables/contact.table';

export interface ContactDeviceRow {
  deviceId: string;
  lastUpload: Date;
  contactCount: number;
}

@Injectable()
export class ContactRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  findByVcardHash(ownerId: string, vcardHash: string) {
    return this.db
      .selectFrom('contact')
      .select(['id'])
      .where('ownerId', '=', ownerId)
      .where('vcardHash', '=', vcardHash)
      .executeTakeFirst();
  }

  insertIfNew(values: Insertable<ContactTable>) {
    return this.db
      .insertInto('contact')
      .values(values)
      .onConflict((oc) => oc.columns(['ownerId', 'vcardHash']).doNothing())
      .returning(['id'])
      .executeTakeFirst();
  }

  async upsertSource(contactId: string, deviceId: string) {
    await this.db
      .insertInto('contact_source')
      .values({ contactId, deviceId })
      .onConflict((oc) => oc.columns(['contactId', 'deviceId']).doUpdateSet({ updatedAt: new Date() }))
      .execute();
  }

  async deleteSourcesByDevice(ownerId: string, deviceId: string) {
    await this.db
      .deleteFrom('contact_source')
      .where('deviceId', '=', deviceId)
      .where('contactId', 'in', (qb) => qb.selectFrom('contact').select('id').where('ownerId', '=', ownerId))
      .execute();
  }

  async deleteOrphanContacts(ownerId: string) {
    await this.db
      .deleteFrom('contact')
      .where('ownerId', '=', ownerId)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('contact_source').select('contactId').whereRef('contact_source.contactId', '=', 'contact.id'),
          ),
        ),
      )
      .execute();
  }

  // Returns every active contact for the user — deduped across devices —
  // with only the fields needed to render the list view. Heavy fields
  // (phones, emails, addresses, notes, vcardBlock, etc.) are loaded on
  // demand by `getById` for the detail page.
  listAll(ownerId: string) {
    return this.db
      .with('deduped', (qb) =>
        qb
          .selectFrom('contact')
          .select(columns.contactListItem)
          .distinctOn(sql`COALESCE("contact"."contentHash", "contact"."id"::text)`)
          .where('ownerId', '=', ownerId)
          .where('status', '=', ContactStatus.Active)
          .orderBy(sql`COALESCE("contact"."contentHash", "contact"."id"::text)`)
          .orderBy('contact.updatedAt', 'desc'),
      )
      .selectFrom('deduped')
      .selectAll()
      .orderBy(sql`CASE WHEN "displayName" ~ '^[A-Za-z]' THEN 0 ELSE 1 END`)
      .orderBy(sql`LOWER("displayName")`)
      .execute();
  }

  getById(ownerId: string, id: string) {
    return this.db
      .selectFrom('contact')
      .select(columns.contact)
      .where('ownerId', '=', ownerId)
      .where('id', '=', id)
      .executeTakeFirst();
  }

  getVcardBlocks(ownerId: string, ids: string[]) {
    if (ids.length === 0) {
      return Promise.resolve([] as { vcardBlock: string }[]);
    }
    return this.db
      .selectFrom('contact')
      .select(['vcardBlock'])
      .where('ownerId', '=', ownerId)
      .where('id', 'in', ids)
      .execute();
  }

  getDeviceVcardBlocks(ownerId: string, deviceId: string) {
    return this.db
      .selectFrom('contact')
      .innerJoin('contact_source', 'contact_source.contactId', 'contact.id')
      .select(['contact.vcardBlock'])
      .where('contact.ownerId', '=', ownerId)
      .where('contact_source.deviceId', '=', deviceId)
      .orderBy('contact.createdAt')
      .execute();
  }

  getOwnerVcardBlocks(ownerId: string) {
    return this.db
      .selectFrom('contact')
      .select(['vcardBlock'])
      .where('ownerId', '=', ownerId)
      .orderBy('createdAt')
      .execute();
  }

  async listDevices(ownerId: string): Promise<ContactDeviceRow[]> {
    const rows = await this.db
      .selectFrom('contact_source')
      .innerJoin('contact', 'contact.id', 'contact_source.contactId')
      .select((eb) => [
        'contact_source.deviceId',
        eb.fn.max('contact_source.updatedAt').as('lastUpload'),
        eb.fn.countAll<string>().as('contactCount'),
      ])
      .where('contact.ownerId', '=', ownerId)
      .groupBy('contact_source.deviceId')
      .execute();

    return rows.map((row) => ({
      deviceId: row.deviceId,
      lastUpload: row.lastUpload as Date,
      contactCount: Number(row.contactCount),
    }));
  }

  async deleteDevice(ownerId: string, deviceId: string) {
    await this.deleteSourcesByDevice(ownerId, deviceId);
    await this.deleteOrphanContacts(ownerId);
  }

  async deleteByIds(ownerId: string, ids: string[]) {
    if (ids.length === 0) {
      return;
    }
    // The list view dedupes by contentHash, so a single visible row may shadow
    // additional rows with the same content. Expand the delete to cover those
    // siblings — otherwise they resurface on the next list load. Unparsed rows
    // have a null contentHash and aren't deduped, so they're caught only by id.
    await this.db
      .deleteFrom('contact')
      .where('ownerId', '=', ownerId)
      .where((eb) =>
        eb.or([
          eb('id', 'in', ids),
          eb('contentHash', 'in', (qb) =>
            qb
              .selectFrom('contact')
              .select('contentHash')
              .where('ownerId', '=', ownerId)
              .where('id', 'in', ids)
              .where('contentHash', 'is not', null),
          ),
        ]),
      )
      .execute();
  }

  async deleteAll(ownerId: string) {
    await this.db.deleteFrom('contact').where('ownerId', '=', ownerId).execute();
  }

  async transaction<T>(fn: (trx: ContactRepository) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      const repo = new ContactRepository(trx as unknown as Kysely<DB>);
      return fn(repo);
    });
  }
}
