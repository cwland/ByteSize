import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// The test helper empties every table between tests. A write still running from the test before (a log line,
// a usage count) must never deadlock with it: the tables are emptied children first, so a write that holds a
// table and then checks the row it points at (a foreign key) finishes before the emptying reaches that table.

const url = process.env.TEST_DATABASE_URL ?? "postgresql://bytesize:bytesize@localhost:5432/bytesize_test";
let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
afterAll(async () => t.close());

async function waitForBlockedLock(c: pg.Client) {
  for (let i = 0; i < 500; i++) {
    const r = await c.query("select count(*)::int as n from pg_locks where not granted");
    if (r.rows[0].n > 0) return;
    await new Promise((res) => setTimeout(res, 10));
  }
  throw new Error("the reset never waited on a lock");
}

// A table that points at another (child → parent) where the parent comes first in the order the tables are
// listed: the order an emptying that doesn't sort them would lock them in
async function pairListedParentFirst(c: pg.Client) {
  const listed = (await c.query("select tablename from pg_tables where schemaname = 'public'")).rows.map((r) => r.tablename as string);
  const fks = (
    await c.query(
      "select cl.relname as child, pa.relname as parent from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_class pa on pa.oid = k.confrelid where k.contype = 'f' and cl.relname <> pa.relname"
    )
  ).rows as { child: string; parent: string }[];
  return fks.find((f) => listed.indexOf(f.parent) < listed.indexOf(f.child)) ?? fks[0];
}

describe("emptying the tables between tests", () => {
  it("doesn't deadlock with a write in flight that holds a table and then checks its foreign key", async () => {
    await t.login();
    const writer = new pg.Client({ connectionString: url });
    await writer.connect();
    try {
      const { child, parent } = await pairListedParentFirst(writer);
      // This side looks for a deadlock first, so if there is one, it is the one cancelled (and the test fails)
      await writer.query("set deadlock_timeout = '20ms'");
      await writer.query("begin");
      // The first half of an insert into the child: the table is held (as an insert holds it)...
      await writer.query(`lock table "${child}" in row exclusive mode`);
      const reset = t.reset();
      await waitForBlockedLock(writer);
      // ...and the second half: the foreign-key check on the parent (select ... for key share takes this lock)
      await writer.query(`lock table "${parent}" in row share mode`);
      await writer.query("commit");
      await reset;
    } finally {
      await writer.end();
    }
    expect((await t.api("GET", "/api/auth/status")).status).toBeLessThan(500);
  });
});
