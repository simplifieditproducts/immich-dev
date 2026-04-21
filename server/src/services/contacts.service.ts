import { Injectable, NotFoundException } from '@nestjs/common';
import { join } from 'node:path';
import { StorageFolder } from 'src/enum';
import { StorageCore } from 'src/cores/storage.core';
import { AuthDto } from 'src/dtos/auth.dto';
import { ContactDto, ContactsResponseDto } from 'src/dtos/contacts.dto';
import { ImmichReadStream } from 'src/repositories/storage.repository';
import { BaseService } from 'src/services/base.service';

const CONTACTS_FILENAME = 'contacts.dat';
const isLetter = (s: string) => /^[a-z]/i.test(s);

// Well-known vCard TYPE tokens that are metadata rather than user-facing labels.
// VOICE/INTERNET/etc. are redundant (every phone takes voice calls; every email
// is internet email); DOM/INTL/POSTAL/PARCEL are address-format hints.
const TYPE_DENYLIST = new Set([
  'PREF',
  'VOICE',
  'INTERNET',
  'TEXT',
  'TEXTPHONE',
  'MSG',
  'DOM',
  'INTL',
  'POSTAL',
  'PARCEL',
]);

function formatType(raw: string): string {
  const seen = new Set<string>();
  for (const token of raw.split(',')) {
    const upper = token.trim().toUpperCase();
    if (upper && !TYPE_DENYLIST.has(upper)) {
      seen.add(upper);
    }
  }
  return [...seen].join(', ');
}

// Strip all formatting (spaces, dashes, parens, dots) from a phone number,
// preserving only a leading `+` so international prefixes don't collide with
// domestic numbers.
function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const prefix = trimmed.startsWith('+') ? '+' : '';
  return prefix + trimmed.replaceAll(/\D/g, '');
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeAddress(address: {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}): string {
  return [address.street, address.city, address.state, address.zip, address.country]
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .join(', ');
}

@Injectable()
export class ContactsService extends BaseService {
  private getContactsPath(userId: string): string {
    return join(StorageCore.getFolderLocation(StorageFolder.Upload, userId), CONTACTS_FILENAME);
  }

  async upload(auth: AuthDto, data: Buffer): Promise<void> {
    const filePath = this.getContactsPath(auth.user.id);
    const dirPath = StorageCore.getFolderLocation(StorageFolder.Upload, auth.user.id);
    this.storageRepository.mkdirSync(dirPath);
    await this.storageRepository.createOrOverwriteFile(filePath, data);
    void StorageCore.appendToRcloneSyncList([filePath]);
  }

  async get(auth: AuthDto, raw: boolean): Promise<ContactsResponseDto | ImmichReadStream> {
    const filePath = this.getContactsPath(auth.user.id);

    const exists = await this.storageRepository.checkFileExists(filePath);
    if (!exists) {
      throw new NotFoundException('No contacts backup found');
    }

    if (raw) {
      return this.storageRepository.createReadStream(filePath, 'text/vcard');
    }

    const vcfData = await this.storageRepository.readTextFile(filePath);
    const contacts = await this.parseVcf(vcfData);
    const stats = await this.storageRepository.stat(filePath);

    return {
      contacts,
      total: contacts.length,
      lastModified: stats.mtime.toISOString(),
    };
  }

  async remove(auth: AuthDto): Promise<void> {
    const filePath = this.getContactsPath(auth.user.id);

    const exists = await this.storageRepository.checkFileExists(filePath);
    if (!exists) {
      throw new NotFoundException('No contacts backup found');
    }

    await this.storageRepository.unlink(filePath);
    void StorageCore.appendToRcloneSyncList([filePath]);
  }

  private async parseVcf(data: string): Promise<ContactDto[]> {
    const { default: ICAL } = await import('ical.js');
    const rawCards = data.split(/(?=BEGIN:VCARD)/i).filter((s) => s.trim());
    const byId = new Map<string, ContactDto>();

    for (const raw of rawCards) {
      try {
        const parsed = ICAL.parse(raw);
        const card = new ICAL.Component(parsed);

        const displayName = String(card.getFirstPropertyValue('fn') || '');
        const nValue = card.getFirstPropertyValue('n');

        if (!displayName && !nValue) {
          continue;
        }

        let firstName = '';
        let lastName = '';
        if (nValue) {
          const nameParts = Array.isArray(nValue) ? nValue : String(nValue).split(';');
          lastName = String(nameParts[0] || '');
          firstName = String(nameParts[1] || '');
        }

        const phones = this.dedupePhones(this.extractMultiProperty(card, 'tel'));
        const emails = this.dedupeEmails(this.extractMultiProperty(card, 'email'));
        const addresses = this.dedupeAddresses(this.extractAddresses(card));
        const avatar = this.extractPhoto(card);

        const orgValue = card.getFirstPropertyValue('org');
        const organization = orgValue ? String(Array.isArray(orgValue) ? orgValue[0] : orgValue) : null;
        const title = card.getFirstPropertyValue('title') ? String(card.getFirstPropertyValue('title')) : null;
        const birthday = card.getFirstPropertyValue('bday') ? String(card.getFirstPropertyValue('bday')) : null;
        const notes = card.getFirstPropertyValue('note') ? String(card.getFirstPropertyValue('note')) : null;

        const fields: Omit<ContactDto, 'id'> = {
          displayName: displayName || `${firstName} ${lastName}`.trim(),
          firstName,
          lastName,
          phones,
          emails,
          addresses,
          organization,
          title,
          birthday,
          notes,
          avatar,
        };

        const id = this.hashContact(fields);
        if (!byId.has(id)) {
          byId.set(id, { id, ...fields });
        }
      } catch (error) {
        this.logger.warn(`Skipping malformed vCard entry: ${error}`);
      }
    }

    const contacts = [...byId.values()];
    contacts.sort((a, b) => {
      const aIsLetter = isLetter(a.displayName);
      const bIsLetter = isLetter(b.displayName);
      if (aIsLetter !== bIsLetter) {
        return aIsLetter ? -1 : 1;
      }
      return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
    });

    return contacts;
  }

  private dedupePhones(phones: { type: string; value: string }[]): { type: string; value: string }[] {
    const seen = new Set<string>();
    const result: { type: string; value: string }[] = [];
    for (const phone of phones) {
      const key = normalizePhone(phone.value);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(phone);
    }
    return result;
  }

  private dedupeEmails(emails: { type: string; value: string }[]): { type: string; value: string }[] {
    const seen = new Set<string>();
    const result: { type: string; value: string }[] = [];
    for (const email of emails) {
      const key = normalizeEmail(email.value);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(email);
    }
    return result;
  }

  private dedupeAddresses<T extends { street: string; city: string; state: string; zip: string; country: string }>(
    addresses: T[],
  ): T[] {
    const seen = new Set<string>();
    const result: T[] = [];
    for (const address of addresses) {
      const key = normalizeAddress(address);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(address);
    }
    return result;
  }

  private hashContact(contact: Omit<ContactDto, 'id'>): string {
    const canonical = JSON.stringify({
      displayName: contact.displayName,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phones: contact.phones.map((p) => normalizePhone(p.value)),
      emails: contact.emails.map((e) => normalizeEmail(e.value)),
      addresses: contact.addresses.map((a) => normalizeAddress(a)),
      organization: contact.organization,
      title: contact.title,
      birthday: contact.birthday,
      notes: contact.notes,
      avatar: contact.avatar,
    });
    return this.cryptoRepository.hashXxHash64(canonical).toString('hex');
  }

  private extractPhoto(card: any): string | null {
    const photoProp = card.getFirstProperty('photo');
    if (!photoProp) {
      return null;
    }

    const value = String(photoProp.getFirstValue() || '');
    if (!value) {
      return null;
    }

    // Already a data URI
    if (value.startsWith('data:')) {
      return value;
    }

    // Raw base64 data — determine the media type from the TYPE parameter
    const type = String(photoProp.getParameter('type') || photoProp.getParameter('mediatype') || 'jpeg').toLowerCase();
    const mediaType = type.includes('/') ? type : `image/${type}`;
    return `data:${mediaType};base64,${value}`;
  }

  private extractAddresses(card: any): { type: string; street: string; city: string; state: string; zip: string; country: string }[] {
    const props = card.getAllProperties('adr');
    return props.map((prop: any) => {
      const value = prop.getFirstValue();
      const parts = Array.isArray(value) ? value : String(value).split(';');
      return {
        type: formatType(String(prop.getParameter('type') || '')),
        street: String(parts[2] || ''),
        city: String(parts[3] || ''),
        state: String(parts[4] || ''),
        zip: String(parts[5] || ''),
        country: String(parts[6] || ''),
      };
    });
  }

  private extractMultiProperty(card: any, field: string): { type: string; value: string }[] {
    const props = card.getAllProperties(field);
    return props.map((prop: any) => ({
      type: formatType(String(prop.getParameter('type') || '')),
      value: String(prop.getFirstValue() || ''),
    }));
  }
}
