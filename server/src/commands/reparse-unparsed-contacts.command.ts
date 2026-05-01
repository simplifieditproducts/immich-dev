import { Command, CommandRunner, InquirerService, Option, Question, QuestionSet } from 'nest-commander';
import { stdout } from 'node:process';
import { ContactService } from 'src/services/contact.service';

interface ReparseOptions {
  deleteUnparsed?: boolean;
  yes?: boolean;
}

@Command({
  name: 'reparse-unparsed-contacts',
  description:
    'Re-run the vCard parser on every contact currently in the "unparsed" state. Successfully parsed entries are promoted to "active". Optionally delete any entries that still cannot be parsed.',
})
export class ReparseUnparsedContactsCommand extends CommandRunner {
  constructor(
    private contactService: ContactService,
    private inquirer: InquirerService,
  ) {
    super();
  }

  @Option({
    flags: '--delete-unparsed',
    description: 'After re-parsing, delete any contacts that are still unparsed.',
  })
  parseDeleteUnparsed(): boolean {
    return true;
  }

  @Option({
    flags: '-y, --yes',
    description: 'Skip the interactive confirmation prompt.',
  })
  parseYes(): boolean {
    return true;
  }

  async run(_passed: string[], opts: ReparseOptions = {}): Promise<void> {
    const deleteUnparsed = !!opts.deleteUnparsed;

    if (deleteUnparsed && !opts.yes) {
      const { value: confirmed } = await this.inquirer.ask<{ value: boolean }>(
        'prompt-reparse-unparsed-contacts-delete',
        {},
      );
      if (!confirmed) {
        stdout.write('Operation cancelled by user.\n');
        return;
      }
    }

    const { total, promoted, stillUnparsed } = await this.contactService.reparseUnparsed();

    stdout.write('\n=== Re-parse summary ===\n');
    stdout.write(`Unparsed contacts scanned: ${total}\n`);
    stdout.write(`Promoted to active:        ${promoted}\n`);
    stdout.write(`Still unparsed:            ${stillUnparsed}\n`);

    if (deleteUnparsed && stillUnparsed > 0) {
      const deleted = await this.contactService.deleteAllUnparsed();
      stdout.write(`Deleted unparsed entries:  ${deleted}\n`);
    }
  }
}

@QuestionSet({ name: 'prompt-reparse-unparsed-contacts-delete' })
export class PromptReparseUnparsedContactsDeleteQuestion {
  @Question({
    message:
      'After re-parsing, any contacts still in the unparsed state will be DELETED. This cannot be undone. Continue? [y/N]',
    name: 'value',
  })
  value(value: string): boolean {
    return ['yes', 'y'].includes((value || 'n').toLowerCase());
  }
}
