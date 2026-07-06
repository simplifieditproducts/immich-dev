import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { OnJob } from 'src/decorators';
import { BulkIdResponseDto, BulkIdsDto } from 'src/dtos/asset-ids.response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { MemoryCreateDto, MemoryResponseDto, MemorySearchDto, MemoryUpdateDto, mapMemory } from 'src/dtos/memory.dto';
import { DatabaseLock, JobName, JobStatus, MemoryType, Permission, QueueName, SystemMetadataKey } from 'src/enum';
import { BaseService } from 'src/services/base.service';
import { addAssets, removeAssets } from 'src/utils/asset.util';
import { isSubscriber } from 'src/utils/user.util';

const DAYS = 3;
const MEMORY_GENERATE_CONCURRENCY = 30;

@Injectable()
export class MemoryService extends BaseService {
  @OnJob({ name: JobName.MemoryGenerate, queue: QueueName.BackgroundTask })
  async onMemoriesCreate(): Promise<JobStatus> {
    // Memories are a subscriber-only feature
    const users = await this.userRepository.getList({ withDeleted: false, subscriberOnly: true });
    this.logger.log(`Generating memories for ${users.length} subscribers`);

    // A try-lock keeps a stuck or orphaned lock holder from hanging this job forever
    // and pinning a queue worker slot every night (advisory locks are session-scoped,
    // so a leaked connection can hold one indefinitely).
    const { acquired } = await this.databaseRepository.withTryLock(DatabaseLock.MemoryCreation, async () => {
      const state = await this.systemMetadataRepository.get(SystemMetadataKey.MemoriesState);
      const start = DateTime.utc().startOf('day').minus({ days: DAYS });
      const lastOnThisDayDate = state?.lastOnThisDayDate ? DateTime.fromISO(state.lastOnThisDayDate) : start;

      // generate a memory +/- X days from today
      for (let i = 0; i <= DAYS * 2; i++) {
        const target = start.plus({ days: i });
        if (lastOnThisDayDate >= target) {
          continue;
        }

        try {
          for (let j = 0; j < users.length; j += MEMORY_GENERATE_CONCURRENCY) {
            const chunk: typeof users = users.slice(j, j + MEMORY_GENERATE_CONCURRENCY);
            const chunkStart = Date.now();
            await Promise.all(chunk.map(({ id }) => this.createOnThisDayMemories(id, target)));
            this.logger.log(
              `Create memories chunk ${Math.floor(j / MEMORY_GENERATE_CONCURRENCY) + 1}/${Math.ceil(users.length / MEMORY_GENERATE_CONCURRENCY)} done in ${Date.now() - chunkStart}ms (users ${j + 1}-${j + chunk.length})`,
            );
          }
        } catch (error) {
          this.logger.error(`Failed to create memories for ${target.toISO()}: ${error}`);
        }
        // update system metadata even when there is an error to minimize the chance of duplicates
        await this.systemMetadataRepository.set(SystemMetadataKey.MemoriesState, {
          ...state,
          lastOnThisDayDate: target.toISO(),
        });
      }
    });

    if (!acquired) {
      this.logger.warn(
        `Skipping memory generation: another run is in progress or the memory creation lock (advisory lock ${DatabaseLock.MemoryCreation}) is held by another session; will retry on the next run`,
      );
      return JobStatus.Skipped;
    }

    return JobStatus.Success;
  }

  private async createOnThisDayMemories(ownerId: string, target: DateTime) {
    const showAt = target.startOf('day').toISO();
    const hideAt = target.endOf('day').toISO();
    const memories = await this.assetRepository.getByDayOfYear([ownerId], target);
    await Promise.all(
      memories.map(({ year, assets }) =>
        this.memoryRepository.create(
          {
            ownerId,
            type: MemoryType.OnThisDay,
            data: { year },
            memoryAt: target.set({ year }).toISO()!,
            showAt,
            hideAt,
          },
          new Set(assets.map(({ id }) => id)),
        ),
      ),
    );
  }

  @OnJob({ name: JobName.MemoryCleanup, queue: QueueName.BackgroundTask })
  async onMemoriesCleanup() {
    await this.memoryRepository.cleanup();
  }

  async search(auth: AuthDto, dto: MemorySearchDto) {
    if (!isSubscriber(auth.user)) {
      return [];
    }

    const memories = await this.memoryRepository.search(auth.user.id, dto);
    return memories.map((memory) => mapMemory(memory, auth));
  }

  async statistics(auth: AuthDto, dto: MemorySearchDto) {
    if (!isSubscriber(auth.user)) {
      return { total: 0 };
    }

    return this.memoryRepository.statistics(auth.user.id, dto);
  }

  async get(auth: AuthDto, id: string): Promise<MemoryResponseDto> {
    await this.requireAccess({ auth, permission: Permission.MemoryRead, ids: [id] });
    const memory = await this.findOrFail(id);
    return mapMemory(memory, auth);
  }

  async create(auth: AuthDto, dto: MemoryCreateDto) {
    // TODO validate type/data combination

    const assetIds = dto.assetIds || [];
    const allowedAssetIds = await this.checkAccess({
      auth,
      permission: Permission.AssetShare,
      ids: assetIds,
    });
    const memory = await this.memoryRepository.create(
      {
        ownerId: auth.user.id,
        type: dto.type,
        data: dto.data,
        isSaved: dto.isSaved,
        memoryAt: dto.memoryAt,
        seenAt: dto.seenAt,
      },
      allowedAssetIds,
    );

    return mapMemory(memory, auth);
  }

  async update(auth: AuthDto, id: string, dto: MemoryUpdateDto): Promise<MemoryResponseDto> {
    await this.requireAccess({ auth, permission: Permission.MemoryUpdate, ids: [id] });

    const memory = await this.memoryRepository.update(id, {
      isSaved: dto.isSaved,
      memoryAt: dto.memoryAt,
      seenAt: dto.seenAt,
    });

    return mapMemory(memory, auth);
  }

  async remove(auth: AuthDto, id: string): Promise<void> {
    await this.requireAccess({ auth, permission: Permission.MemoryDelete, ids: [id] });
    await this.memoryRepository.delete(id);
  }

  async addAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.MemoryRead, ids: [id] });

    const repos = { access: this.accessRepository, bulk: this.memoryRepository };
    const results = await addAssets(auth, repos, { parentId: id, assetIds: dto.ids });

    const hasSuccess = results.find(({ success }) => success);
    if (hasSuccess) {
      await this.memoryRepository.update(id, { updatedAt: new Date() });
    }

    return results;
  }

  async removeAssets(auth: AuthDto, id: string, dto: BulkIdsDto): Promise<BulkIdResponseDto[]> {
    await this.requireAccess({ auth, permission: Permission.MemoryUpdate, ids: [id] });

    const repos = { access: this.accessRepository, bulk: this.memoryRepository };
    const results = await removeAssets(auth, repos, {
      parentId: id,
      assetIds: dto.ids,
      canAlwaysRemove: Permission.MemoryDelete,
    });

    const hasSuccess = results.find(({ success }) => success);
    if (hasSuccess) {
      await this.memoryRepository.update(id, { id, updatedAt: new Date() });
    }

    return results;
  }

  private async findOrFail(id: string) {
    const memory = await this.memoryRepository.get(id);
    if (!memory) {
      throw new BadRequestException('Memory not found');
    }
    return memory;
  }
}
