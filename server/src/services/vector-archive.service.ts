import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { VECTOR_ARCHIVE_LEGACY_MODELS } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnJob } from 'src/decorators';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { ArchivedVector } from 'src/repositories/database.repository';
import { BaseService } from 'src/services/base.service';
import { JobOf } from 'src/types';

const COPY_SIGNATURE = Buffer.from([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]);
// Field count, uuid length, uuid, vector length: the part of a row before the vector.
const ROW_HEAD = 2 + 4 + 16 + 4;

/**
 * The rows of one of vector-archive.py's files as they are unpacked, a few
 * at a time (the largest files hold 80,000 rows): a binary COPY of
 * (uuid, vector), the vector in pgvector's binary form (dimension, unused,
 * then the floats), each written back as text.
 */
export async function* readVectorCopy(chunks: AsyncIterable<Buffer>): AsyncGenerator<ArchivedVector> {
  let buffer: Buffer = Buffer.alloc(0);
  let headerRead = false;
  for await (const chunk of chunks) {
    buffer = buffer.length > 0 ? Buffer.concat([buffer, chunk]) : chunk;
    let offset = 0;
    if (!headerRead) {
      if (buffer.length >= 11 && !buffer.subarray(0, 11).equals(COPY_SIGNATURE)) {
        throw new Error('not a binary COPY file');
      }
      if (buffer.length < 19) {
        continue;
      }
      offset = 19 + buffer.readInt32BE(15);
      if (buffer.length < offset) {
        continue;
      }
      headerRead = true;
    }
    for (;;) {
      if (buffer.length - offset >= 2 && buffer.readInt16BE(offset) === -1) {
        return;
      }
      if (buffer.length - offset < ROW_HEAD) {
        break;
      }
      const length = buffer.readInt32BE(offset + 22);
      if (buffer.length - offset < ROW_HEAD + length) {
        break;
      }
      const dimensions = buffer.readUInt16BE(offset + ROW_HEAD);
      if (buffer.readInt16BE(offset) !== 2 || buffer.readInt32BE(offset + 2) !== 16 || length !== 4 + 4 * dimensions) {
        throw new Error('unexpected row in a binary COPY file');
      }
      const hex = buffer.toString('hex', offset + 6, offset + 22);
      const values = Array.from({ length: dimensions }, (_, i) => buffer.readFloatBE(offset + ROW_HEAD + 4 + 4 * i));
      offset += ROW_HEAD + length;
      yield {
        id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        embedding: `[${values.join(',')}]`,
      };
    }
    buffer = buffer.subarray(offset);
  }
  throw new Error(headerRead ? 'a binary COPY file that ends before its last row' : 'not a binary COPY file');
}

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
    // Read while they are written back (in the transaction, after it has
    // checked the user is still archived), so memory stays a few MB.
    const vectors: Record<'clip' | 'face', AsyncIterable<ArchivedVector> | null> = { clip: null, face: null };
    const skipped: string[] = [];
    for (const kind of ['clip', 'face'] as const) {
      const saved = archived[`${kind}Model`];
      const model = saved === 'default' ? VECTOR_ARCHIVE_LEGACY_MODELS[kind] : saved;
      if (model === models[kind]) {
        vectors[kind] = readVectorCopy(this.unpack(`${base}.${kind}.bin.zst`));
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

  /** A zstd file's content, chunk by chunk; opened on the first read. */
  private async *unpack(path: string): AsyncGenerator<Buffer> {
    const { stream } = await this.storageRepository.createReadStream(path);
    // A read or zstd error ends the iteration with it; nothing to do here.
    yield* pipeline(stream, createZstdDecompress(), () => {});
  }
}
