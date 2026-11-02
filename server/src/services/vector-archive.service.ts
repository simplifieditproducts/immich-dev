import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';
import { VECTOR_ARCHIVE_LEGACY_MODELS } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { ArchivedVector } from 'src/repositories/database.repository';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';

const unzstd = promisify(zstdDecompress);
const COPY_SIGNATURE = Buffer.from([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);

/**
 * The rows of one of vector-archive.py's files once unpacked: a binary COPY
 * of (uuid, vector), the vector in pgvector's binary form (dimension, unused,
 * then the floats), each written back as text.
 */
export const parseVectorCopy = (buffer: Buffer): ArchivedVector[] => {
  if (buffer.length < 19 || !buffer.subarray(0, 11).equals(COPY_SIGNATURE)) {
    throw new Error('not a binary COPY file');
  }
  let offset = 15;
  offset += 4 + buffer.readInt32BE(offset);
  const rows: ArchivedVector[] = [];
  for (;;) {
    const fields = buffer.readInt16BE(offset);
    offset += 2;
    if (fields === -1) {
      return rows;
    }
    if (fields !== 2 || buffer.readInt32BE(offset) !== 16) {
      throw new Error(`unexpected row at byte ${offset}`);
    }
    const hex = buffer.toString('hex', offset + 4, offset + 20);
    offset += 20;
    const length = buffer.readInt32BE(offset);
    const dimensions = buffer.readUInt16BE(offset + 4);
    if (length !== 4 + 4 * dimensions) {
      throw new Error(`unexpected vector at byte ${offset}`);
    }
    const values = Array.from({ length: dimensions }, (_, i) => buffer.readFloatBE(offset + 8 + 4 * i));
    offset += 4 + length;
    rows.push({
      id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
      embedding: `[${values.join(',')}]`,
    });
  }
};

// immich-devops' scripts/vector-archive.py moves idle free users' search and
// face vectors to files (docs/vector-index-capacity.md). This puts them back
// when the user returns, as the script's `restore` does; its cron (every 5
// minutes) stays as the fallback, both under the same lock.
@Injectable()
export class VectorArchiveService extends BaseService {
  @OnJob({ name: JobName.VectorRestore, queue: QueueName.BackgroundTask })
  async handleVectorRestore({ id }: JobOf<JobName.VectorRestore>): Promise<JobStatus> {
    const archived = await this.databaseRepository.getArchivedVectorUser(id);
    if (!archived) {
      return JobStatus.Skipped;
    }

    // Vectors of a model Immich no longer uses don't fit: that part isn't
    // loaded, but the user still leaves the registry, as with the script.
    const { machineLearning } = await this.getConfig({ withCache: false });
    const models = { clip: machineLearning.clip.modelName, face: machineLearning.facialRecognition.modelName };
    const base = join(StorageCore.getMediaLocation(), 'vector-archive', id.slice(0, 2), id);
    const vectors: Record<'clip' | 'face', ArchivedVector[] | null> = { clip: null, face: null };
    const skipped: string[] = [];
    for (const kind of ['clip', 'face'] as const) {
      const saved = archived[`${kind}Model`];
      const model = saved === 'default' ? VECTOR_ARCHIVE_LEGACY_MODELS[kind] : saved;
      if (model === models[kind]) {
        vectors[kind] = parseVectorCopy(
          await unzstd(await this.storageRepository.readWholeFile(`${base}.${kind}.bin.zst`)),
        );
      } else {
        skipped.push(`${kind} (${model} -> ${models[kind]})`);
      }
    }

    const started = Date.now();
    const restored = await this.databaseRepository.restoreArchivedVectors(id, vectors);
    if (!restored) {
      this.logger.log(`User ${id} was restored meanwhile`);
      return JobStatus.Skipped;
    }

    // Kept for a while (the script's daily run deletes them after 30 days),
    // under a name that lets the user be archived again.
    const suffix = `.restored-${DateTime.utc().toFormat('yyyyLLdd-HHmmss')}`;
    for (const kind of ['clip', 'face']) {
      await this.storageRepository.rename(`${base}.${kind}.bin.zst`, `${base}.${kind}.bin.zst${suffix}`);
    }
    this.logger.log(
      `Restored the archived vectors of user ${id}: search ${restored.clip} (archived ${archived.clipCount}), ` +
        `faces ${restored.face} (archived ${archived.faceCount}), ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    if (skipped.length > 0) {
      this.logger.warn(
        `User ${id}: not restored, the model changed: ${skipped.join(', ')}. Search vectors come back with Smart ` +
          `Search "Missing"; faces stay without vectors until Face Detection "All" runs.`,
      );
    }
    return JobStatus.Success;
  }
}
