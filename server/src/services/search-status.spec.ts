import { LRUMap, LRUMapWithDelete } from 'mnemonist';
import { SEARCH_STATUS_CACHE_MS, SEARCH_STATUS_MAX_USERS, SEARCH_STATUS_RESTORE_RETRY_MS } from 'src/constants';
import { JobName, SearchStatus } from 'src/enum';
import { JobRepository } from 'src/repositories/job.repository';
import { UserService } from 'src/services/user.service';
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest';

// GET /users/me/search-status (UserService.getSearchStatus). Built without
// newTestService, like vector-archive.service.spec.ts: only what it uses.

const USER = 'b19c841b-34e5-46d3-9534-4847b69e8123';
const auth = { user: { id: USER } } as any;
// Each group's assets is as if its steps had left the same photos, unless given.
const counts = (
  assets: number,
  search: number,
  required: Record<string, number> = {},
  deferrable: Record<string, number> = {},
) => {
  const requiredSteps = { smartSearch: search, metadataExtraction: 0, thumbnailGeneration: 0, ...required };
  const deferrableSteps = { faceDetection: 7, ocr: 3, videoConversion: 1, duplicateDetection: 2, ...deferrable };
  return {
    assets,
    required: { assets: Math.max(...Object.values(requiredSteps)), ...requiredSteps },
    deferrable: { assets: Math.max(...Object.values(deferrableSteps)), ...deferrableSteps },
  };
};

const service = (
  archived: () => boolean,
  progress: () => ReturnType<typeof counts>,
  maxUsers = SEARCH_STATUS_MAX_USERS,
) => {
  const sut = Object.create(UserService.prototype) as any;
  sut.searchProgress = new LRUMap(maxUsers);
  sut.restoreQueuedAt = new LRUMapWithDelete(maxUsers);
  sut.databaseRepository = {
    getArchivedVectorUser: vitest
      .fn()
      .mockImplementation(() => Promise.resolve(archived() ? { clipCount: 1 } : undefined)),
  };
  sut.userRepository = { getSearchProgress: vitest.fn().mockImplementation(() => Promise.resolve(progress())) };
  sut.jobRepository = { queue: vitest.fn() };
  return sut;
};

describe('search status', () => {
  beforeEach(() => {
    vitest.useFakeTimers();
    vitest.setSystemTime(new Date('2026-11-03T02:00:00Z'));
  });
  afterEach(() => {
    vitest.useRealTimers();
  });

  it('is ready with up to 5% of the photos still without a search vector', async () => {
    const sut = service(
      () => false,
      () => counts(200, 10),
    );
    await expect(sut.getSearchStatus(auth)).resolves.toEqual({
      status: SearchStatus.Ready,
      assets: 200,
      remaining: {
        required: { assets: 10, smartSearch: 10, metadataExtraction: 0, thumbnailGeneration: 0 },
        deferrable: { assets: 7, faceDetection: 7, ocr: 3, videoConversion: 1, duplicateDetection: 2 },
      },
      countedAt: new Date('2026-11-03T02:00:00Z'),
    });
  });

  it('is processing with more than 5% without one, whatever faces and OCR have left', async () => {
    const sut = service(
      () => false,
      () => counts(200, 11),
    );
    await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ status: SearchStatus.Processing });
  });

  it('is processing while metadata or thumbnails are missing for more than 5%, but not for the deferrable steps', async () => {
    for (const [required, deferrable, status] of [
      [{ metadataExtraction: 11 }, {}, SearchStatus.Processing],
      [{ thumbnailGeneration: 11 }, {}, SearchStatus.Processing],
      [{}, { faceDetection: 200, ocr: 200, videoConversion: 200, duplicateDetection: 200 }, SearchStatus.Ready],
    ] as const) {
      const sut = service(
        () => false,
        () => counts(200, 0, required, deferrable),
      );
      await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ status });
    }
  });

  it('goes by the photos left in all, each counted once, not by the step with the most', async () => {
    for (const [left, status] of [
      [10, SearchStatus.Ready],
      [11, SearchStatus.Processing],
    ] as const) {
      const sut = service(
        () => false,
        () => counts(200, 6, { assets: left, metadataExtraction: 5, thumbnailGeneration: 4 }),
      );
      await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ status });
    }
  });

  it('allows 10 photos left whatever the share, for users with few photos', async () => {
    for (const [left, status] of [
      [10, SearchStatus.Ready],
      [11, SearchStatus.Processing],
    ] as const) {
      const sut = service(
        () => false,
        () => counts(40, left),
      );
      await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ status });
    }
  });

  it('is ready for a user without photos', async () => {
    const sut = service(
      () => false,
      () => counts(0, 0),
    );
    await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ status: SearchStatus.Ready, assets: 0 });
  });

  it('is archived while the vector archive holds the user, and queues the restore at most once a minute', async () => {
    const sut = service(
      () => true,
      () => counts(200, 200),
    );
    const restore = { name: JobName.VectorRestore, data: { id: USER } };
    await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ status: SearchStatus.Archived });
    // Right away: the login's may have failed (one still waiting makes this a no-op).
    expect(sut.jobRepository.queue).toHaveBeenCalledExactlyOnceWith(restore);

    vitest.advanceTimersByTime(SEARCH_STATUS_RESTORE_RETRY_MS - 1000);
    await sut.getSearchStatus(auth);
    expect(sut.jobRepository.queue).toHaveBeenCalledTimes(1);

    vitest.advanceTimersByTime(1000);
    await sut.getSearchStatus(auth);
    expect(sut.jobRepository.queue).toHaveBeenCalledTimes(2);
  });

  it('keeps the counts for 10 seconds, but counts again as soon as the restore is done', async () => {
    let archived = true;
    let progress = counts(200, 200);
    const sut = service(
      () => archived,
      () => progress,
    );
    await sut.getSearchStatus(auth);
    await sut.getSearchStatus(auth);
    expect(sut.userRepository.getSearchProgress).toHaveBeenCalledTimes(1);

    archived = false;
    progress = counts(200, 0);
    vitest.advanceTimersByTime(5000);
    await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({
      status: SearchStatus.Ready,
      remaining: { required: { assets: 0, smartSearch: 0 } },
      countedAt: new Date('2026-11-03T02:00:05Z'),
    });
    expect(sut.userRepository.getSearchProgress).toHaveBeenCalledTimes(2);

    progress = counts(201, 20);
    vitest.advanceTimersByTime(SEARCH_STATUS_CACHE_MS - 1);
    await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ assets: 200 });
    vitest.advanceTimersByTime(1);
    await expect(sut.getSearchStatus(auth)).resolves.toMatchObject({ assets: 201, status: SearchStatus.Processing });
  });

  it('queues the restore at once when the user is archived again later', async () => {
    let archived = true;
    const sut = service(
      () => archived,
      () => counts(200, 200),
    );
    await sut.getSearchStatus(auth);
    archived = false;
    await sut.getSearchStatus(auth);
    expect(sut.restoreQueuedAt.has(USER)).toBe(false);

    archived = true;
    await sut.getSearchStatus(auth);
    expect(sut.jobRepository.queue).toHaveBeenCalledTimes(2);
  });
});

describe('vector restore jobs', () => {
  it('are one per user while one waits or runs, ahead of the queue, through add()', async () => {
    const sut = Object.create(JobRepository.prototype) as any;
    const add = vitest.fn();
    const addBulk = vitest.fn();
    sut.getQueue = () => ({ add, addBulk });
    sut.getQueueName = () => 'backgroundTask';

    await sut.queueAll([{ name: JobName.VectorRestore, data: { id: USER } }]);

    expect(add).toHaveBeenCalledExactlyOnceWith(
      JobName.VectorRestore,
      { id: USER },
      {
        lifo: true,
        jobId: `VectorRestore/${USER}`,
      },
    );
  });

  it('keeps the counts of the most recent users only', async () => {
    const sut = service(
      () => false,
      () => counts(200, 0),
      1,
    );
    const other = { user: { id: 'a3a8e6b5-5f0b-4f4e-9c55-7d0a4f4a1b11' } } as any;

    await sut.getSearchStatus(auth);
    await sut.getSearchStatus(auth);
    expect(sut.userRepository.getSearchProgress).toHaveBeenCalledTimes(1);

    await sut.getSearchStatus(other);
    await sut.getSearchStatus(auth);
    expect(sut.userRepository.getSearchProgress).toHaveBeenCalledTimes(3);
  });
});
