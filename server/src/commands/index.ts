import { GrantAdminCommand, PromptEmailQuestion, RevokeAdminCommand } from 'src/commands/grant-admin';
import { ListUsersCommand } from 'src/commands/list-users.command';
import { DisableMaintenanceModeCommand, EnableMaintenanceModeCommand } from 'src/commands/maintenance-mode';
import {
  ChangeMediaLocationCommand,
  PromptConfirmMoveQuestions,
  PromptMediaLocationQuestions,
} from 'src/commands/media-location.command';
import {
  MigrateLegacyContactsCommand,
  PromptMigrateLegacyContactsQuestion,
} from 'src/commands/migrate-legacy-contacts.command';
import { DisableOAuthLogin, EnableOAuthLogin } from 'src/commands/oauth-login';
import { DisablePasswordLoginCommand, EnablePasswordLoginCommand } from 'src/commands/password-login';
import { PromptRecalculateChecksumsQuestion, RecalculateChecksumsCommand } from 'src/commands/recalculate-checksums.command';
import {
  PromptReparseUnparsedContactsDeleteQuestion,
  ReparseUnparsedContactsCommand,
} from 'src/commands/reparse-unparsed-contacts.command';
import { PromptPasswordQuestions, ResetAdminPasswordCommand } from 'src/commands/reset-admin-password.command';
import { VersionCommand } from 'src/commands/version.command';

export const commandsAndQuestions = [
  ResetAdminPasswordCommand,
  PromptPasswordQuestions,
  PromptEmailQuestion,
  EnablePasswordLoginCommand,
  DisablePasswordLoginCommand,
  EnableMaintenanceModeCommand,
  DisableMaintenanceModeCommand,
  EnableOAuthLogin,
  DisableOAuthLogin,
  ListUsersCommand,
  VersionCommand,
  GrantAdminCommand,
  RevokeAdminCommand,
  ChangeMediaLocationCommand,
  PromptMediaLocationQuestions,
  PromptConfirmMoveQuestions,
  RecalculateChecksumsCommand,
  PromptRecalculateChecksumsQuestion,
  MigrateLegacyContactsCommand,
  PromptMigrateLegacyContactsQuestion,
  ReparseUnparsedContactsCommand,
  PromptReparseUnparsedContactsDeleteQuestion,
];
