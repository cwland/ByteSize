import { describe, expect, it } from "vitest";
import { startupProblem } from "../src/lib/startup.js";

const url = "postgresql://bytesize:secret@db.lan:5433/bytesize";

describe("startupProblem", () => {
  it("explains a missing database / unreachable server / refused sign-in", () => {
    expect(startupProblem({ code: "3D000" }, url)).toBe(`Database "bytesize" doesn't exist. Create it with: createdb bytesize`);
    expect(startupProblem({ code: "ECONNREFUSED" }, url)).toBe("Can't reach PostgreSQL at db.lan:5433. Is it running?");
    const agg = new AggregateError([Object.assign(new Error("connect ECONNREFUSED ::1:5432"), { code: "ECONNREFUSED" })], "");
    expect(startupProblem(agg, "postgresql://u:p@localhost/bytesize")).toBe("Can't reach PostgreSQL at localhost:5432. Is it running?");
    expect(startupProblem({ code: "28P01" }, url)).toBe("PostgreSQL refused the sign-in for this DATABASE_URL.");
    expect(startupProblem({ code: "28000" }, url)).toBe("PostgreSQL refused the sign-in for this DATABASE_URL.");
  });

  it("looks inside drizzle's wrapped query errors", () => {
    // Drizzle wraps the driver's error: DrizzleQueryError { cause: error { code } }
    const wrapped = Object.assign(new Error("Failed query: CREATE SCHEMA"), { cause: Object.assign(new Error('database "bytesize" does not exist'), { code: "3D000" }) });
    expect(startupProblem(wrapped, url)).toBe(`Database "bytesize" doesn't exist. Create it with: createdb bytesize`);
    const refused = Object.assign(new Error("Failed query"), { cause: new AggregateError([{ code: "ECONNREFUSED" }]) });
    expect(startupProblem(refused, url)).toBe("Can't reach PostgreSQL at db.lan:5433. Is it running?");
  });

  it("returns null for anything else", () => {
    expect(startupProblem(new Error("boom"), url)).toBeNull();
    expect(startupProblem({ code: "42P01" }, url)).toBeNull();
    expect(startupProblem(null, url)).toBeNull();
    expect(startupProblem("nope", url)).toBeNull();
  });
});
