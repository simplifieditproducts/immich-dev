import { DateTime } from 'luxon';
import { Stats } from 'node:fs';
import { PassThrough } from 'node:stream';
import { defaults, SystemConfig } from 'src/config';
import { StorageCore } from 'src/cores/storage.core';
import { ImmichWorker, JobStatus, StorageFolder } from 'src/enum';
import { BackupService } from 'src/services/backup.service';
import { systemConfigStub } from 'test/fixtures/system-config.stub';
import { mockSpawn, newTestService, ServiceMocks } from 'test/utils';
import { describe } from 'vitest';

const folder = (date: string) =>
  `immich-db-backup-${DateTime.fromISO(date).toFormat("yyyyLLdd'T'HHmmss")}-v1.234.0-pg14.5`;

describe(BackupService.name, () => {
  let sut: BackupService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(BackupService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('onBootstrapEvent', () => {
    it('should init cron job and handle config changes', async () => {
      mocks.database.tryLock.mockResolvedValue(true);
      mocks.cron.create.mockResolvedValue();

      await sut.onConfigInit({ newConfig: systemConfigStub.backupEnabled as SystemConfig });

      expect(mocks.cron.create).toHaveBeenCalled();
    });

    it('should not initialize backup database cron job when lock is taken', async () => {
      mocks.database.tryLock.mockResolvedValue(false);

      await sut.onConfigInit({ newConfig: systemConfigStub.backupEnabled as SystemConfig });

      expect(mocks.cron.create).not.toHaveBeenCalled();
    });

    it('should not initialise backup database job when running on microservices', async () => {
      mocks.config.getWorker.mockReturnValue(ImmichWorker.Microservices);
      await sut.onConfigInit({ newConfig: systemConfigStub.backupEnabled as SystemConfig });

      expect(mocks.cron.create).not.toHaveBeenCalled();
    });
  });

  describe('onConfigUpdateEvent', () => {
    beforeEach(async () => {
      mocks.database.tryLock.mockResolvedValue(true);
      mocks.cron.create.mockResolvedValue();

      await sut.onConfigInit({ newConfig: defaults });
    });

    it('should update cron job if backup is enabled', () => {
      mocks.cron.update.mockResolvedValue();

      sut.onConfigUpdate({
        oldConfig: defaults,
        newConfig: {
          backup: {
            database: {
              enabled: true,
              cronExpression: '0 1 * * *',
            },
          },
        } as SystemConfig,
      });

      expect(mocks.cron.update).toHaveBeenCalledWith({ name: 'backupDatabase', expression: '0 1 * * *', start: true });
      expect(mocks.cron.update).toHaveBeenCalled();
    });

    it('should do nothing if instance does not have the backup database lock', async () => {
      mocks.database.tryLock.mockResolvedValue(false);
      await sut.onConfigInit({ newConfig: defaults });
      sut.onConfigUpdate({ newConfig: systemConfigStub.backupEnabled as SystemConfig, oldConfig: defaults });
      expect(mocks.cron.update).not.toHaveBeenCalled();
    });
  });

  describe('cleanupDatabaseBackups', () => {
    it('should do nothing if not reached keepLastAmount', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      mocks.storage.readdir.mockResolvedValue(['immich-db-backup-1.sql.gz']);
      await sut.cleanupDatabaseBackups();
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
    });

    let backups: string;

    beforeEach(() => {
      backups = StorageCore.getBaseFolder(StorageFolder.Backups);
      mocks.storage.stat.mockImplementation((path) =>
        Promise.resolve({ isDirectory: () => !path.toString().endsWith('.tmp') } as Stats),
      );
    });

    it('should remove failed backup files', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      mocks.storage.readdir.mockResolvedValue([
        'immich-db-backup-123.sql.gz.tmp',
        folder('2025-07-25T11:02:16Z'),
        folder('2025-07-27T11:01:16Z'),
        folder('2025-07-29T11:01:16Z'),
      ]);
      await sut.cleanupDatabaseBackups();
      expect(mocks.storage.unlink).toHaveBeenCalledExactlyOnceWith(`${backups}/immich-db-backup-123.sql.gz.tmp`);
    });

    it('should remove old backup folders over keepLastAmount', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      mocks.storage.readdir.mockResolvedValue([folder('2025-07-25T11:02:16Z'), folder('2025-07-29T11:01:16Z')]);
      await sut.cleanupDatabaseBackups();
      expect(mocks.storage.unlinkDir).toHaveBeenCalledExactlyOnceWith(`${backups}/${folder('2025-07-25T11:02:16Z')}`, {
        recursive: true,
        force: true,
      });
    });

    it('should keep the newest backups when it removes old ones and failed ones', async () => {
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      mocks.storage.readdir.mockResolvedValue([
        folder('2025-07-25T11:02:16Z'),
        folder('2025-07-27T11:01:16Z'),
        'immich-db-backup-1753789649000.sql.gz.tmp',
        folder('2025-07-29T11:01:16Z'),
      ]);
      await sut.cleanupDatabaseBackups();
      expect(mocks.storage.unlink).toHaveBeenCalledExactlyOnceWith(
        `${backups}/immich-db-backup-1753789649000.sql.gz.tmp`,
      );
      expect(mocks.storage.unlinkDir).toHaveBeenCalledTimes(2);
      expect(mocks.storage.unlinkDir).not.toHaveBeenCalledWith(
        `${backups}/${folder('2025-07-29T11:01:16Z')}`,
        expect.anything(),
      );
    });
  });

  describe('handleBackupDatabase', () => {
    beforeEach(() => {
      mocks.storage.readdir.mockResolvedValue([]);
      mocks.process.spawn.mockReturnValue(mockSpawn(0, 'data', ''));
      mocks.storage.rename.mockResolvedValue();
      mocks.storage.unlink.mockResolvedValue();
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      mocks.storage.createWriteStream.mockReturnValue(new PassThrough());
    });

    it('should sanitize DB_URL (remove uselibpqcompat) before calling pg_dumpall', async () => {
      // create a service instance with a URL connection that includes libpqcompat
      const dbUrl = 'postgresql://postgres:pwd@host:5432/immich?sslmode=require&uselibpqcompat=true';
      const configMock = {
        getEnv: () => ({ database: { config: { connectionType: 'url', url: dbUrl }, skipMigrations: false } }),
        getWorker: () => ImmichWorker.Api,
        isDev: () => false,
      } as unknown as any;

      ({ sut, mocks } = newTestService(BackupService, { config: configMock }));

      mocks.storage.readdir.mockResolvedValue([]);
      mocks.process.spawn.mockReturnValue(mockSpawn(0, 'data', ''));
      mocks.storage.rename.mockResolvedValue();
      mocks.storage.unlink.mockResolvedValue();
      mocks.systemMetadata.get.mockResolvedValue(systemConfigStub.backupEnabled);
      mocks.storage.createWriteStream.mockReturnValue(new PassThrough());
      mocks.database.getPostgresVersion.mockResolvedValue('14.10');

      await sut.handleBackupDatabase();

      expect(mocks.process.spawn).toHaveBeenCalled();
      const call = mocks.process.spawn.mock.calls[0];
      const args = call[1] as string[];
      // ['--dbname', '<url>', '--clean', '--if-exists']
      expect(args[0]).toBe('--dbname');
      const passedUrl = args[1];
      expect(passedUrl).not.toContain('uselibpqcompat');
      expect(passedUrl).toContain('sslmode=require');
    });

    it('should run a database backup successfully', async () => {
      const result = await sut.handleBackupDatabase();
      expect(result).toBe(JobStatus.Success);
      expect(mocks.storage.createWriteStream).toHaveBeenCalled();
    });

    it('should rename file on success', async () => {
      const result = await sut.handleBackupDatabase();
      expect(result).toBe(JobStatus.Success);
      expect(mocks.storage.rename).toHaveBeenCalled();
    });

    it('should fail if pg_dumpall fails', async () => {
      mocks.process.spawn.mockReturnValueOnce(mockSpawn(1, '', 'error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('Globals backup failed with code 1');
    });

    it('should not rename the folder if pg_dumpall fails', async () => {
      mocks.process.spawn.mockReturnValueOnce(mockSpawn(1, '', 'error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('Globals backup failed with code 1');
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it('should fail if pg_dump fails', async () => {
      mocks.process.spawn.mockReturnValueOnce(mockSpawn(0, 'data', ''));
      mocks.process.spawn.mockReturnValueOnce(mockSpawn(1, '', 'error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('Database backup failed with code 1');
    });

    it('should fail if write stream fails', async () => {
      mocks.storage.createWriteStream.mockImplementation(() => {
        throw new Error('error');
      });
      await expect(sut.handleBackupDatabase()).rejects.toThrow('error');
    });

    it('should fail if rename fails', async () => {
      mocks.storage.rename.mockRejectedValue(new Error('error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('error');
    });

    it('should ignore unlink failing and still return failed job status', async () => {
      mocks.process.spawn.mockReturnValueOnce(mockSpawn(1, '', 'error'));
      mocks.storage.unlinkDir.mockRejectedValue(new Error('error'));
      await expect(sut.handleBackupDatabase()).rejects.toThrow('Globals backup failed with code 1');
      expect(mocks.storage.unlinkDir).toHaveBeenCalled();
    });

    it.each`
      postgresVersion                       | expectedVersion
      ${'14.10'}                            | ${14}
      ${'14.10.3'}                          | ${14}
      ${'14.10 (Debian 14.10-1.pgdg120+1)'} | ${14}
      ${'15.3.3'}                           | ${15}
      ${'16.4.2'}                           | ${16}
      ${'17.15.1'}                          | ${17}
      ${'18.0.0'}                           | ${18}
    `(
      `should use pg_dumpall $expectedVersion with postgres version $postgresVersion`,
      async ({ postgresVersion, expectedVersion }) => {
        mocks.database.getPostgresVersion.mockResolvedValue(postgresVersion);
        await sut.handleBackupDatabase();
        expect(mocks.process.spawn).toHaveBeenCalledWith(
          `/usr/lib/postgresql/${expectedVersion}/bin/pg_dumpall`,
          expect.any(Array),
          expect.any(Object),
        );
      },
    );
    it.each`
      postgresVersion
      ${'13.99.99'}
      ${'19.0.0'}
    `(`should fail if postgres version $postgresVersion is not supported`, async ({ postgresVersion }) => {
      mocks.database.getPostgresVersion.mockResolvedValue(postgresVersion);
      const result = await sut.handleBackupDatabase();
      expect(mocks.process.spawn).not.toHaveBeenCalled();
      expect(result).toBe(JobStatus.Failed);
    });
  });
});
