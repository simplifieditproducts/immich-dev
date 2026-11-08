import { Duration } from 'luxon';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SemVer } from 'semver';
import { ApiTag, DatabaseExtension, ExifOrientation, VectorIndex } from 'src/enum';

export const POSTGRES_VERSION_RANGE = '>=14.0.0';
export const VECTORCHORD_VERSION_RANGE = '>=0.3 <0.6';
export const VECTORS_VERSION_RANGE = '>=0.2 <0.4';
export const VECTOR_VERSION_RANGE = '>=0.5 <1';

export const JOBS_ASSET_PAGINATION_SIZE = 1000;
export const JOBS_LIBRARY_PAGINATION_SIZE = 10_000;

// A subscriber (paying customer) is identified by a storage quota of 2TB or more.
// A null quota means unlimited storage (typically an admin) and is treated as a
// subscriber for feature gating — see isSubscriber.
export const SUBSCRIBER_MIN_QUOTA_BYTES = 2_000_000_000_000;

export const EXTENSION_NAMES: Record<DatabaseExtension, string> = {
  cube: 'cube',
  earthdistance: 'earthdistance',
  vector: 'pgvector',
  vectors: 'pgvecto.rs',
  vchord: 'VectorChord',
} as const;

export const VECTOR_EXTENSIONS = [
  DatabaseExtension.VectorChord,
  DatabaseExtension.Vectors,
  DatabaseExtension.Vector,
] as const;

// From this many rows a vector table counts as large: see
// DatabaseRepository.canResetVectors for what that turns off.
export const VECTOR_RESET_MAX_ROWS = 100_000;
// "<what> is " + this. Shown to admins in the web UI too, so it doesn't say
// how to override it; docs/vector-index-capacity.md in immich-devops does.
export const VECTOR_RESET_REFUSED =
  'turned off on this server: it would go through every photo or face of every user again, archived users ' +
  'included (hours of work on the database, with search, faces or duplicates broken or slow meanwhile). ' +
  'See docs/vector-index-capacity.md in immich-devops.';

// Facial Recognition "Missing" is " + this: refused like a reset, though it
// redoes nothing (PersonService.handleQueueRecognizeFaces).
export const FACE_MISSING_REFUSED =
  'turned off on this server: it would queue every unassigned face of every user (millions of jobs, with new ' +
  "uploads' faces waiting behind them). To recognize one user's faces, use Rerun Facial Recognition on their page " +
  'in the Picture Keeper or Ultimate Backup admin panel.';

// From this many photos and videos a server counts as large: see
// DatabaseRepository.canRerunAllAssets for what that turns off.
export const FULL_RERUN_MAX_ASSETS = 100_000;
// "<button> is " + this. Shown to admins in the web UI too, like
// VECTOR_RESET_REFUSED.
export const FULL_RERUN_REFUSED =
  'turned off on this server: it would go through every photo and video of every user again (days to weeks ' +
  'of work, with new uploads waiting behind it). See docs/vector-index-capacity.md in immich-devops.';

// Facial Recognition and Duplicate Detection of a photo whose owner's vectors
// are archived wait this long for the restore (VectorRestore at login, or
// immich-devops' cron every 5 minutes), at most this many times (an hour).
export const ARCHIVED_WAIT_MS = 60 * 1000;
export const ARCHIVED_MAX_WAITS = 60;

// GET /users/me/search-status (UserService.getSearchStatus). Search counts as
// ready while the user's photos still without a search vector, metadata or a
// thumbnail (each counted once) are at most this share of them, or this many,
// whichever is more (a photo whose job failed never gets one; a user with a
// handful of photos isn't held up by one of them).
export const SEARCH_READY_MAX_REMAINING_SHARE = 0.05;
export const SEARCH_READY_MIN_REMAINING = 10;
// The photo counts are kept this long per user (0.25 s for 74,000 photos): a
// poll every few seconds still counts at most this often, and a finished
// processing shows as ready within this long.
export const SEARCH_STATUS_CACHE_MS = 10 * 1000;
// While a user stays archived, their restore is queued again at most this
// often (the login's may have failed; one already waiting or running makes
// it a no-op).
export const SEARCH_STATUS_RESTORE_RETRY_MS = 60 * 1000;
// Users kept for those two, the least recently polled going first: an entry
// lives for seconds, so this is how many users poll at once, and one pushed
// out only costs a count or a queue call that does nothing.
export const SEARCH_STATUS_MAX_USERS = 1000;

// The advisory lock class immich-devops' vector-archive.py takes per user
// (pg_advisory_xact_lock(4180, hashtext(userId))) to archive or restore.
export const VECTOR_ARCHIVE_LOCK_CLASS = 4180;
// Registry rows archived before 2026-11-02 say 'default' for a model left at
// its default: the defaults were these then.
export const VECTOR_ARCHIVE_LEGACY_MODELS = { clip: 'ViT-B-32__openai', face: 'buffalo_l' };

export const VECTOR_INDEX_TABLES = {
  [VectorIndex.Clip]: 'smart_search',
  [VectorIndex.Face]: 'face_search',
} as const;

export const VECTORCHORD_LIST_SLACK_FACTOR = 1.2;

export const SALT_ROUNDS = 10;

export const IWorker = 'IWorker';

// eslint-disable-next-line unicorn/prefer-module
const basePath = dirname(__filename);
const packageFile = join(basePath, '..', 'package.json');
const { version } = JSON.parse(readFileSync(packageFile, 'utf8'));
export const serverVersion = new SemVer(version);

export const AUDIT_LOG_MAX_DURATION = Duration.fromObject({ days: 100 });
export const ONE_HOUR = Duration.fromObject({ hours: 1 });
export const FILTER_EXTRACTION_CACHE_TTL = Duration.fromObject({ days: 14 });
// How many text matches rank above Smart Search when the model isn't sure the user wants text:
// half of the 16 results the web search page shows before "Show More" (INITIAL_ASSET_LIMIT).
export const OCR_POSSIBLE_RANKED_LIMIT = 8;

export const citiesFile = 'cities500.txt';
export const reverseGeocodeMaxDistance = 25_000;

export const MOBILE_REDIRECT = 'app.immich:///oauth-callback';
export const LOGIN_URL = '/auth/login?autoLaunch=0';

export const excludePaths = ['/.well-known/immich', '/custom.css', '/favicon.ico'];

export const FACE_THUMBNAIL_SIZE = 250;

type ModelInfo = { dimSize: number };
export const CLIP_MODEL_INFO: Record<string, ModelInfo> = {
  RN101__openai: { dimSize: 512 },
  RN101__yfcc15m: { dimSize: 512 },
  'ViT-B-16__laion400m_e31': { dimSize: 512 },
  'ViT-B-16__laion400m_e32': { dimSize: 512 },
  'ViT-B-16__openai': { dimSize: 512 },
  'ViT-B-32__laion2b-s34b-b79k': { dimSize: 512 },
  'ViT-B-32__laion2b_e16': { dimSize: 512 },
  'ViT-B-32__laion400m_e31': { dimSize: 512 },
  'ViT-B-32__laion400m_e32': { dimSize: 512 },
  'ViT-B-32__openai': { dimSize: 512 },
  'XLM-Roberta-Base-ViT-B-32__laion5b_s13b_b90k': { dimSize: 512 },
  'XLM-Roberta-Large-Vit-B-32': { dimSize: 512 },
  RN50x4__openai: { dimSize: 640 },
  'ViT-B-16-plus-240__laion400m_e31': { dimSize: 640 },
  'ViT-B-16-plus-240__laion400m_e32': { dimSize: 640 },
  'XLM-Roberta-Large-Vit-B-16Plus': { dimSize: 640 },
  'LABSE-Vit-L-14': { dimSize: 768 },
  RN50x16__openai: { dimSize: 768 },
  'ViT-B-16-SigLIP-256__webli': { dimSize: 768 },
  'ViT-B-16-SigLIP-384__webli': { dimSize: 768 },
  'ViT-B-16-SigLIP-512__webli': { dimSize: 768 },
  'ViT-B-16-SigLIP-i18n-256__webli': { dimSize: 768 },
  'ViT-B-16-SigLIP__webli': { dimSize: 768 },
  'ViT-L-14-336__openai': { dimSize: 768 },
  'ViT-L-14-quickgelu__dfn2b': { dimSize: 768 },
  'ViT-L-14__laion2b-s32b-b82k': { dimSize: 768 },
  'ViT-L-14__laion400m_e31': { dimSize: 768 },
  'ViT-L-14__laion400m_e32': { dimSize: 768 },
  'ViT-L-14__openai': { dimSize: 768 },
  'XLM-Roberta-Large-Vit-L-14': { dimSize: 768 },
  'nllb-clip-base-siglip__mrl': { dimSize: 768 },
  'nllb-clip-base-siglip__v1': { dimSize: 768 },
  RN50__cc12m: { dimSize: 1024 },
  RN50__openai: { dimSize: 1024 },
  RN50__yfcc15m: { dimSize: 1024 },
  RN50x64__openai: { dimSize: 1024 },
  'ViT-H-14-378-quickgelu__dfn5b': { dimSize: 1024 },
  'ViT-H-14-quickgelu__dfn5b': { dimSize: 1024 },
  'ViT-H-14__laion2b-s32b-b79k': { dimSize: 1024 },
  'ViT-L-16-SigLIP-256__webli': { dimSize: 1024 },
  'ViT-L-16-SigLIP-384__webli': { dimSize: 1024 },
  'ViT-g-14__laion2b-s12b-b42k': { dimSize: 1024 },
  'XLM-Roberta-Large-ViT-H-14__frozen_laion5b_s13b_b90k': { dimSize: 1024 },
  'ViT-SO400M-14-SigLIP-384__webli': { dimSize: 1152 },
  'nllb-clip-large-siglip__mrl': { dimSize: 1152 },
  'nllb-clip-large-siglip__v1': { dimSize: 1152 },
  'ViT-B-16-SigLIP2__webli': { dimSize: 768 },
  'ViT-B-32-SigLIP2-256__webli': { dimSize: 768 },
  'ViT-L-16-SigLIP2-256__webli': { dimSize: 1024 },
  'ViT-L-16-SigLIP2-384__webli': { dimSize: 1024 },
  'ViT-L-16-SigLIP2-512__webli': { dimSize: 1024 },
  'ViT-SO400M-14-SigLIP2__webli': { dimSize: 1152 },
  'ViT-SO400M-14-SigLIP2-378__webli': { dimSize: 1152 },
  'ViT-SO400M-16-SigLIP2-256__webli': { dimSize: 1152 },
  'ViT-SO400M-16-SigLIP2-384__webli': { dimSize: 1152 },
  'ViT-SO400M-16-SigLIP2-512__webli': { dimSize: 1152 },
  'ViT-gopt-16-SigLIP2-256__webli': { dimSize: 1536 },
  'ViT-gopt-16-SigLIP2-384__webli': { dimSize: 1536 },
};

type SharpRotationData = {
  angle?: number;
  flip?: boolean;
  flop?: boolean;
};
export const ORIENTATION_TO_SHARP_ROTATION: Record<ExifOrientation, SharpRotationData> = {
  [ExifOrientation.Horizontal]: { angle: 0 },
  [ExifOrientation.MirrorHorizontal]: { angle: 0, flop: true },
  [ExifOrientation.Rotate180]: { angle: 180 },
  [ExifOrientation.MirrorVertical]: { angle: 180, flop: true },
  [ExifOrientation.MirrorHorizontalRotate270CW]: { angle: 270, flip: true },
  [ExifOrientation.Rotate90CW]: { angle: 90 },
  [ExifOrientation.MirrorHorizontalRotate90CW]: { angle: 90, flip: true },
  [ExifOrientation.Rotate270CW]: { angle: 270 },
} as const;

export const endpointTags: Record<ApiTag, string> = {
  [ApiTag.Activities]: 'An activity is a like or a comment made by a user on an asset or album.',
  [ApiTag.Albums]: 'An album is a collection of assets that can be shared with other users or via shared links.',
  [ApiTag.ApiKeys]: 'An api key can be used to programmatically access the Immich API.',
  [ApiTag.Assets]: 'An asset is an image or video that has been uploaded to Immich.',
  [ApiTag.Contacts]:
    'Endpoints for managing contacts backup. Users can upload a VCF file containing their contacts and retrieve or delete it.',
  [ApiTag.Authentication]: 'Endpoints related to user authentication, including OAuth.',
  [ApiTag.AuthenticationAdmin]: 'Administrative endpoints related to authentication.',
  [ApiTag.Deprecated]: 'Deprecated endpoints that are planned for removal in the next major release.',
  [ApiTag.Download]: 'Endpoints for downloading assets or collections of assets.',
  [ApiTag.Duplicates]: 'Endpoints for managing and identifying duplicate assets.',
  [ApiTag.Faces]:
    'A face is a detected human face within an asset, which can be associated with a person. Faces are normally detected via machine learning, but can also be created via manually.',
  [ApiTag.Jobs]:
    'Queues and background jobs are used for processing tasks asynchronously. Queues can be paused and resumed as needed.',
  [ApiTag.Libraries]:
    'An external library is made up of input file paths or expressions that are scanned for asset files. Discovered files are automatically imported. Assets much be unique within a library, but can be duplicated across libraries. Each user has a default upload library, and can have one or more external libraries.',
  [ApiTag.Maintenance]: 'Maintenance mode allows you to put Immich in a read-only state to perform various operations.',
  [ApiTag.Map]:
    'Map endpoints include supplemental functionality related to geolocation, such as reverse geocoding and retrieving map markers for assets with geolocation data.',
  [ApiTag.Memories]:
    'A memory is a specialized collection of assets with dedicated viewing implementations in the web and mobile clients. A memory includes fields related to visibility and are automatically generated per user via a background job.',
  [ApiTag.Notifications]:
    'A notification is a specialized message sent to users to inform them of important events. Currently, these notifications are only shown in the Immich web application.',
  [ApiTag.NotificationsAdmin]: 'Notification administrative endpoints.',
  [ApiTag.Partners]: 'A partner is a link with another user that allows sharing of assets between two users.',
  [ApiTag.People]:
    'A person is a collection of faces, which can be favorited and named. A person can also be merged into another person. People are automatically created via the face recognition job.',
  [ApiTag.Plugins]:
    'A plugin is an installed module that makes filters and actions available for the workflow feature.',
  [ApiTag.Queues]:
    'Queues and background jobs are used for processing tasks asynchronously. Queues can be paused and resumed as needed.',
  [ApiTag.Search]:
    'Endpoints related to searching assets via text, smart search, optical character recognition (OCR), and other filters like person, album, and other metadata. Search endpoints usually support pagination and sorting.',
  [ApiTag.Server]:
    'Information about the current server deployment, including version and build information, available features, supported media types, and more.',
  [ApiTag.Sessions]:
    'A session represents an authenticated login session for a user. Sessions also appear in the web application as "Authorized devices".',
  [ApiTag.SharedLinks]:
    'A shared link is a public url that provides access to a specific album, asset, or collection of assets. A shared link can be protected with a password, include a specific slug, allow or disallow downloads, and optionally include an expiration date.',
  [ApiTag.Stacks]:
    'A stack is a group of related assets. One asset is the "primary" asset, and the rest are "child" assets. On the main timeline, stack parents are included by default, while child assets are hidden.',
  [ApiTag.Sync]: 'A collection of endpoints for the new mobile synchronization implementation.',
  [ApiTag.SystemConfig]: 'Endpoints to view, modify, and validate the system configuration settings.',
  [ApiTag.SystemMetadata]:
    'Endpoints to view, modify, and validate the system metadata, which includes information about things like admin onboarding status.',
  [ApiTag.Tags]:
    'A tag is a user-defined label that can be applied to assets for organizational purposes. Tags can also be hierarchical, allowing for parent-child relationships between tags.',
  [ApiTag.Timeline]:
    'Specialized endpoints related to the timeline implementation used in the web application. External applications or tools should not use or rely on these endpoints, as they are subject to change without notice.',
  [ApiTag.Trash]:
    'Endpoints for managing the trash can, which includes assets that have been discarded. Items in the trash are automatically deleted after a configured amount of time.',
  [ApiTag.UsersAdmin]:
    'Administrative endpoints for managing users, including creating, updating, deleting, and restoring users. Also includes endpoints for resetting passwords and PIN codes.',
  [ApiTag.Users]:
    'Endpoints for viewing and updating the current users, including product key information, profile picture data, onboarding progress, and more.',
  [ApiTag.Views]: 'Endpoints for specialized views, such as the folder view.',
  [ApiTag.Workflows]:
    'A workflow is a set of actions that run whenever a triggering event occurs. Workflows also can include filters to further limit execution.',
};
