import { Readable } from 'node:stream';
import { zstdCompressSync } from 'node:zlib';
import { StorageCore } from 'src/cores/storage.core';
import { JobName, JobStatus } from 'src/enum';
import { AuthService } from 'src/services/auth.service';
import { DuplicateService } from 'src/services/duplicate.service';
import { readVectorCopy, VectorArchiveService } from 'src/services/vector-archive.service';
import { describe, expect, it, vitest } from 'vitest';

// The restore of immich-devops' vector archive at login (VectorArchiveService)
// and the jobs that wait for it. Built without newTestService, like
// vector-reset-guard.spec.ts: only what these use.

// A binary COPY of (uuid, vector) rows, as vector-archive.py writes them.
const copyOf = (rows: { id: string; values: number[] }[]) => {
  const parts = [Buffer.from([0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00]), Buffer.alloc(8)];
  for (const { id, values } of rows) {
    const row = Buffer.alloc(2 + 4 + 16 + 4 + 4 + 4 * values.length);
    row.writeInt16BE(2, 0);
    row.writeInt32BE(16, 2);
    Buffer.from(id.replaceAll('-', ''), 'hex').copy(row, 6);
    row.writeInt32BE(4 + 4 * values.length, 22);
    row.writeUInt16BE(values.length, 26);
    for (const [i, value] of values.entries()) {
      row.writeFloatBE(value, 30 + 4 * i);
    }
    parts.push(row);
  }
  const end = Buffer.alloc(2);
  end.writeInt16BE(-1, 0);
  return Buffer.concat([...parts, end]);
};

const ASSET = '6d4c0645-e07b-43e7-ad12-93db5674e118';
const FACE = '700df597-f9a1-477d-8446-1305d399352b';
const USER = 'b19c841b-34e5-46d3-9534-4847b69e8123';
const machineLearning = {
  clip: { modelName: 'ViT-B-16-SigLIP__webli' },
  facialRecognition: { modelName: 'buffalo_l' },
};

const RESTORED = { clip: 1, face: 1 };

const toArray = async <T>(rows: AsyncIterable<T>) => {
  const all: T[] = [];
  for await (const row of rows) {
    all.push(row);
  }
  return all;
};

const restoreService = (archived?: object, restored: object | string | null = RESTORED) => {
  StorageCore.setMediaLocation('/usr/src/app/upload');
  const sut = Object.create(VectorArchiveService.prototype) as any;
  sut.logger = { log: vitest.fn(), warn: vitest.fn(), error: vitest.fn() };
  sut.getConfig = vitest.fn().mockResolvedValue({ machineLearning });
  sut.databaseRepository = {
    getArchivedVectorUser: vitest.fn().mockResolvedValue(archived),
    // Reads what it is given, as the real one does in its transaction.
    restoreArchivedVectors: vitest.fn().mockImplementation(async (_: string, vectors: Record<string, any>) => {
      sut.written = {
        clip: vectors.clip && (await toArray(vectors.clip)),
        face: vectors.face && (await toArray(vectors.face)),
      };
      return restored;
    }),
  };
  sut.storageRepository = {
    createReadStream: vitest.fn().mockImplementation((path: string) => {
      const copy = path.endsWith('.clip.bin.zst')
        ? copyOf([{ id: ASSET, values: [1, 2.5] }])
        : copyOf([{ id: FACE, values: [-3] }]);
      return Promise.resolve({ stream: Readable.from([zstdCompressSync(copy)]) });
    }),
    rename: vitest.fn(),
  };
  return sut;
};

const archivedUser = { clipCount: 1, faceCount: 1, clipModel: 'ViT-B-16-SigLIP__webli', faceModel: 'default' };

// AuthService's login response for USER, archived or not (or the check failing).
const login = (archived: boolean | Error) => {
  const sut = Object.create(AuthService.prototype) as any;
  sut.logger = { warn: vitest.fn() };
  sut.cryptoRepository = { randomBytesAsText: () => 'token', hashSha256: () => 'hashed' };
  sut.sessionRepository = { create: vitest.fn() };
  sut.databaseRepository = {
    hasArchivedVectors:
      archived instanceof Error ? vitest.fn().mockRejectedValue(archived) : vitest.fn().mockResolvedValue(archived),
  };
  sut.jobRepository = { queue: vitest.fn() };
  const user = { id: USER, email: 'a@b.c', name: 'A', isAdmin: false, profileImagePath: '', metadata: [] };
  return { sut, response: sut.createLoginResponse(user, {}) };
};

describe('vector archive restore', () => {
  it('reads a binary COPY of (uuid, vector), however it is cut into chunks', async () => {
    const copy = copyOf([
      { id: ASSET, values: [1, 2.5, -3] },
      { id: FACE, values: [0.5] },
    ]);
    const rows = [
      { id: ASSET, embedding: '[1,2.5,-3]' },
      { id: FACE, embedding: '[0.5]' },
    ];
    await expect(toArray(readVectorCopy(Readable.from([copy])))).resolves.toEqual(rows);
    const bytes = [...copy].map((byte) => Buffer.from([byte]));
    await expect(toArray(readVectorCopy(Readable.from(bytes)))).resolves.toEqual(rows);
  });

  it('refuses what is not a whole binary COPY', async () => {
    await expect(toArray(readVectorCopy(Readable.from([Buffer.from('not a copy at all')])))).rejects.toThrow(
      'not a binary COPY file',
    );
    const copy = copyOf([{ id: ASSET, values: [1, 2.5] }]);
    await expect(toArray(readVectorCopy(Readable.from([copy.subarray(0, -5)])))).rejects.toThrow(
      'ends before its last row',
    );
  });

  it('puts back both kinds, then renames the files', async () => {
    const sut = restoreService(archivedUser);
    await expect(sut.handleVectorRestore({ id: USER })).resolves.toBe(JobStatus.Success);
    expect(sut.storageRepository.createReadStream).toHaveBeenCalledWith(
      `/usr/src/app/upload/vector-archive/b1/${USER}.clip.bin.zst`,
    );
    // 'default' in the registry is buffalo_l, the face model in use.
    expect(sut.written).toEqual({
      clip: [{ id: ASSET, embedding: '[1,2.5]' }],
      face: [{ id: FACE, embedding: '[-3]' }],
    });
    expect(sut.storageRepository.rename).toHaveBeenCalledTimes(2);
    expect(sut.storageRepository.rename).toHaveBeenCalledWith(
      `/usr/src/app/upload/vector-archive/b1/${USER}.face.bin.zst`,
      expect.stringMatching(new RegExp(String.raw`/${USER}\.face\.bin\.zst\.restored-\d{8}-\d{6}$`)),
    );
  });

  it('leaves out the vectors of a model no longer in use', async () => {
    const sut = restoreService({ ...archivedUser, faceModel: 'antelopev2' });
    await expect(sut.handleVectorRestore({ id: USER })).resolves.toBe(JobStatus.Success);
    expect(sut.storageRepository.createReadStream).toHaveBeenCalledTimes(1);
    expect(sut.written).toEqual({ clip: [{ id: ASSET, embedding: '[1,2.5]' }], face: null });
    expect(sut.logger.warn).toHaveBeenCalledWith(expect.stringContaining('face (antelopev2 -> buffalo_l)'));
  });

  it('skips a user who is not archived', async () => {
    const sut = restoreService();
    await expect(sut.handleVectorRestore({ id: USER })).resolves.toBe(JobStatus.Skipped);
    expect(sut.storageRepository.createReadStream).not.toHaveBeenCalled();
  });

  it('leaves a user to the restore already running (a second login)', async () => {
    const sut = restoreService(archivedUser, 'busy');
    await expect(sut.handleVectorRestore({ id: USER })).resolves.toBe(JobStatus.Skipped);
    expect(sut.storageRepository.rename).not.toHaveBeenCalled();
    expect(sut.logger.log).toHaveBeenCalledWith(expect.stringContaining('is being restored already'));
  });

  it('keeps the files of a user restored meanwhile (the cron)', async () => {
    const sut = restoreService(archivedUser, null);
    await expect(sut.handleVectorRestore({ id: USER })).resolves.toBe(JobStatus.Skipped);
    expect(sut.storageRepository.rename).not.toHaveBeenCalled();
  });

  describe('at login', () => {
    it('queues the restore of an archived user', async () => {
      const { sut, response } = login(true);
      await expect(response).resolves.toMatchObject({ accessToken: 'token', userId: USER });
      expect(sut.jobRepository.queue).toHaveBeenCalledWith({ name: JobName.VectorRestore, data: { id: USER } });
    });

    it('queues nothing for anyone else', async () => {
      const { sut, response } = login(false);
      await response;
      expect(sut.jobRepository.queue).not.toHaveBeenCalled();
    });

    it('logs in even when the check fails', async () => {
      const { sut, response } = login(new Error('relation does not exist'));
      await expect(response).resolves.toMatchObject({ accessToken: 'token' });
      expect(sut.logger.warn).toHaveBeenCalled();
    });
  });

  it('Duplicate Detection waits a minute while the owner is archived', async () => {
    const sut = Object.create(DuplicateService.prototype) as any;
    sut.logger = { warn: vitest.fn(), error: vitest.fn(), debug: vitest.fn() };
    sut.getConfig = vitest.fn().mockResolvedValue({
      machineLearning: {
        enabled: true,
        urls: ['http://ml'],
        clip: { enabled: true },
        duplicateDetection: { enabled: true, maxDistance: 0.01 },
      },
    });
    sut.assetJobRepository = { getForSearchDuplicatesJob: vitest.fn().mockResolvedValue({ id: ASSET, ownerId: USER }) };
    sut.databaseRepository = { hasArchivedVectors: vitest.fn().mockResolvedValue(true) };
    sut.jobRepository = { queue: vitest.fn() };
    sut.redisRepository = { tryAcquireLock: vitest.fn() };
    await expect(sut.handleSearchDuplicates({ id: ASSET })).resolves.toBe(JobStatus.Skipped);
    expect(sut.databaseRepository.hasArchivedVectors).toHaveBeenCalledWith(USER, 'clip');
    expect(sut.jobRepository.queue).toHaveBeenCalledWith({
      name: JobName.AssetDetectDuplicates,
      data: { id: ASSET, userId: USER, archivedWaits: 1, delay: 60_000 },
    });
    expect(sut.redisRepository.tryAcquireLock).not.toHaveBeenCalled();
  });
});
