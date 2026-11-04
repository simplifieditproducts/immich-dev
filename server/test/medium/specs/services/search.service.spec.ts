import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PartnerRepository } from 'src/repositories/partner.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SearchRepository } from 'src/repositories/search.repository';
import { DB } from 'src/schema';
import { SearchService } from 'src/services/search.service';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(SearchService, {
    database: db || defaultDatabase,
    real: [AccessRepository, DatabaseRepository, SearchRepository, PartnerRepository, PersonRepository],
    mock: [LoggingRepository],
  });
};

// Distance from the search grows with `distance`, so Smart Search alone would list assets in that order.
const embedding = (distance: number) => {
  const vector = [1, ...Array.from({ length: 511 }, () => 0)];
  vector[1] = distance;
  return `[${vector.join(',')}]`;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const setupAssets = async () => {
  const { ctx } = setup();
  const { user } = await ctx.newUser();

  const newAsset = async (distance: number, text?: string) => {
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.database
      .insertInto('smart_search')
      .values({ assetId: asset.id, embedding: embedding(distance) })
      .execute();
    if (text) {
      await ctx.database.insertInto('ocr_search').values({ assetId: asset.id, text }).execute();
    }
    return asset.id;
  };

  const photo = await newAsset(0.1);
  const screenshots = [
    await newAsset(1, 'costco wholesale'),
    await newAsset(2, 'membership at costco today'),
    await newAsset(3, 'costco'),
  ];
  const weakMatch = await newAsset(4, 'costly coast');
  const lastPhoto = await newAsset(5);

  const search = async (ocrRanking?: { query: string; limit?: number }, page = 1, size = 10) => {
    const { items } = await ctx.get(SearchRepository).searchSmart(
      { page, size },
      { userIds: [user.id], embedding: embedding(0), ocrRanking },
    );
    return items.map(({ id }) => id);
  };

  return { ctx, user, search, photo, screenshots, weakMatch, lastPhoto };
};

describe(SearchService.name, () => {
  it('should work', () => {
    const { sut } = setup();
    expect(sut).toBeDefined();
  });

  it('should return assets', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();

    const assets = [];
    const sizes = [12_334, 599, 123_456];

    for (let i = 0; i < sizes.length; i++) {
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: sizes[i] });
      assets.push(asset);
    }

    const auth = factory.auth({ user: { id: user.id } });

    await expect(sut.searchLargeAssets(auth, {})).resolves.toEqual([
      expect.objectContaining({ id: assets[2].id }),
      expect.objectContaining({ id: assets[0].id }),
      expect.objectContaining({ id: assets[1].id }),
    ]);
  });

  describe('searchSmart ocr ranking', () => {
    it('should order by Smart Search alone without an ocr ranking', async () => {
      const { search, photo, screenshots, weakMatch, lastPhoto } = await setupAssets();

      await expect(search()).resolves.toEqual([photo, ...screenshots, weakMatch, lastPhoto]);
    });

    it('should put every text match first without a limit', async () => {
      const { search, photo, screenshots, weakMatch, lastPhoto } = await setupAssets();

      await expect(search({ query: 'costco' })).resolves.toEqual([...screenshots, photo, weakMatch, lastPhoto]);
    });

    it('should put only the best text matches first with a limit, and keep the rest in place', async () => {
      const { search, photo, screenshots, weakMatch, lastPhoto } = await setupAssets();

      await expect(search({ query: 'costco', limit: 2 })).resolves.toEqual([
        screenshots[0],
        screenshots[1],
        photo,
        screenshots[2],
        weakMatch,
        lastPhoto,
      ]);
    });

    it('should page through every asset once with a limit', async () => {
      const { search, photo, screenshots, weakMatch, lastPhoto } = await setupAssets();
      const ranking = { query: 'costco', limit: 2 };

      const pages = [await search(ranking, 1, 2), await search(ranking, 2, 2), await search(ranking, 3, 2)];

      expect(pages.flat()).toEqual([screenshots[0], screenshots[1], photo, screenshots[2], weakMatch, lastPhoto]);
    });

    it('should use only assets that pass the filters for the limit', async () => {
      const { ctx, user, screenshots } = await setupAssets();
      const { person } = await ctx.newPerson({ ownerId: user.id });
      await ctx.newAssetFace({ assetId: screenshots[2], personId: person.id });

      const { items } = await ctx.get(SearchRepository).searchSmart(
        { page: 1, size: 10 },
        {
          userIds: [user.id],
          embedding: embedding(0),
          personIds: [person.id],
          withExif: false,
          ocrRanking: { query: 'costco', limit: 1 },
        },
      );

      expect(items.map(({ id }) => id)).toEqual([screenshots[2]]);
    });
  });
});
