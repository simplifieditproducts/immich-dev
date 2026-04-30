import { Command, CommandRunner, InquirerService, Option, Question, QuestionSet } from 'nest-commander';
import { join } from 'node:path';
import { stdout } from 'node:process';
import { StorageCore } from 'src/cores/storage.core';
import { AuthDto } from 'src/dtos/auth.dto';
import { StorageFolder } from 'src/enum';
import { ConfigRepository } from 'src/repositories/config.repository';
import { ContactRepository } from 'src/repositories/contact.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { CliService } from 'src/services/cli.service';
import { ContactsService } from 'src/services/contacts.service';

const LEGACY_CONTACTS_FILENAME = 'contacts.dat';
const LEGACY_DEVICE_ID = 'legacy';

interface MigrateOptions {
  dryRun?: boolean;
  yes?: boolean;
}

@Command({
  name: 'migrate-legacy-contacts',
  description:
    'One-time migration: import each user\'s legacy upload/<userId>/contacts.dat into the contacts database as a "legacy" device, then delete the file from disk.',
})
export class MigrateLegacyContactsCommand extends CommandRunner {
  constructor(
    private cliService: CliService,
    private contactsService: ContactsService,
    private contactRepository: ContactRepository,
    private storageRepository: StorageRepository,
    private configRepository: ConfigRepository,
    private inquirer: InquirerService,
  ) {
    super();
  }

  @Option({
    flags: '--dry-run',
    description: 'Scan and report only — do not import into the database or delete any files.',
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({
    flags: '-y, --yes',
    description: 'Skip the interactive confirmation prompt.',
  })
  parseYes(): boolean {
    return true;
  }

  private detectMediaLocation(): string {
    const envData = this.configRepository.getEnv();
    if (envData.storage.mediaLocation) {
      return envData.storage.mediaLocation;
    }

    const targets: string[] = [];
    const candidates = ['/data', '/usr/src/app/upload'];

    for (const candidate of candidates) {
      const exists = this.storageRepository.existsSync(candidate);
      if (exists) {
        targets.push(candidate);
      }
    }

    if (targets.length === 1) {
      return targets[0];
    }

    return '/usr/src/app/upload';
  }

  async run(_passed: string[], opts: MigrateOptions = {}): Promise<void> {
    const dryRun = !!opts.dryRun;

    const mediaLocation = this.detectMediaLocation();
    stdout.write(`Using media location: ${mediaLocation}\n`);
    StorageCore.setMediaLocation(mediaLocation);

    if (dryRun) {
      stdout.write('[DRY RUN] No changes will be made.\n');
    } else if (!opts.yes) {
      const { value: confirmed } = await this.inquirer.ask<{ value: boolean }>(
        'prompt-migrate-legacy-contacts',
        {},
      );
      if (!confirmed) {
        stdout.write('Operation cancelled by user.\n');
        return;
      }
    }

    const allUsers = await this.cliService.listUsers();
    const users = allUsers.filter((user) => user.deletedAt === null);
    const skippedDeleted = allUsers.length - users.length;

    let scanned = 0;
    let found = 0;
    let imported = 0;
    let removed = 0;
    let skippedExisting = 0;
    let errored = 0;
    const failures: Array<{ userId: string; email: string; error: unknown }> = [];

    for (const user of users) {
      scanned++;
      const filePath = join(
        StorageCore.getFolderLocation(StorageFolder.Upload, user.id),
        LEGACY_CONTACTS_FILENAME,
      );

      const exists = await this.storageRepository.checkFileExists(filePath);
      if (!exists) {
        continue;
      }

      found++;
      stdout.write(`[${user.id}] (${user.email}) found ${filePath}\n`);

      if (dryRun) {
        continue;
      }

      try {
        const devices = await this.contactRepository.listDevices(user.id);
        const hasLegacyDevice = devices.some((d) => d.deviceId === LEGACY_DEVICE_ID);

        if (hasLegacyDevice) {
          stdout.write(
            `[${user.id}] already has a "${LEGACY_DEVICE_ID}" device in DB — skipping import, deleting file\n`,
          );
          await this.storageRepository.unlink(filePath);
          await StorageCore.appendToRcloneSyncList([filePath]);
          removed++;
          skippedExisting++;
          continue;
        }

        const { size } = await this.storageRepository.stat(filePath);
        if (size === 0) {
          stdout.write(`[${user.id}] file is empty — deleting without import\n`);
          await this.storageRepository.unlink(filePath);
          await StorageCore.appendToRcloneSyncList([filePath]);
          removed++;
          continue;
        }

        const data = await this.storageRepository.readFile(filePath, {
          buffer: Buffer.alloc(size),
          position: 0,
          length: size,
        });

        const auth = { user: { id: user.id } } as AuthDto;
        await this.contactsService.upload(auth, LEGACY_DEVICE_ID, data);
        imported++;
        stdout.write(`[${user.id}] imported into DB as device "${LEGACY_DEVICE_ID}"\n`);

        await this.storageRepository.unlink(filePath);
        await StorageCore.appendToRcloneSyncList([filePath]);
        removed++;
        stdout.write(`[${user.id}] deleted ${filePath}\n`);
      } catch (error) {
        errored++;
        failures.push({ userId: user.id, email: user.email, error });
        stdout.write(`[${user.id}] FAILED — file left in place: ${error}\n`);
      }
    }

    stdout.write('\n=== Summary ===\n');
    stdout.write(`Users scanned:                  ${scanned}\n`);
    stdout.write(`Soft-deleted users skipped:     ${skippedDeleted}\n`);
    stdout.write(`contacts.dat found:             ${found}\n`);
    stdout.write(`Imported into DB:               ${imported}\n`);
    stdout.write(`Skipped (legacy device exists): ${skippedExisting}\n`);
    stdout.write(`Files deleted:                  ${removed}\n`);
    stdout.write(`Errored:                        ${errored}\n`);

    if (failures.length > 0) {
      stdout.write('\nFailures:\n');
      for (const failure of failures) {
        stdout.write(`  - ${failure.userId} (${failure.email}): ${failure.error}\n`);
      }
    }
  }
}

@QuestionSet({ name: 'prompt-migrate-legacy-contacts' })
export class PromptMigrateLegacyContactsQuestion {
  @Question({
    message:
      'This will import each user\'s legacy contacts.dat into the database (as device "legacy") and DELETE the original file from disk. Continue? [y/N]',
    name: 'value',
  })
  value(value: string): boolean {
    return ['yes', 'y'].includes((value || 'n').toLowerCase());
  }
}
