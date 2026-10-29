import postgres from 'postgres';

// Kysely reserves a postgres.js connection for every query. A reserve() queued
// while the pool is busy must settle when a connection closes, or the job
// waiting on it hangs forever (patches/postgres@3.4.7.patch,
// porsager/postgres#1195).

const url = () => process.env.IMMICH_TEST_POSTGRES_URL!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settled = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then(() => true), sleep(ms).then(() => false)]);

describe('postgres.js reserve()', () => {
  let admin: postgres.Sql;

  beforeAll(() => {
    admin = postgres(url(), { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await admin.end();
  });

  it('settles a queued reserve() when the busy connection is terminated', async () => {
    const sql = postgres(url(), { max: 1, idle_timeout: 30, onnotice: () => {} });
    try {
      const held = await sql.reserve();
      const [{ pid }] = await held<{ pid: number }[]>`select pg_backend_pid() as pid`;
      const queued = sql.reserve().then(async (reserved) => {
        const [{ x }] = await reserved<{ x: number }[]>`select 1 as x`;
        reserved.release();
        return x;
      });
      await sleep(100);

      await admin`select pg_terminate_backend(${pid})`;

      await expect(settled(queued, 5000)).resolves.toBe(true);
      await expect(queued).resolves.toBe(1);
      await expect(sql<{ a: number[] }[]>`select array[1, 2]::int[] as a`).resolves.toEqual([{ a: [1, 2] }]);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('settles reserve() calls that land while the idle timer closes the connection', async () => {
    const sql = postgres(url(), { max: 1, idle_timeout: 1, onnotice: () => {} });
    try {
      await sql`select 1`;
      await sleep(1000);

      const reserves: Promise<void>[] = [];
      for (let i = 0; i < 40; i++) {
        reserves.push(sql.reserve().then((reserved) => reserved.release()));
        await sleep(1);
      }

      await expect(settled(Promise.all(reserves), 5000)).resolves.toBe(true);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
