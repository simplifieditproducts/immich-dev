import { writable } from 'svelte/store';

const revision = writable(0);

export const contactsRevision = { subscribe: revision.subscribe };

export function refreshContacts() {
  revision.update((n) => n + 1);
}
