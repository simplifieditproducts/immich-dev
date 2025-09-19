import { Command, CommandRunner, InquirerService, Question, QuestionSet } from 'nest-commander';
import { CliService } from 'src/services/cli.service';

@Command({
  name: 'recalculate-checksums',
  description: 'Recalculate the checksums for all existing assets',
})
export class RecalculateChecksumsCommand extends CommandRunner {
  constructor(
    private service: CliService,
    private inquirer: InquirerService,
  ) {
    super();
  }

  async run(): Promise<void> {
    try {
      // Get confirmation from user
      const { value: confirmed } = await this.inquirer.ask<{ value: boolean }>('prompt-recalculate-checksums', {});

      if (!confirmed) {
        console.log('Operation cancelled by user.');
        return;
      }

      // Call the service method to perform the recalculation
      await this.service.recalculateAssetChecksums();
    } catch (error) {
      console.error('\nError during checksum recalculation:', error);
    }
  }
}

@QuestionSet({ name: 'prompt-recalculate-checksums' })
export class PromptRecalculateChecksumsQuestion {
  @Question({
    message: 'This will recalculate checksums for ALL assets in the database. This may take a long time. Continue? [y/N]',
    name: 'value',
  })
  value(value: string): boolean {
    return ['yes', 'y'].includes((value || 'n').toLowerCase());
  }
}
