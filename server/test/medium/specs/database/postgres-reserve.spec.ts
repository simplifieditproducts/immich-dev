import postgres from 'postgres';

// Kysely reserves a postgres.js connection for every query. A reserve() queued
// while the pool is busy must settle when a connection closes, or the job
// waiting on it hangs forever, and a reservation ends with its connection
// (patches/postgres@3.4.7.patch, porsager/postgres#1195).

// The postgres database, not the test template: other test files can't create
// their databases from the template while anyone is connected to it.
const url = () => {
  const testUrl = new URL(process.env.IMMICH_TEST_POSTGRES_URL!);
  testUrl.pathname = '/postgres';
  return testUrl.toString();
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settled = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then(() => true), sleep(ms).then(() => false)]);

// Each test waits up to 10 s for what must settle, longer than vitest's default.
describe('postgres.js reserve()', { timeout: 20_000 }, () => {
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

      await expect(settled(queued, 10_000)).resolves.toBe(true);
      await expect(queued).resolves.toBe(1);
      await expect(sql<{ a: number[] }[]>`select array[1, 2]::int[] as a`).resolves.toEqual([{ a: [1, 2] }]);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('keeps a late release() from handing the next owner its connection back to the pool', async () => {
    const sql = postgres(url(), { max: 1, idle_timeout: 30, onnotice: () => {} });
    try {
      const held = await sql.reserve();
      const [{ pid }] = await held<{ pid: number }[]>`select pg_backend_pid() as pid`;
      let inTransaction = false;
      const next = sql.reserve().then(async (reserved) => {
        try {
          await reserved`begin`;
          await reserved`create temp table reserve_test (x int) on commit drop`;
          inTransaction = true;
          await sleep(1000);
          const [{ n }] = await reserved<{ n: number }[]>`select count(*)::int as n from reserve_test`;
          await reserved`commit`;
          return n;
        } finally {
          reserved.release();
        }
      });
      await sleep(100);

      await admin`select pg_terminate_backend(${pid})`;
      for (let i = 0; i < 50 && !inTransaction; i++) {
        await sleep(100);
      }
      expect(inTransaction).toBe(true);
      held.release();

      // with the connection back in the pool, this insert ran inside the open transaction
      await expect(sql`insert into reserve_test values (1)`).rejects.toThrow('reserve_test');
      await expect(next).resolves.toBe(0);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });

  it('fails the queries of a reservation whose connection closes', async () => {
    const sql = postgres(url(), { max: 1, idle_timeout: 30, onnotice: () => {} });
    try {
      const held = await sql.reserve();
      const [{ pid }] = await held<{ pid: number }[]>`select pg_backend_pid() as pid`;
      const running = held`select pg_sleep(3)`.then(() => 'done');
      const queued = held`select ${2}::int as x`.then(() => 'done');
      await sleep(100);

      await admin`select pg_terminate_backend(${pid})`;

      await expect(running).rejects.toThrow();
      await expect(
        settled(
          queued.catch(() => {}),
          10_000,
        ),
      ).resolves.toBe(true);
      await expect(queued).rejects.toThrow();
      await expect(held`select 1`).rejects.toThrow('CONNECTION_CLOSED');
      held.release();
      await expect(settled(sql`select 1`, 10_000)).resolves.toBe(true);
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

      await expect(settled(Promise.all(reserves), 10_000)).resolves.toBe(true);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
