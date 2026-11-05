import { Kysely, sql } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { DB } from 'src/schema';
import { PersonService } from 'src/services/person.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(PersonService, {
    database: db || defaultDatabase,
    real: [AccessRepository, DatabaseRepository, PersonRepository],
    mock: [LoggingRepository, StorageRepository],
  });
};

const collect = async <T>(stream: AsyncIterable<T>) => {
  const items: T[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(PersonService.name, () => {
  describe('getAllFaces', () => {
    const embedding = `[${[1, ...Array.from({ length: 511 }, () => 0)].join(',')}]`;

    const setupFaces = async () => {
      const { ctx } = setup();
      const newFace = async (ownerId: string, withVector: boolean) => {
        const { asset } = await ctx.newAsset({ ownerId });
        const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
        if (withVector) {
          await ctx.database.insertInto('face_search').values({ faceId: assetFace.id!, embedding }).execute();
        }
        return assetFace.id!;
      };

      const { user } = await ctx.newUser();
      const { user: archived } = await ctx.newUser();
      await sql`
        INSERT INTO vector_archive.users ("userId", "lastActive", "clipCount", "faceCount", "clipModel", "faceModel", files)
        VALUES (${archived.id}, now(), 0, 1, 'default', 'default', '')
      `.execute(ctx.database);

      const recognizable = await newFace(user.id, true);
      const withoutVector = await newFace(user.id, false);
      const ofArchivedUser = await newFace(archived.id, true);
      const ownerIds = [user.id, archived.id];
      return { ctx, user, ownerIds, recognizable, withoutVector, ofArchivedUser };
    };

    it('should leave out archived users and faces without a vector when recognizable', async () => {
      const { ctx, user, ownerIds, recognizable } = await setupFaces();

      const faces = await collect(ctx.get(PersonRepository).getAllFaces({ ownerIds, recognizable: true }));

      expect(faces).toEqual([expect.objectContaining({ id: recognizable, ownerId: user.id })]);
    });

    it('should apply the other filters when recognizable', async () => {
      const { ctx, ownerIds, recognizable } = await setupFaces();
      const faceRepo = ctx.get(PersonRepository);

      await expect(collect(faceRepo.getAllFaces({ ownerIds, recognizable: true, personId: null }))).resolves.toEqual([
        expect.objectContaining({ id: recognizable }),
      ]);
      await expect(
        collect(faceRepo.getAllFaces({ ownerIds, recognizable: true, personId: factory.uuid() })),
      ).resolves.toEqual([]);
    });

    it('should return every face otherwise', async () => {
      const { ctx, ownerIds, recognizable, withoutVector, ofArchivedUser } = await setupFaces();

      const faces = await collect(ctx.get(PersonRepository).getAllFaces({ ownerIds }));

      expect(faces.map(({ id }) => id).toSorted()).toEqual([recognizable, withoutVector, ofArchivedUser].toSorted());
    });
  });

  describe('delete', () => {
    it('should throw an error when there is no access', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const personId = factory.uuid();
      await expect(sut.delete(auth, personId)).rejects.toThrow('Not found or no person.delete access');
    });

    it('should delete the person', async () => {
      const { sut, ctx } = setup();
      const personRepo = ctx.get(PersonRepository);
      const storageMock = ctx.getMock(StorageRepository);
      const { user } = await ctx.newUser();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      const auth = factory.auth({ user });
      storageMock.unlink.mockResolvedValue();

      await expect(personRepo.getById(person.id)).resolves.toEqual(expect.objectContaining({ id: person.id }));
      await expect(sut.delete(auth, person.id)).resolves.toBeUndefined();
      await expect(personRepo.getById(person.id)).resolves.toBeUndefined();

      expect(storageMock.unlink).toHaveBeenCalledWith(person.thumbnailPath);
    });
  });

  describe('deleteAll', () => {
    it('should throw an error when there is no access', async () => {
      const { sut } = setup();
      const auth = factory.auth();
      const personId = factory.uuid();
      await expect(sut.deleteAll(auth, { ids: [personId] })).rejects.toThrow('Not found or no person.delete access');
    });

    it('should delete the person', async () => {
      const { sut, ctx } = setup();
      const storageMock = ctx.getMock(StorageRepository);
      const personRepo = ctx.get(PersonRepository);
      const { user } = await ctx.newUser();
      const { person: person1 } = await ctx.newPerson({ ownerId: user.id });
      const { person: person2 } = await ctx.newPerson({ ownerId: user.id });
      const auth = factory.auth({ user });
      storageMock.unlink.mockResolvedValue();

      await expect(sut.deleteAll(auth, { ids: [person1.id, person2.id] })).resolves.toBeUndefined();
      await expect(personRepo.getById(person1.id)).resolves.toBeUndefined();
      await expect(personRepo.getById(person2.id)).resolves.toBeUndefined();

      expect(storageMock.unlink).toHaveBeenCalledTimes(2);
      expect(storageMock.unlink).toHaveBeenCalledWith(person1.thumbnailPath);
      expect(storageMock.unlink).toHaveBeenCalledWith(person2.thumbnailPath);
    });
  });
});
