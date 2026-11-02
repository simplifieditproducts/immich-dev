import { Injectable } from '@nestjs/common';
import { SystemConfig } from 'src/config';
import { JOBS_ASSET_PAGINATION_SIZE, VECTOR_RESET_REFUSED } from 'src/constants';
import { OnEvent, OnJob } from 'src/decorators';
import { AssetVisibility, DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { JobItem, JobOf } from 'src/types';
import { getCLIPModelInfo, isSmartSearchEnabled } from 'src/utils/misc';

@Injectable()
export class SmartInfoService extends BaseService {
  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit({ newConfig }: ArgOf<'ConfigInit'>) {
    await this.init(newConfig);
  }

  @OnEvent({ name: 'ConfigUpdate', workers: [ImmichWorker.Microservices], server: true })
  async onConfigUpdate({ oldConfig, newConfig }: ArgOf<'ConfigUpdate'>) {
    await this.init(newConfig, oldConfig);
  }

  @OnEvent({ name: 'ConfigValidate' })
  async onConfigValidate({ newConfig, oldConfig }: ArgOf<'ConfigValidate'>) {
    try {
      getCLIPModelInfo(newConfig.machineLearning.clip.modelName);
    } catch {
      throw new Error(
        `Unknown CLIP model: ${newConfig.machineLearning.clip.modelName}. Please check the model name for typos and confirm this is a supported model.`,
      );
    }

    // A new CLIP model empties smart_search (below, in init). A new face
    // model empties nothing, but its vectors don't fit the stored ones, so
    // every face would have to be detected again. Either way the archived
    // users' vectors would no longer fit.
    if (
      oldConfig &&
      oldConfig.machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName &&
      !(await this.databaseRepository.canResetVectors('smart_search'))
    ) {
      throw new Error(`Changing the CLIP model is ${VECTOR_RESET_REFUSED}`);
    }
    if (
      oldConfig &&
      oldConfig.machineLearning.facialRecognition.modelName !== newConfig.machineLearning.facialRecognition.modelName &&
      !(await this.databaseRepository.canResetVectors('face_search'))
    ) {
      throw new Error(`Changing the facial recognition model is ${VECTOR_RESET_REFUSED}`);
    }
  }

  private async init(newConfig: SystemConfig, oldConfig?: SystemConfig) {
    if (!isSmartSearchEnabled(newConfig.machineLearning)) {
      return;
    }

    await this.databaseRepository.withLock(DatabaseLock.CLIPDimSize, async () => {
      const { dimSize } = getCLIPModelInfo(newConfig.machineLearning.clip.modelName);
      const dbDimSize = await this.databaseRepository.getDimensionSize('smart_search');
      this.logger.verbose(`Current database CLIP dimension size is ${dbDimSize}`);

      const modelChange =
        oldConfig && oldConfig.machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName;
      const dimSizeChange = dbDimSize !== dimSize;
      if (!modelChange && !dimSizeChange) {
        return;
      }

      // Also reached at start, after a model change in a config file.
      if (!(await this.databaseRepository.canResetVectors('smart_search'))) {
        this.logger.error(
          `CLIP model ${newConfig.machineLearning.clip.modelName} (dimension ${dimSize}) doesn't match the search ` +
            `vectors in the database (dimension ${dbDimSize}); not emptying smart_search: ${VECTOR_RESET_REFUSED}`,
        );
        return;
      }

      if (dimSizeChange) {
        this.logger.log(
          `Dimension size of model ${newConfig.machineLearning.clip.modelName} is ${dimSize}, but database expects ${dbDimSize}.`,
        );
        this.logger.log(`Updating database CLIP dimension size to ${dimSize}.`);
        await this.databaseRepository.setDimensionSize(dimSize);
        this.logger.log(`Successfully updated database CLIP dimension size from ${dbDimSize} to ${dimSize}.`);
      } else {
        await this.databaseRepository.deleteAllSearchEmbeddings();
      }

      // TODO: A job to reindex all assets should be scheduled, though user
      // confirmation should probably be requested before doing that.
    });
  }

  @OnJob({ name: JobName.SmartSearchQueueAll, queue: QueueName.SmartSearch })
  async handleQueueEncodeClip({ force }: JobOf<JobName.SmartSearchQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    if (force && !(await this.databaseRepository.canResetVectors('smart_search'))) {
      this.logger.error(`Smart Search "All" is ${VECTOR_RESET_REFUSED}`);
      return JobStatus.Skipped;
    }

    if (force) {
      const { dimSize } = getCLIPModelInfo(machineLearning.clip.modelName);
      // in addition to deleting embeddings, update the dimension size in case it failed earlier
      await this.databaseRepository.setDimensionSize(dimSize);
    }

    let queue: JobItem[] = [];
    const assets = this.assetJobRepository.streamForEncodeClip(force);
    for await (const asset of assets) {
      queue.push({ name: JobName.SmartSearch, data: { id: asset.id } });
      if (queue.length >= JOBS_ASSET_PAGINATION_SIZE) {
        await this.jobRepository.queueAll(queue);
        queue = [];
      }
    }

    await this.jobRepository.queueAll(queue);

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.SmartSearch, queue: QueueName.SmartSearch })
  async handleEncodeClip({ id }: JobOf<JobName.SmartSearch>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForClipEncoding(id);
    if (!asset || asset.files.length !== 1) {
      return JobStatus.Failed;
    }

    if (asset.visibility === AssetVisibility.Hidden) {
      return JobStatus.Skipped;
    }

    const embedding = await this.machineLearningRepository.encodeImage(asset.files[0].path, machineLearning.clip);

    if (this.databaseRepository.isBusy(DatabaseLock.CLIPDimSize)) {
      this.logger.verbose(`Waiting for CLIP dimension size to be updated`);
      await this.databaseRepository.wait(DatabaseLock.CLIPDimSize);
    }

    const newConfig = await this.getConfig({ withCache: true });
    if (machineLearning.clip.modelName !== newConfig.machineLearning.clip.modelName) {
      // Skip the job if the the model has changed since the embedding was generated.
      return JobStatus.Skipped;
    }

    await this.searchRepository.upsert(asset.id, embedding);

    return JobStatus.Success;
  }
}
