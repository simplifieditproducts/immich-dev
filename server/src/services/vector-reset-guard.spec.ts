import { BadRequestException } from '@nestjs/common';
import { VECTOR_RESET_REFUSED } from 'src/constants';
import { JobName, JobStatus, QueueName } from 'src/enum';
import { DuplicateService } from 'src/services/duplicate.service';
import { PersonService } from 'src/services/person.service';
import { QueueService } from 'src/services/queue.service';
import { SmartInfoService } from 'src/services/smart-info.service';
import { describe, expect, it, vitest } from 'vitest';

// The jobs and settings that empty a whole vector table are refused unless
// IMMICH_ALLOW_VECTOR_RESET is set or the table is small
// (DatabaseRepository.canResetVectors). Built without newTestService, whose
// repository mocks are out of date on this branch: only what the guards use.
const machineLearning = {
  enabled: true,
  urls: ['http://ml'],
  clip: { enabled: true, modelName: 'ViT-B-32__openai' },
  duplicateDetection: { enabled: true, maxDistance: 0.01 },
  facialRecognition: { enabled: true, modelName: 'buffalo_l', minScore: 0.7, maxDistance: 0.5, minFaces: 3 },
};

const setup = <T extends object>(Service: new (...args: any[]) => T, canReset: boolean) => {
  const sut = Object.create(Service.prototype) as any;
  sut.logger = { error: vitest.fn(), log: vitest.fn(), warn: vitest.fn(), verbose: vitest.fn(), debug: vitest.fn() };
  sut.databaseRepository = {
    canResetVectors: vitest.fn().mockResolvedValue(canReset),
    getDimensionSize: vitest.fn().mockResolvedValue(512),
    setDimensionSize: vitest.fn(),
    deleteAllSearchEmbeddings: vitest.fn(),
    withLock: vitest.fn().mockImplementation((_: unknown, fn: () => Promise<unknown>) => fn()),
    prewarm: vitest.fn(),
  };
  sut.personRepository = { deleteFaces: vitest.fn(), unassignFaces: vitest.fn(), vacuum: vitest.fn() };
  sut.jobRepository = {
    isActive: vitest.fn().mockResolvedValue(false),
    queue: vitest.fn(),
    waitForQueueCompletion: vitest.fn(),
  };
  sut.eventRepository = { emit: vitest.fn() };
  sut.getConfig = vitest.fn().mockResolvedValue({ machineLearning });
  return sut as T & typeof sut;
};

describe('vector reset guard', () => {
  describe('refused on a large server', () => {
    it('Smart Search "All" (job)', async () => {
      const sut = setup(SmartInfoService, false);
      await expect(sut.handleQueueEncodeClip({ force: true })).resolves.toBe(JobStatus.Skipped);
      expect(sut.databaseRepository.canResetVectors).toHaveBeenCalledWith('smart_search');
      expect(sut.databaseRepository.setDimensionSize).not.toHaveBeenCalled();
      expect(sut.logger.error).toHaveBeenCalledWith(expect.stringContaining(VECTOR_RESET_REFUSED));
    });

    it('Face Detection "All" (job)', async () => {
      const sut = setup(PersonService, false);
      await expect(sut.handleQueueDetectFaces({ force: true })).resolves.toBe(JobStatus.Skipped);
      expect(sut.databaseRepository.canResetVectors).toHaveBeenCalledWith('face_search');
      expect(sut.personRepository.deleteFaces).not.toHaveBeenCalled();
      expect(sut.personRepository.vacuum).not.toHaveBeenCalled();
    });

    it('Facial Recognition "All" (job)', async () => {
      const sut = setup(PersonService, false);
      await expect(sut.handleQueueRecognizeFaces({ force: true })).resolves.toBe(JobStatus.Skipped);
      expect(sut.personRepository.unassignFaces).not.toHaveBeenCalled();
      expect(sut.personRepository.vacuum).not.toHaveBeenCalled();
    });

    it('Duplicate Detection "All" (job)', async () => {
      const sut = setup(DuplicateService, false);
      (sut as any).assetJobRepository = { streamForSearchDuplicates: vitest.fn() };
      await expect(sut.handleQueueSearchDuplicates({ force: true })).resolves.toBe(JobStatus.Skipped);
      expect(sut.databaseRepository.canResetVectors).toHaveBeenCalledWith('smart_search');
      expect((sut as any).assetJobRepository.streamForSearchDuplicates).not.toHaveBeenCalled();
    });

    it.each([
      QueueName.SmartSearch,
      QueueName.DuplicateDetection,
      QueueName.FaceDetection,
      QueueName.FacialRecognition,
    ])('"All" from the Jobs page (%s)', async (name) => {
      const sut = setup(QueueService, false);
      await expect((sut as any).start(name, { force: true })).rejects.toBeInstanceOf(BadRequestException);
      expect(sut.jobRepository.queue).not.toHaveBeenCalled();
    });

    it('changing the CLIP model in the settings', async () => {
      const sut = setup(SmartInfoService, false);
      const oldConfig = { machineLearning } as any;
      const newConfig = {
        machineLearning: { ...machineLearning, clip: { enabled: true, modelName: 'ViT-B-16__openai' } },
      } as any;
      await expect(sut.onConfigValidate({ oldConfig, newConfig })).rejects.toThrow(VECTOR_RESET_REFUSED);
    });

    it('a model that no longer matches the vectors at start', async () => {
      const sut = setup(SmartInfoService, false);
      sut.databaseRepository.getDimensionSize.mockResolvedValue(768);
      await sut.onConfigInit({ newConfig: { machineLearning } as any });
      expect(sut.databaseRepository.setDimensionSize).not.toHaveBeenCalled();
      expect(sut.databaseRepository.deleteAllSearchEmbeddings).not.toHaveBeenCalled();
      expect(sut.logger.error).toHaveBeenCalled();
    });
  });

  describe('still allowed', () => {
    it('"Missing" (no force) from the Jobs page', async () => {
      const sut = setup(QueueService, false);
      await (sut as any).start(QueueName.SmartSearch, { force: false });
      expect(sut.databaseRepository.canResetVectors).not.toHaveBeenCalled();
      expect(sut.jobRepository.queue).toHaveBeenCalledWith({
        name: JobName.SmartSearchQueueAll,
        data: { force: false },
      });
    });

    it('settings saved without a model change', async () => {
      const sut = setup(SmartInfoService, false);
      const config = { machineLearning } as any;
      await expect(sut.onConfigValidate({ oldConfig: config, newConfig: config })).resolves.toBeUndefined();
      expect(sut.databaseRepository.canResetVectors).not.toHaveBeenCalled();
    });

    it('"All" with IMMICH_ALLOW_VECTOR_RESET or small tables', async () => {
      const sut = setup(QueueService, true);
      await (sut as any).start(QueueName.FaceDetection, { force: true });
      expect(sut.jobRepository.queue).toHaveBeenCalledWith({
        name: JobName.AssetDetectFacesQueueAll,
        data: { force: true },
      });
    });

    it.each([
      ['"Missing"', {}, { personId: null, sourceType: 'machine-learning', skipArchivedOwners: true }],
      [
        'one user',
        { ownerId: 'u1' },
        { personId: null, sourceType: 'machine-learning', ownerIds: ['u1'], skipArchivedOwners: true },
      ],
      ['"All"', { force: true }, { skipArchivedOwners: true }],
    ])('Facial Recognition %s leaves out archived users', async (_, data, expected) => {
      const sut = setup(PersonService, true);
      (sut as any).handlePersonCleanup = vitest.fn();
      (sut as any).systemMetadataRepository = { set: vitest.fn() };
      sut.personRepository.getAllFaces = vitest.fn().mockReturnValue((async function* () {})());
      sut.jobRepository.queueAll = vitest.fn();
      await expect(sut.handleQueueRecognizeFaces(data)).resolves.toBe(JobStatus.Success);
      expect(sut.personRepository.getAllFaces).toHaveBeenCalledWith(expected);
    });

    it('Face Detection "All" vacuums without face_search', async () => {
      const sut = setup(PersonService, true);
      (sut as any).handlePersonCleanup = vitest.fn();
      (sut as any).assetJobRepository = {
        streamForDetectFacesJob: vitest.fn().mockReturnValue((async function* () {})()),
      };
      sut.jobRepository.queueAll = vitest.fn();
      await sut.handleQueueDetectFaces({ force: true });
      expect(sut.personRepository.deleteFaces).toHaveBeenCalled();
      expect(sut.personRepository.vacuum).toHaveBeenCalledWith();
    });
  });
});
