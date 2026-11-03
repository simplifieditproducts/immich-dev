import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, Insertable, Kysely, sql, Updateable } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { DateTime } from 'luxon';
import { InjectKysely } from 'nestjs-kysely';
import { SUBSCRIBER_MIN_QUOTA_BYTES } from 'src/constants';
import { columns } from 'src/database';
import { DummyValue, GenerateSql } from 'src/decorators';
import { AssetType, AssetVisibility, UserStatus } from 'src/enum';
import { DB } from 'src/schema';
import { UserTable } from 'src/schema/tables/user.table';
import { UserMetadata, UserMetadataItem } from 'src/types';
import { anyUuid, asUuid } from 'src/utils/database';

export interface UserListFilter {
  id?: string;
  ids?: string[];
  withDeleted?: boolean;
  sourceApp?: string;
  updatedAfter?: Date;
  subscriberOnly?: boolean;
}

export interface UserStatsQueryResponse {
  userId: string;
  userName: string;
  photos: number;
  videos: number;
  usage: number;
  usagePhotos: number;
  usageVideos: number;
  quotaSizeInBytes: number | null;
}

export interface UserFindOptions {
  withDeleted?: boolean;
}

const withMetadata = (eb: ExpressionBuilder<DB, 'user'>) => {
  return jsonArrayFrom(
    eb
      .selectFrom('user_metadata')
      .select(['user_metadata.key', 'user_metadata.value'])
      .whereRef('user.id', '=', 'user_metadata.userId'),
  ).as('metadata');
};

@Injectable()
export class UserRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.BOOLEAN] })
  get(userId: string, options: UserFindOptions) {
    options = options || {};

    return this.db
      .selectFrom('user')
      .select(columns.userAdmin)
      .select(withMetadata)
      .where('user.id', '=', userId)
      .$if(!options.withDeleted, (eb) => eb.where('user.deletedAt', 'is', null))
      .executeTakeFirst();
  }

  getMetadata(userId: string) {
    return this.db
      .selectFrom('user_metadata')
      .select(['key', 'value'])
      .where('user_metadata.userId', '=', userId)
      .execute() as Promise<UserMetadataItem[]>;
  }

  @GenerateSql()
  getAdmin() {
    return this.db
      .selectFrom('user')
      .select(columns.userAdmin)
      .select(withMetadata)
      .where('user.isAdmin', '=', true)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql()
  getFileSamples() {
    return this.db
      .selectFrom('user')
      .select(['id', 'profileImagePath'])
      .where('profileImagePath', '!=', sql.lit(''))
      .limit(sql.lit(3))
      .execute();
  }

  @GenerateSql()
  async hasAdmin(): Promise<boolean> {
    const admin = await this.db
      .selectFrom('user')
      .select('user.id')
      .where('user.isAdmin', '=', true)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirst();

    return !!admin;
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForPinCode(id: string) {
    return this.db
      .selectFrom('user')
      .select(['user.pinCode', 'user.password'])
      .where('user.id', '=', id)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getForChangePassword(id: string) {
    return this.db
      .selectFrom('user')
      .select(['user.id', 'user.password'])
      .where('user.id', '=', id)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.EMAIL] })
  getByEmail(email: string, options?: { withPassword?: boolean }) {
    return this.db
      .selectFrom('user')
      .select(columns.userAdmin)
      .select(withMetadata)
      .$if(!!options?.withPassword, (eb) => eb.select('password'))
      .where('email', '=', email)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.STRING] })
  getByStorageLabel(storageLabel: string) {
    return this.db
      .selectFrom('user')
      .select(columns.userAdmin)
      .where('user.storageLabel', '=', storageLabel)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.STRING] })
  getByOAuthId(oauthId: string) {
    return this.db
      .selectFrom('user')
      .select(columns.userAdmin)
      .select(withMetadata)
      .where('user.oauthId', '=', oauthId)
      .where('user.deletedAt', 'is', null)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DateTime.now().minus({ years: 1 })] })
  getDeletedAfter(target: DateTime) {
    return this.db.selectFrom('user').select(['id']).where('user.deletedAt', '<', target.toJSDate()).execute();
  }

  @GenerateSql(
    { name: 'with deleted', params: [{ withDeleted: true }] },
    { name: 'without deleted', params: [{ withDeleted: false }] },
    { name: 'subscriber only', params: [{ subscriberOnly: true }] },
  )
  getList({ id, ids, withDeleted, sourceApp, updatedAfter, subscriberOnly }: UserListFilter = {}) {
    return this.db
      .selectFrom('user')
      .select(columns.userAdmin)
      .select(withMetadata)
      .$if(!withDeleted, (eb) => eb.where('user.deletedAt', 'is', null))
      .$if(!!id, (eb) => eb.where('user.id', '=', id!))
      .$if(!!ids, (eb) => eb.where('user.id', '=', anyUuid(ids!)))
      .$if(!!sourceApp, (eb) => eb.where('user.sourceApp', '=', sourceApp!))
      .$if(!!updatedAfter, (eb) => eb.where('user.updatedAt', '>=', updatedAfter!))
      .$if(!!subscriberOnly, (qb) =>
        qb.where((eb) =>
          eb.or([
            eb('user.quotaSizeInBytes', '>=', SUBSCRIBER_MIN_QUOTA_BYTES),
            eb('user.quotaSizeInBytes', 'is', null),
          ]),
        ),
      )
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async create(dto: Insertable<UserTable>) {
    return this.db
      .insertInto('user')
      .values(dto)
      .returning(columns.userAdmin)
      .returning(withMetadata)
      .executeTakeFirstOrThrow();
  }

  update(id: string, dto: Updateable<UserTable>) {
    return this.db
      .updateTable('user')
      .set(dto)
      .where('user.id', '=', asUuid(id))
      .where('user.deletedAt', 'is', null)
      .returning(columns.userAdmin)
      .returning(withMetadata)
      .executeTakeFirstOrThrow();
  }

  async updateAll(dto: Updateable<UserTable>) {
    await this.db.updateTable('user').set(dto).execute();
  }

  restore(id: string) {
    return this.db
      .updateTable('user')
      .set({ status: UserStatus.Active, deletedAt: null })
      .where('user.id', '=', asUuid(id))
      .returning(columns.userAdmin)
      .returning(withMetadata)
      .executeTakeFirstOrThrow();
  }

  async upsertMetadata<T extends keyof UserMetadata>(id: string, { key, value }: { key: T; value: UserMetadata[T] }) {
    await this.db
      .insertInto('user_metadata')
      .values({ userId: id, key, value })
      .onConflict((oc) =>
        oc.columns(['userId', 'key']).doUpdateSet({
          key,
          value,
        }),
      )
      .execute();
  }

  async deleteMetadata<T extends keyof UserMetadata>(id: string, key: T) {
    await this.db.deleteFrom('user_metadata').where('userId', '=', id).where('key', '=', key).execute();
  }

  delete(user: { id: string }, hard?: boolean) {
    return hard
      ? this.db.deleteFrom('user').where('id', '=', user.id).execute()
      : this.db.updateTable('user').set({ deletedAt: new Date() }).where('id', '=', user.id).execute();
  }

  @GenerateSql()
  getUserCount(sourceApp: string) {
    return this.db
      .selectFrom('user')
      .where('user.sourceApp', '=', sourceApp)
      .where('user.deletedAt', 'is', null)
      .select((eb) => eb.fn.countAll<number>().as('users'))
      .executeTakeFirstOrThrow();
  }

  @GenerateSql()
  getUserStats() {
    return this.db
      .selectFrom('user')
      .leftJoin('asset', (join) => join.onRef('asset.ownerId', '=', 'user.id').on('asset.deletedAt', 'is', null))
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select(['user.id as userId', 'user.name as userName', 'user.quotaSizeInBytes'])
      .select((eb) => [
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.and([
              eb('asset.type', '=', sql.lit(AssetType.Image)),
              eb('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden)),
            ]),
          )
          .as('photos'),
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.and([
              eb('asset.type', '=', sql.lit(AssetType.Video)),
              eb('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden)),
            ]),
          )
          .as('videos'),
        eb.fn
          .coalesce(
            eb.fn.sum<number>('asset_exif.fileSizeInByte').filterWhere('asset.libraryId', 'is', null),
            eb.lit(0),
          )
          .as('usage'),
        eb.fn
          .coalesce(
            eb.fn
              .sum<number>('asset_exif.fileSizeInByte')
              .filterWhere((eb) =>
                eb.and([eb('asset.libraryId', 'is', null), eb('asset.type', '=', sql.lit(AssetType.Image))]),
              ),
            eb.lit(0),
          )
          .as('usagePhotos'),
        eb.fn
          .coalesce(
            eb.fn
              .sum<number>('asset_exif.fileSizeInByte')
              .filterWhere((eb) =>
                eb.and([eb('asset.libraryId', 'is', null), eb('asset.type', '=', sql.lit(AssetType.Video))]),
              ),
            eb.lit(0),
          )
          .as('usageVideos'),
      ])
      .groupBy('user.id')
      .orderBy('user.createdAt', 'asc')
      .execute();
  }

  @GenerateSql()
  async getCount(): Promise<number> {
    const result = await this.db
      .selectFrom('user')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('user.deletedAt', 'is', null)
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  /**
   * How many of a user's photos and videos (not deleted, not hidden) are
   * still without each step's result, for GET /users/me/search-status. One
   * read of the user's assets by ownerId with their job status and search
   * vectors: 0.5 s for 74,000 on keepsafe (1.5 s cold), milliseconds for
   * most users. Face detection sets facesRecognizedAt; recognition leaves no
   * mark per face (many faces never join a person), so it isn't counted.
   * Videos count as waiting for videoConversion until encodedVideoPath is
   * set: every video is transcoded on keepsafe's servers.
   */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getSearchProgress(id: string) {
    const row = await this.db
      .selectFrom('asset')
      .leftJoin('asset_job_status', 'asset_job_status.assetId', 'asset.id')
      .select((eb) => [
        eb.fn.countAll<number>().as('assets'),
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.not(
              eb.exists(
                eb
                  .selectFrom('smart_search')
                  .select('smart_search.assetId')
                  .whereRef('smart_search.assetId', '=', 'asset.id'),
              ),
            ),
          )
          .as('smartSearch'),
        eb.fn
          .countAll<number>()
          .filterWhere('asset_job_status.metadataExtractedAt', 'is', null)
          .as('metadataExtraction'),
        eb.fn.countAll<number>().filterWhere('asset_job_status.thumbnailAt', 'is', null).as('thumbnailGeneration'),
        eb.fn.countAll<number>().filterWhere('asset_job_status.facesRecognizedAt', 'is', null).as('faceDetection'),
        eb.fn.countAll<number>().filterWhere('asset_job_status.ocrAt', 'is', null).as('ocr'),
        eb.fn
          .countAll<number>()
          .filterWhere((eb) =>
            eb.and([eb('asset.type', '=', sql.lit(AssetType.Video)), eb('asset.encodedVideoPath', 'is', null)]),
          )
          .as('videoConversion'),
        eb.fn
          .countAll<number>()
          .filterWhere('asset_job_status.duplicatesDetectedAt', 'is', null)
          .as('duplicateDetection'),
      ])
      .where('asset.ownerId', '=', asUuid(id))
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', '!=', sql.lit(AssetVisibility.Hidden))
      .executeTakeFirstOrThrow();
    // Keyed by the queue each step runs in (QueueName), as /api/jobs is.
    return {
      assets: Number(row.assets),
      required: {
        smartSearch: Number(row.smartSearch),
        metadataExtraction: Number(row.metadataExtraction),
        thumbnailGeneration: Number(row.thumbnailGeneration),
      },
      deferrable: {
        faceDetection: Number(row.faceDetection),
        ocr: Number(row.ocr),
        videoConversion: Number(row.videoConversion),
        duplicateDetection: Number(row.duplicateDetection),
      },
    };
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.NUMBER] })
  async updateUsage(id: string, delta: number): Promise<void> {
    await this.db
      .updateTable('user')
      .set({ quotaUsageInBytes: sql`"quotaUsageInBytes" + ${delta}`, updatedAt: new Date() })
      .where('id', '=', asUuid(id))
      .where('user.deletedAt', 'is', null)
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  async syncUsage(id?: string) {
    const query = this.db
      .updateTable('user')
      .set({
        quotaUsageInBytes: (eb) =>
          eb
            .selectFrom('asset')
            .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
            .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('asset_exif.fileSizeInByte'), eb.lit(0)).as('usage'))
            .where('asset.libraryId', 'is', null)
            .where('asset.ownerId', '=', eb.ref('user.id')),
        updatedAt: new Date(),
      })
      .where('user.deletedAt', 'is', null)
      .$if(id != undefined, (eb) => eb.where('user.id', '=', asUuid(id!)));

    await query.execute();
  }
}
