import { BadRequestException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { FILTER_EXTRACTION_CACHE_TTL } from "src/constants";
import { AssetMapOptions, AssetResponseDto, MapAsset, mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { mapPerson, PersonResponseDto } from 'src/dtos/person.dto';
import {
  LargeAssetSearchDto,
  mapPlaces,
  MetadataSearchDto,
  PlacesResponseDto,
  RandomSearchDto,
  SearchPeopleDto,
  SearchPlacesDto,
  SearchResponseDto,
  SearchStatisticsResponseDto,
  SearchSuggestionRequestDto,
  SearchSuggestionType,
  SmartSearchDto,
  StatisticsSearchDto,
} from 'src/dtos/search.dto';
import { AssetOrder, AssetVisibility, Permission } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { requireElevatedPermission } from 'src/utils/access';
import { getMyPartnerIds } from 'src/utils/asset.util';
import { isFilterExtractionEnabled, isSmartSearchEnabled } from 'src/utils/misc';
import { z } from "zod";

// Define the JSON schema of OpenAI's structured outputs. All fields must be required, see:
// https://platform.openai.com/docs/guides/structured-outputs?api-mode=responses#all-fields-must-be-required
const FilterExtractionResponse = z.object({
  takenBefore: z.string().nullable(),
  takenAfter: z.string().nullable(),

  country: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),

  people: z.array(z.string()).nullable(),

  refinedQuery: z.string(),
});

@Injectable()
export class SearchService extends BaseService {
  private embeddingCache = new LRUMap<string, string>(100);

  async searchPerson(auth: AuthDto, dto: SearchPeopleDto): Promise<PersonResponseDto[]> {
    const people = await this.personRepository.getByName(auth.user.id, dto.name, { withHidden: dto.withHidden });
    return people.map((person) => mapPerson(person));
  }

  async searchPlaces(dto: SearchPlacesDto): Promise<PlacesResponseDto[]> {
    const places = await this.searchRepository.searchPlaces(dto.name);
    return places.map((place) => mapPlaces(place));
  }

  async getExploreData(auth: AuthDto) {
    const options = { maxFields: 12, minAssetsPerField: 5 };
    const cities = await this.assetRepository.getAssetIdByCity(auth.user.id, options);
    const assets = await this.assetRepository.getByIdsWithAllRelationsButStacks(cities.items.map(({ data }) => data));
    const items = assets.map((asset) => ({ value: asset.exifInfo!.city!, data: mapAsset(asset, { auth }) }));
    return [{ fieldName: cities.fieldName, items }];
  }

  async searchMetadata(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    let checksum: Buffer | undefined;
    if (dto.checksum) {
      const encoding = dto.checksum.length === 12 ? 'base64' : 'hex'; // xxHash64 can be base64 (12 chars)
      checksum = Buffer.from(dto.checksum, encoding);
    }

    const page = dto.page ?? 1;
    const size = dto.size || 250;
    const userIds = await this.getUserIdsToSearch(auth);
    const { hasNextPage, items } = await this.searchRepository.searchMetadata(
      { page, size },
      {
        ...dto,
        checksum,
        userIds,
        orderDirection: dto.order ?? AssetOrder.Desc,
      },
    );

    return this.mapResponse(items, hasNextPage ? (page + 1).toString() : null, { auth });
  }

  async searchStatistics(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    const userIds = await this.getUserIdsToSearch(auth);

    return await this.searchRepository.searchStatistics({
      ...dto,
      userIds,
    });
  }

  async searchRandom(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth);
    const items = await this.searchRepository.searchRandom(dto.size || 250, { ...dto, userIds });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchLargeAssets(auth: AuthDto, dto: LargeAssetSearchDto): Promise<AssetResponseDto[]> {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth);
    const items = await this.searchRepository.searchLargeAssets(dto.size || 250, { ...dto, userIds });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async extractFilters(auth: AuthDto, dto: SmartSearchDto, filterExtraction: {modelName: string, prompt: string, cacheEnabled: boolean}): Promise<SmartSearchDto> {
    this.logger.log(
      "Extracting filters for search:",
      Object.fromEntries(Object.entries(dto).filter(([_, v]) => v !== undefined))
    );

    // check if user has already specified all of the related filters.
    if (dto.personIds?.length && dto.country && dto.state && dto.city && dto.takenBefore && dto.takenAfter) {
      this.logger.log("User has specified all of the related filters. There is no need to extract them from the query.");
      return dto;
    }

    // if the query is empty, we cannot extract filters.
    if (!dto.query || dto.query.trim() === "") {
      this.logger.log("Query is empty, cannot extract filters.");
      return dto;
    }

    // get all named people in current user account.
    const namedPeople = await this.personRepository.getAllForUserWithNames(auth.user.id);

    // update the variables in the prompt: $TODAY, $USER_NAME, $COUNTRIES, $STATES, $CITIES, $PEOPLE_NAMES, $BIRTHDAY
    const countries = JSON.stringify(await this.searchRepository.getCountries([auth.user.id]));
    const states = JSON.stringify(await this.searchRepository.getStates([auth.user.id], { country: undefined }));
    const cities = JSON.stringify(await this.searchRepository.getCities([auth.user.id], { country: undefined, state: undefined }));
    const peopleNames = JSON.stringify(namedPeople.map(p => p.name));
    const prompt = filterExtraction.prompt
      .replaceAll('$TODAY', new Date().toISOString().split('T')[0])
      .replaceAll('$USER_NAME', auth.user.name)
      .replaceAll('$COUNTRIES', countries)
      .replaceAll('$STATES', states)
      .replaceAll('$CITIES', cities)
      .replaceAll('$PEOPLE_NAMES', peopleNames)
      .replaceAll('$BIRTHDAY', ""); // TODO: add birthday information if needed

    this.logger.log(`Filter extraction model: ${filterExtraction.modelName}`);
    this.logger.debug(`Filter extraction prompt: ${prompt}`);

    // use GPT to extract filters from the query.
    const openai = new OpenAI({
      timeout: 3000, // timeout in 3 seconds
    });
    try {
      let data: Record<string, any> | null;

      // check if cache is enabled and if the key exists
      const cacheKey = filterExtraction.cacheEnabled ? 'filter_extraction_' + this.cryptoRepository.hashSha256(`${dto.query}_${filterExtraction.modelName}_${prompt}`) : "";
      const cacheVal = filterExtraction.cacheEnabled ? await this.redisRepository.get(cacheKey) : null;
      if (cacheVal) {
        data = JSON.parse(cacheVal);
        this.logger.log("Filter extraction response loaded from cache:", data);
      }

      else {
        const startTime = Date.now();
        const response = await openai.responses.parse({
          model: filterExtraction.modelName,
          input: [
            { role: "system", content: prompt },
            { role: "user", content: dto.query },
          ],
          text: {
            format: zodTextFormat(FilterExtractionResponse, "response"),
          },
        });
        const endTime = Date.now();
        this.logger.log(`Filter extraction API call took ${endTime - startTime}ms`);

        data = response.output_parsed;
        if (!data) {
          this.logger.error("No data returned from filter extraction:", response);
          return dto;
        }

        // cache the response
        await this.redisRepository.set(cacheKey, JSON.stringify(data), FILTER_EXTRACTION_CACHE_TTL.as('seconds'));
        this.logger.log("Filter extraction raw response:", data);
      }

      // filter data, unset any fields with value undefined or null or empty string
      data = Object.fromEntries(
        Object.entries(data as Record<string, any>).filter(([_, value]) => value !== undefined && value !== null && value !== "" && value !== "undefined" && value !== "null")
      ) as typeof FilterExtractionResponse._type;

      // extract the taken dates and convert them to Date objects. sometimes, GPT may return a date range
      // from the beginning of the year 1970 to the end of the current year, which is meaningless.
      if (!dto.takenBefore && data.takenBefore) {
        const takenBefore = new Date(data.takenBefore);
        if (takenBefore.toString() !== "Invalid Date" && takenBefore.getDate() <= Date.now()) {
          dto.takenBefore = takenBefore;
        }
      }
      if (!dto.takenAfter && data.takenAfter) {
        const takenAfter = new Date(data.takenAfter);
        if (takenAfter.toString() !== "Invalid Date" && takenAfter.getFullYear() > 1970) {
          dto.takenAfter = takenAfter;
        }
      }

      // add personIds by matching people names from the response with existing persons in the database
      if (!dto.personIds?.length && data.people && data.people.length > 0) {
        dto.personIds = namedPeople.filter(p => data.people!.includes(p.name)).map((p) => p.id);
      }

      // add the rest of the fields to the dto
      dto = { 
        ...dto, 
        query: data.refinedQuery || "",
        country: dto.country || data.country, 
        state: dto.state || data.state, 
        city: dto.city || data.city 
      };

      this.logger.log(
        "Updated search filters:",
        Object.fromEntries(Object.entries(dto).filter(([_, v]) => v !== undefined))
      );
    } catch (error) {
      this.logger.error("Error extracting filters from query:", {
        query: dto.query,
        modelName: filterExtraction.modelName,
        prompt,
        error,
      });
    }

    return dto;
 }

  async searchSmart(auth: AuthDto, dto: SmartSearchDto): Promise<SearchResponseDto> {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search is not enabled');
    }

    if (isFilterExtractionEnabled(machineLearning) && dto.withFilterExtraction !== false) {
      dto = await this.extractFilters(auth, dto, machineLearning.filterExtraction);
    }

    const userIds = this.getUserIdsToSearch(auth);
    let embedding;
    if (dto.query) {
      const key = machineLearning.clip.modelName + dto.query + dto.language;
      embedding = this.embeddingCache.get(key);
      if (!embedding) {
        embedding = await this.machineLearningRepository.encodeText(dto.query, {
          modelName: machineLearning.clip.modelName,
          language: dto.language,
        });
        this.embeddingCache.set(key, embedding);
      }
    } else if (dto.queryAssetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.queryAssetId] });
      const getEmbeddingResponse = await this.searchRepository.getEmbedding(dto.queryAssetId);
      const assetEmbedding = getEmbeddingResponse?.embedding;
      if (!assetEmbedding) {
        throw new BadRequestException(`Asset ${dto.queryAssetId} has no embedding`);
      }
      embedding = assetEmbedding;
    } else {
      throw new BadRequestException('Either `query` or `queryAssetId` must be set');
    }
    const page = dto.page ?? 1;
    const size = dto.size || 100;
    const { hasNextPage, items } = await this.searchRepository.searchSmart(
      { page, size },
      { ...dto, userIds: await userIds, embedding },
    );

    const response = this.mapResponse(items, hasNextPage ? (page + 1).toString() : null, { auth });

    // send back the updated search terms when 'showExtractedFilters' is true.
    const showExtractedFilters = isFilterExtractionEnabled(machineLearning) && machineLearning.filterExtraction.showExtractedFilters;
    if (showExtractedFilters) {
      const { withExif: _unused1, language: _unused2, page: _unused3, ...filteredDto } = dto;
      response.terms = filteredDto;
    }

    return response;
  }

  async getAssetsByCity(auth: AuthDto): Promise<AssetResponseDto[]> {
    const userIds = await this.getUserIdsToSearch(auth);
    const assets = await this.searchRepository.getAssetsByCity(userIds);
    return assets.map((asset) => mapAsset(asset));
  }

  async getSearchSuggestions(auth: AuthDto, dto: SearchSuggestionRequestDto) {
    const userIds = await this.getUserIdsToSearch(auth);
    const suggestions = await this.getSuggestions(userIds, dto);
    if (dto.includeNull) {
      suggestions.push(null);
    }
    return suggestions;
  }

  private getSuggestions(userIds: string[], dto: SearchSuggestionRequestDto): Promise<Array<string | null>> {
    switch (dto.type) {
      case SearchSuggestionType.COUNTRY: {
        return this.searchRepository.getCountries(userIds);
      }
      case SearchSuggestionType.STATE: {
        return this.searchRepository.getStates(userIds, dto);
      }
      case SearchSuggestionType.CITY: {
        return this.searchRepository.getCities(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MAKE: {
        return this.searchRepository.getCameraMakes(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MODEL: {
        return this.searchRepository.getCameraModels(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_LENS_MODEL: {
        return this.searchRepository.getCameraLensModels(userIds, dto);
      }
      default: {
        return Promise.resolve([]);
      }
    }
  }

  private async getUserIdsToSearch(auth: AuthDto): Promise<string[]> {
    const partnerIds = await getMyPartnerIds({
      userId: auth.user.id,
      repository: this.partnerRepository,
      timelineEnabled: true,
    });
    return [auth.user.id, ...partnerIds];
  }

  private mapResponse(assets: MapAsset[], nextPage: string | null, options: AssetMapOptions): SearchResponseDto {
    return {
      albums: { total: 0, count: 0, items: [], facets: [] },
      assets: {
        total: assets.length,
        count: assets.length,
        items: assets.map((asset) => mapAsset(asset, options)),
        facets: [],
        nextPage,
      },
    };
  }
}
