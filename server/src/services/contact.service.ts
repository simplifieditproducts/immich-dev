import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  ContactBulkRequestDto,
  ContactDeviceDto,
  ContactDevicesResponseDto,
  ContactDto,
  ContactListItemDto,
  ContactsResponseDto,
} from 'src/dtos/contact.dto';
import { ContactStatus } from 'src/enum';
import { ImmichReadStream } from 'src/repositories/storage.repository';
import { BaseService } from 'src/services/base.service';

type ParsedContact = Omit<ContactDto, 'id'>;

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

// Some clients export NOTE as physical lines instead of a single escaped value.
// Text like "Email:" then looks like a vCard property to ical.js. Remove the
// NOTE block before parsing the rest of the card and read the note here.
const VCARD_NOTE_PROPERTY_REGEX = /^NOTE(?:;[^:]*)?:/i;
const VCARD_END_REGEX = /^END:VCARD$/i;
const VCARD_X_EXTENSION_REGEX = /^X-[A-Za-z0-9-]+(?:;[^:]*)?:/i;

function decodeVcardText(value: string): string {
  let text = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '\\' || i === value.length - 1) {
      text += value[i];
      continue;
    }

    const next = value[++i];
    text += next.toLowerCase() === 'n' ? '\n' : next;
  }

  return text;
}

function parseNoteBlock(lines: string[]): string | null {
  const noteLines = [lines[0].slice(lines[0].indexOf(':') + 1)];
  let skippingXProperty = false;

  for (const line of lines.slice(1)) {
    const isContinuationLine = line.startsWith(' ') || line.startsWith('\t');

    if (skippingXProperty && isContinuationLine) {
      continue;
    }

    skippingXProperty = false;
    if (VCARD_X_EXTENSION_REGEX.test(line)) {
      skippingXProperty = true;
      continue;
    }

    if (isContinuationLine) {
      noteLines[noteLines.length - 1] += line.slice(1);
      continue;
    }

    noteLines.push(line);
  }

  // If NOTE: is followed by note text on the next physical line, do not keep an
  // artificial blank line before that text.
  if (noteLines.length > 1 && noteLines[0] === '') {
    noteLines.shift();
  }

  const note = decodeVcardText(noteLines.join('\n'));
  return note ?? null;
}

function repairVcard(raw: string): { vcard: string; note: string | null } {
  const lines = raw.split(/\r?\n/);
  const noteStart = lines.findIndex((line) => VCARD_NOTE_PROPERTY_REGEX.test(line));
  if (noteStart === -1) {
    return { vcard: raw, note: null };
  }

  const noteEnd = lines.findIndex((line, index) => index > noteStart && VCARD_END_REGEX.test(line));
  if (noteEnd === -1) {
    return { vcard: raw, note: null };
  }

  const noteLines = lines.slice(noteStart, noteEnd);
  const note = parseNoteBlock(noteLines);

  return {
    vcard: [...lines.slice(0, noteStart), ...lines.slice(noteEnd)].join('\r\n'),
    note,
  };
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
export class ContactService extends BaseService {
  async upload(auth: AuthDto, deviceId: string, data: Buffer): Promise<void> {
    const ownerId = auth.user.id;
    const text = data.toString('utf8');
    const blocks = text.split(/(?=BEGIN:VCARD)/i).filter((s) => s.trim());

    await this.contactRepository.transaction(async (repo) => {
      await repo.deleteSourcesByDevice(ownerId, deviceId);

      for (const block of blocks) {
        const vcardHash = this.cryptoRepository.hashXxHash64(block).toString('hex');

        const existing = await repo.findByVcardHash(ownerId, vcardHash);
        let contactId: string;

        if (existing) {
          contactId = existing.id;
        } else {
          const { parsed, error: parseError } = await this.tryParse(block);
          if (parsed) {
            const contentHash = this.hashContent(parsed);
            const inserted = await repo.insertIfNew({
              ownerId,
              vcardHash,
              contentHash,
              status: ContactStatus.Active,
              displayName: parsed.displayName,
              firstName: parsed.firstName,
              lastName: parsed.lastName,
              organization: parsed.organization,
              title: parsed.title,
              birthday: parsed.birthday,
              notes: parsed.notes,
              avatar: parsed.avatar,
              phones: parsed.phones,
              emails: parsed.emails,
              addresses: parsed.addresses,
              vcardBlock: block,
            });
            contactId = inserted?.id ?? (await repo.findByVcardHash(ownerId, vcardHash))!.id;
          } else {
            const inserted = await repo.insertIfNew({
              ownerId,
              vcardHash,
              status: ContactStatus.Unparsed,
              vcardBlock: block,
            });
            contactId = inserted?.id ?? (await repo.findByVcardHash(ownerId, vcardHash))!.id;
            if (parseError) {
              const message = parseError instanceof Error ? parseError.message : String(parseError);
              this.logger.warn(`Failed to parse vCard for contact ${contactId}: ${message}`);
            }
          }
        }

        await repo.upsertSource(contactId, deviceId);
      }

      await repo.deleteOrphanContacts(ownerId);
    });
  }

  async list(auth: AuthDto): Promise<ContactsResponseDto> {
    const contacts = await this.contactRepository.listAll(auth.user.id);
    return { contacts: contacts.map((c) => this.mapListItem(c)) };
  }

  async getOne(auth: AuthDto, id: string): Promise<ContactDto> {
    const contact = await this.contactRepository.getById(auth.user.id, id);
    if (!contact) {
      throw new NotFoundException('Contact not found');
    }
    return this.mapContact(contact);
  }

  async listDevices(auth: AuthDto): Promise<ContactDevicesResponseDto> {
    const devices = await this.contactRepository.listDevices(auth.user.id);
    return {
      devices: devices.map(
        (d): ContactDeviceDto => ({
          deviceId: d.deviceId,
          lastUpload: d.lastUpload.toISOString(),
          contactCount: d.contactCount,
        }),
      ),
    };
  }

  async deleteDevice(auth: AuthDto, deviceId: string): Promise<void> {
    await this.contactRepository.deleteDevice(auth.user.id, deviceId);
  }

  async getDeviceVcf(auth: AuthDto, deviceId: string): Promise<ImmichReadStream> {
    const blocks = await this.contactRepository.getDeviceVcardBlocks(auth.user.id, deviceId);
    if (blocks.length === 0) {
      throw new NotFoundException('No contacts for this device');
    }
    return this.streamVcards(blocks.map((b) => b.vcardBlock));
  }

  async getOwnerVcf(auth: AuthDto): Promise<ImmichReadStream> {
    const blocks = await this.contactRepository.getOwnerVcardBlocks(auth.user.id);
    if (blocks.length === 0) {
      throw new NotFoundException('No contacts uploaded');
    }
    return this.streamVcards(blocks.map((b) => b.vcardBlock));
  }

  async export(auth: AuthDto, dto: ContactBulkRequestDto): Promise<ImmichReadStream> {
    if (dto.ids.length === 0) {
      throw new BadRequestException('No contacts selected');
    }
    const blocks = await this.contactRepository.getVcardBlocks(auth.user.id, dto.ids);
    if (blocks.length === 0) {
      throw new NotFoundException('No matching contacts found');
    }
    return this.streamVcards(blocks.map((b) => b.vcardBlock));
  }

  async deleteOne(auth: AuthDto, id: string): Promise<void> {
    await this.contactRepository.deleteByIds(auth.user.id, [id]);
  }

  async deleteMany(auth: AuthDto, dto: ContactBulkRequestDto): Promise<void> {
    await this.contactRepository.deleteByIds(auth.user.id, dto.ids);
  }

  async deleteAll(auth: AuthDto): Promise<void> {
    await this.contactRepository.deleteAll(auth.user.id);
  }

  async reparseUnparsed(): Promise<{ total: number; promoted: number; stillUnparsed: number }> {
    const rows = await this.contactRepository.listUnparsed();
    let promoted = 0;
    for (const row of rows) {
      const { parsed, error: parseError } = await this.tryParse(row.vcardBlock);
      if (!parsed) {
        if (parseError) {
          const message = parseError instanceof Error ? parseError.message : String(parseError);
          this.logger.warn(`Failed to re-parse vCard for contact ${row.id}: ${message}`);
        }
        continue;
      }
      await this.contactRepository.promoteUnparsed(row.id, {
        contentHash: this.hashContent(parsed),
        status: ContactStatus.Active,
        displayName: parsed.displayName,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        organization: parsed.organization,
        title: parsed.title,
        birthday: parsed.birthday,
        notes: parsed.notes,
        avatar: parsed.avatar,
        phones: parsed.phones,
        emails: parsed.emails,
        addresses: parsed.addresses,
      });
      promoted++;
    }
    return { total: rows.length, promoted, stillUnparsed: rows.length - promoted };
  }

  async deleteAllUnparsed(): Promise<number> {
    return await this.contactRepository.deleteAllUnparsed();
  }

  private streamVcards(blocks: string[]): ImmichReadStream {
    const body = blocks.join('\r\n');
    return {
      stream: Readable.from([body]),
      type: 'text/vcard',
      length: Buffer.byteLength(body, 'utf8'),
    };
  }

  private mapListItem(row: {
    id: string;
    displayName: string;
    organization: string | null;
    title: string | null;
    avatar: string | null;
  }): ContactListItemDto {
    return {
      id: row.id,
      displayName: row.displayName,
      organization: row.organization,
      title: row.title,
      avatar: row.avatar,
    };
  }

  private mapContact(row: {
    id: string;
    displayName: string;
    firstName: string;
    lastName: string;
    organization: string | null;
    title: string | null;
    birthday: string | null;
    notes: string | null;
    avatar: string | null;
    phones: unknown;
    emails: unknown;
    addresses: unknown;
  }): ContactDto {
    return {
      id: row.id,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      organization: row.organization,
      title: row.title,
      birthday: row.birthday,
      notes: row.notes,
      avatar: row.avatar,
      phones: (row.phones as ContactDto['phones']) ?? [],
      emails: (row.emails as ContactDto['emails']) ?? [],
      addresses: (row.addresses as ContactDto['addresses']) ?? [],
    };
  }

  private hashContent(parsed: ParsedContact): string {
    const canonical = JSON.stringify({
      displayName: parsed.displayName,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      phones: parsed.phones.map((p) => normalizePhone(p.value)),
      emails: parsed.emails.map((e) => normalizeEmail(e.value)),
      addresses: parsed.addresses.map((a) => normalizeAddress(a)),
      organization: parsed.organization,
      title: parsed.title,
      birthday: parsed.birthday,
      notes: parsed.notes,
      avatar: parsed.avatar,
    });
    return this.cryptoRepository.hashXxHash64(canonical).toString('hex');
  }

  private async tryParse(raw: string): Promise<{ parsed: ParsedContact | null; error?: unknown }> {
    try {
      const { default: ICAL } = await import('ical.js');
      const { vcard, note } = repairVcard(raw);
      const parsed = ICAL.parse(vcard);
      const card = new ICAL.Component(parsed);

      const fnValue = String(card.getFirstPropertyValue('fn') || '').trim();
      const nValue = card.getFirstPropertyValue('n');

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

      // Resolve a usable label: explicit FN, then "first last", then the first
      // phone or email so nameless entries (e.g. iPhone exports with N:;;;; and
      // only a TEL) still surface with something the user can identify and act
      // on. If none of those exist there's nothing to show — treat as malformed.
      const displayName =
        fnValue || `${firstName} ${lastName}`.trim() || phones[0]?.value || emails[0]?.value || '';
      if (!displayName) {
        return { parsed: null };
      }

      const orgValue = card.getFirstPropertyValue('org');
      const organization = orgValue ? String(Array.isArray(orgValue) ? orgValue[0] : orgValue) : null;
      const title = card.getFirstPropertyValue('title') ? String(card.getFirstPropertyValue('title')) : null;
      const birthday = card.getFirstPropertyValue('bday') ? String(card.getFirstPropertyValue('bday')) : null;
      const noteValue = card.getFirstPropertyValue('note');
      const notes = note ?? (noteValue ? String(noteValue) : null);

      return {
        parsed: {
          displayName,
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
        },
      };
    } catch (error) {
      return { parsed: null, error };
    }
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
