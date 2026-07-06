import { SUBSCRIBER_MIN_QUOTA_BYTES } from 'src/constants';

// A null quota means unlimited storage (typically an admin) and is treated as a subscriber for feature gating
export const isSubscriber = ({ quotaSizeInBytes }: { quotaSizeInBytes: number | null }) =>
  quotaSizeInBytes === null || quotaSizeInBytes >= SUBSCRIBER_MIN_QUOTA_BYTES;
