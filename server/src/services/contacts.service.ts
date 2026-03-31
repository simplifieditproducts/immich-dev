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
    const contacts: ContactDto[] = [];

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

        const phones = this.extractMultiProperty(card, 'tel');
        const emails = this.extractMultiProperty(card, 'email');
        const addresses = this.extractAddresses(card);
        const avatar = this.extractPhoto(card);

        const orgValue = card.getFirstPropertyValue('org');
        const organization = orgValue ? String(Array.isArray(orgValue) ? orgValue[0] : orgValue) : null;
        const title = card.getFirstPropertyValue('title') ? String(card.getFirstPropertyValue('title')) : null;
        const birthday = card.getFirstPropertyValue('bday') ? String(card.getFirstPropertyValue('bday')) : null;
        const notes = card.getFirstPropertyValue('note') ? String(card.getFirstPropertyValue('note')) : null;

        contacts.push({
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
        });
      } catch (error) {
        this.logger.warn(`Skipping malformed vCard entry: ${error}`);
      }
    }

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
        type: String(prop.getParameter('type') || ''),
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
      type: String(prop.getParameter('type') || ''),
      value: String(prop.getFirstValue() || ''),
    }));
  }
}
