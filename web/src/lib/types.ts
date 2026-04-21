import type { QueueResponseDto, ServerVersionResponseDto } from '@immich/sdk';
import type { ActionItem } from '@immich/ui';

export interface ReleaseEvent {
  isAvailable: boolean;
  /** ISO8601 */
  checkedAt: string;
  serverVersion: ServerVersionResponseDto;
  releaseVersion: ServerVersionResponseDto;
}

export type QueueSnapshot = { timestamp: number; snapshot?: QueueResponseDto[] };

export type HeaderButtonActionItem = ActionItem & { data?: { title?: string } };

export interface ContactPhone {
  type: string;
  value: string;
}

export interface ContactEmail {
  type: string;
  value: string;
}

export interface ContactAddress {
  type: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface Contact {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  phones: ContactPhone[];
  emails: ContactEmail[];
  addresses: ContactAddress[];
  organization: string | null;
  title: string | null;
  birthday: string | null;
  notes: string | null;
  avatar: string | null;
}

export interface ContactsData {
  contacts: Contact[];
  total: number;
  lastModified: string;
}
