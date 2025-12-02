import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import path from 'node:path';
import semver from 'semver';
import { serverVersion } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { OnEvent, OnJob } from 'src/decorators';
import { DatabaseLock, ImmichWorker, JobName, JobStatus, QueueName, StorageFolder } from 'src/enum';
import { ArgOf } from 'src/repositories/event.repository';
import { BaseService } from 'src/services/base.service';
import { handlePromiseError } from 'src/utils/misc';

@Injectable()
export class BackupService extends BaseService {
  private backupLock = false;

  @OnEvent({ name: 'ConfigInit', workers: [ImmichWorker.Microservices] })
  async onConfigInit({
    newConfig: {
      backup: { database },
    },
  }: ArgOf<'ConfigInit'>) {
    this.backupLock = await this.databaseRepository.tryLock(DatabaseLock.BackupDatabase);

    if (this.backupLock) {
      this.cronRepository.create({
        name: 'backupDatabase',
        expression: database.cronExpression,
        onTick: () => handlePromiseError(this.jobRepository.queue({ name: JobName.DatabaseBackup }), this.logger),
        start: database.enabled,
      });
    }
  }

  @OnEvent({ name: 'ConfigUpdate', server: true })
  onConfigUpdate({ newConfig: { backup } }: ArgOf<'ConfigUpdate'>) {
    if (!this.backupLock) {
      return;
    }

    this.cronRepository.update({
      name: 'backupDatabase',
      expression: backup.database.cronExpression,
      start: backup.database.enabled,
    });
  }

  async cleanupDatabaseBackups() {
    this.logger.log(`Database Backup Cleanup Started`);
    const {
      backup: { database: config },
    } = await this.getConfig({ withCache: false });

    const backupsFolder = StorageCore.getBaseFolder(StorageFolder.Backups);
    const files = await this.storageRepository.readdir(backupsFolder);
    
    const deleteItem = async (name: string) => {
      const fullPath = path.join(backupsFolder, name);
      const stat = await this.storageRepository.stat(fullPath);
      if (stat.isDirectory()) {
        await this.storageRepository.unlinkDir(fullPath, { recursive: true, force: true });
      } else {
        await this.storageRepository.unlink(fullPath);
      }
    };
    
    // Delete failed backups (with .tmp suffix)
    const failedBackups = files.filter((file) => file.match(/immich-db-backup-.+\.tmp$/));
    for (const name of failedBackups) {
      await deleteItem(name);
    }
    
    // Find completed backup folders
    const backups = files
      .filter((file) => file.match(/^immich-db-backup-\d{8}T\d{6}-v[\d.]+-pg[\d.]+$/))
      .sort()
      .reverse();
    const toDelete = backups.slice(config.keepLastAmount);
    for (const name of toDelete) {
      await deleteItem(name);
    }

    this.logger.log(`Database Backup Cleanup Finished, deleted ${failedBackups.length} failed and ${toDelete.length} old backups`);
  }

  @OnJob({ name: JobName.DatabaseBackup, queue: QueueName.BackupDatabase })
  async handleBackupDatabase(): Promise<JobStatus> {
    // When CONNECTION_DESTROYED happens, this script didn't get a chance to cleanup temporary files.
    // So we run cleanup at the start of the next backup.
    await this.cleanupDatabaseBackups();

    this.logger.debug(`Database Backup Started`);
    const { database } = this.configRepository.getEnv();
    const config = database.config;

    const isUrlConnection = config.connectionType === 'url';

    const databaseParams = isUrlConnection
      ? ['--dbname', config.url]
      : [
          '--username',
          config.username,
          '--host',
          config.host,
          '--port',
          `${config.port}`,
        ];

    const databaseVersion = await this.databaseRepository.getPostgresVersion();
    const backupFolderName = `immich-db-backup-${DateTime.now().toFormat("yyyyLLdd'T'HHmmss")}-v${serverVersion.toString()}-pg${databaseVersion.split(' ')[0]}.tmp`;
    const backupFolderPath = path.join(StorageCore.getBaseFolder(StorageFolder.Backups), backupFolderName);
    const databaseSemver = semver.coerce(databaseVersion);
    const databaseMajorVersion = databaseSemver?.major;

    if (!databaseMajorVersion || !databaseSemver || !semver.satisfies(databaseSemver, '>=14.0.0 <18.0.0')) {
      this.logger.error(`Database Backup Failure: Unsupported PostgreSQL version: ${databaseVersion}`);
      return JobStatus.Failed;
    }

    this.logger.log(`Database Backup Starting. Database Version: ${databaseMajorVersion}`);

    try {
      // Create backup folder
      this.storageRepository.mkdirSync(backupFolderPath);

      // Step 1: Backup global objects (roles, tablespaces, etc.) as globals.sql
      this.logger.log('Backing up database globals...');
      const globalsFilePath = path.join(backupFolderPath, 'globals.sql');
      const globalsParams = [...databaseParams, '--globals-only'];

      await new Promise<void>((resolve, reject) => {
        const pgdumpall = this.processRepository.spawn(
          `/usr/lib/postgresql/${databaseMajorVersion}/bin/pg_dumpall`,
          globalsParams,
          {
            env: {
              PATH: process.env.PATH,
              PGPASSWORD: isUrlConnection ? undefined : config.password,
            },
          },
        );

        const fileStream = this.storageRepository.createWriteStream(globalsFilePath);
        pgdumpall.stdout.pipe(fileStream);

        let pgdumpallLogs = '';
        pgdumpall.stderr.on('data', (data) => (pgdumpallLogs += data));

        pgdumpall.on('error', (err) => {
          this.logger.error('Globals backup failed with error', err);
          reject(err);
        });

        pgdumpall.on('exit', (code) => {
          if (code !== 0) {
            this.logger.error(`Globals backup failed with code ${code}`);
            reject(`Globals backup failed with code ${code}`);
            this.logger.error(pgdumpallLogs);
            return;
          }
          if (pgdumpallLogs) {
            this.logger.debug(`pg_dumpall globals logs\n${pgdumpallLogs}`);
          }
          resolve();
        });
      });
      this.logger.log('Database globals backup completed');

      // Step 2: Backup immich database with parallel jobs using directory format
      this.logger.log('Backing up immich database with parallel jobs (-j 16)...');
      const databaseDumpFolderPath = path.join(backupFolderPath, 'data');
      const databaseDumpParams = [
        ...databaseParams,
        '--clean',
        '--if-exists',
        '-Fd',
        '-j',
        '16',
        '-f',
        databaseDumpFolderPath,
        process.env.DB_DATABASE_NAME || 'immich',
      ];

      await new Promise<void>((resolve, reject) => {
        const pgdump = this.processRepository.spawn(
          `/usr/lib/postgresql/${databaseMajorVersion}/bin/pg_dump`,
          databaseDumpParams,
          {
            env: {
              PATH: process.env.PATH,
              PGPASSWORD: isUrlConnection ? undefined : config.password,
            },
          },
        );

        let pgdumpLogs = '';
        pgdump.stderr.on('data', (data) => (pgdumpLogs += data));

        pgdump.on('error', (err) => {
          this.logger.error('Database backup failed with error', err);
          reject(err);
        });

        pgdump.on('exit', (code) => {
          if (code !== 0) {
            this.logger.error(`Database backup failed with code ${code}`);
            reject(`Database backup failed with code ${code}`);
            this.logger.error(pgdumpLogs);
            return;
          }
          if (pgdumpLogs) {
            this.logger.debug(`pg_dump logs\n${pgdumpLogs}`);
          }
          resolve();
        });
      });
      this.logger.log('Immich database backup completed');

      // Rename folder to remove .tmp suffix
      const finalBackupFolderPath = backupFolderPath.replace('.tmp', '');
      await this.storageRepository.rename(backupFolderPath, finalBackupFolderPath);
    } catch (error) {
      this.logger.error('Database Backup Failure', error);
      await this.storageRepository
        .unlinkDir(backupFolderPath, { recursive: true, force: true })
        .catch((error) => this.logger.error('Failed to delete failed backup folder', error));
      throw error;
    }

    this.logger.log(`Database Backup Success`);
    await this.cleanupDatabaseBackups();
    return JobStatus.Success;
  }
}
