import { locale } from '$lib/stores/preferences.store';
import { sendMessageToApp } from '$lib/utils';
import { get } from 'svelte/store';

export interface ContactRef {
  id: string;
  displayName: string;
}

// Browser uploads use a deviceId derived from the VCF filename so that
// re-dropping the same file replaces that bucket (sync semantics) while
// different files coexist as separate "devices" in the device list. The
// `web:` prefix lets the UI distinguish browser buckets from mobile ones.
export function getWebDeviceIdForFile(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const normalized = base.trim().toLowerCase().slice(0, 200);
  return `web:${normalized || 'upload.vcf'}`;
}

export function shareContactsViaApp(contacts: ContactRef[]) {
  sendMessageToApp('CMD_SHARE_CONTACTS ' + JSON.stringify({ contacts }));
}

export function downloadContactsViaApp(contacts: ContactRef[]) {
  sendMessageToApp('CMD_DOWNLOAD_CONTACTS ' + JSON.stringify({ contacts }));
}

// Native app fetches the full backup via GET /api/contacts/vcf instead of the
// selection-based POST /api/contacts/export.
export function downloadAllContactsViaApp() {
  sendMessageToApp('CMD_DOWNLOAD_CONTACTS ' + JSON.stringify({ all: true }));
}

export function getInitials(name: string): string {
  const cleaned = name.replaceAll(/\p{Emoji_Presentation}/gu, '').trim();
  const parts = cleaned.split(' ').filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return parts
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// vCard BDAY can be reduced-precision (`--MM-DD` / `--MMDD`, year unknown),
// ISO extended (`YYYY-MM-DD`), basic ISO 8601 (`YYYYMMDD`), or full ISO with
// time. Returns null when the input doesn't match any known shape; callers
// should fall back to rendering the raw string in that case.
function parseVcardBday(value: string): { year: number | null; month: number; day: number } | null {
  const trimmed = value.trim();

  const noYear = /^--(\d{2})-?(\d{2})$/.exec(trimmed);
  if (noYear) {
    return { year: null, month: Number(noYear[1]), day: Number(noYear[2]) };
  }

  const extended = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (extended) {
    return { year: Number(extended[1]), month: Number(extended[2]), day: Number(extended[3]) };
  }

  const basic = /^(\d{4})(\d{2})(\d{2})/.exec(trimmed);
  if (basic) {
    return { year: Number(basic[1]), month: Number(basic[2]), day: Number(basic[3]) };
  }

  return null;
}

export function formatBirthday(value: string): string {
  const parsed = parseVcardBday(value);
  if (!parsed) {
    return value;
  }

  // Pick a known non-leap year as a placeholder when the year is unknown so
  // Date construction stays valid; the year is suppressed from the output.
  const year = parsed.year ?? 2001;
  const date = new Date(Date.UTC(year, parsed.month - 1, parsed.day));
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(get(locale), {
    timeZone: 'UTC',
    year: parsed.year === null ? undefined : 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
