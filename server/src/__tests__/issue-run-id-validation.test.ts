import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { HttpError } from "../errors.js";
import { actorMiddleware } from "../middleware/auth.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const INVALID_RUN_ID = "fix-triage-cleanup-2026-08-21";
const UNKNOWN_UUID_RUN_ID = "00000000-0000-4000-8000-000000000000";

async function expectHttpError(promise: Promise<unknown>, status: number, message: string) {
  const err = await promise.then(
    () => {
      throw new Error(`expected rejection with HTTP ${status}`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  expect((err as HttpError).message).toContain(message);
}

describeEmbeddedPostgres("agent run id validation before write persistence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;
  let agentId: string;
  let validRunId: string;
  let svc!: ReturnType<typeof issueService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-run-id-validation-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(heartbeatRuns);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  beforeEach(async () => {
    companyId = randomUUID();
    agentId = randomUUID();
    validRunId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Run ID Validation",
      issuePrefix: `R${companyId.replaceAll("-", "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Validation Agent",
      role: "engineer",
      status: "active",
      adapterType: "openclaw_gateway",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(heartbeatRuns).values({
      id: validRunId,
      companyId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: {},
    });
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("rejects checkout with a non-UUID run id before any write (400)", async () => {
    const [issue] = await db
      .insert(issues)
      .values({ companyId, title: "Checkout invalid", status: "todo" })
      .returning();

    await expectHttpError(
      svc.checkout(issue.id, agentId, ["todo"], INVALID_RUN_ID),
      400,
      "Invalid agent run id",
    );
    const after = await db.select().from(issues).then((rows) => rows[0]);
    expect(after.status).toBe("todo");
    expect(after.checkoutRunId).toBeNull();
  });

  it("rejects checkout with an unknown UUID run id before any write (422)", async () => {
    const [issue] = await db
      .insert(issues)
      .values({ companyId, title: "Checkout unknown", status: "todo" })
      .returning();

    await expectHttpError(
      svc.checkout(issue.id, agentId, ["todo"], UNKNOWN_UUID_RUN_ID),
      422,
      "does not reference a heartbeat run",
    );
    const after = await db.select().from(issues).then((rows) => rows[0]);
    expect(after.status).toBe("todo");
    expect(after.checkoutRunId).toBeNull();
  });

  it("rejects ownership adoption with a non-UUID run id instead of a database 500 (400)", async () => {
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        title: "Unowned in progress",
        status: "in_progress",
        assigneeAgentId: agentId,
      })
      .returning();

    // Reproduces OPE-89: this call previously reached adoptUnownedCheckoutRun and
    // failed with "invalid input syntax for type uuid" (HTTP 500).
    await expectHttpError(
      svc.assertCheckoutOwner(issue.id, agentId, INVALID_RUN_ID),
      400,
      "Invalid agent run id",
    );
    const after = await db.select().from(issues).then((rows) => rows[0]);
    expect(after.checkoutRunId).toBeNull();
  });

  it("rejects ownership adoption with an unknown UUID run id (422)", async () => {
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        title: "Unowned in progress unknown",
        status: "in_progress",
        assigneeAgentId: agentId,
      })
      .returning();

    await expectHttpError(
      svc.assertCheckoutOwner(issue.id, agentId, UNKNOWN_UUID_RUN_ID),
      422,
      "does not reference a heartbeat run",
    );
  });

  it("rejects a run id that belongs to another agent (422)", async () => {
    const otherAgentId = randomUUID();
    await db.insert(agents).values({
      id: otherAgentId,
      companyId,
      name: "Other Agent",
      role: "engineer",
      status: "active",
      adapterType: "openclaw_gateway",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    const otherRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: otherRunId,
      companyId,
      agentId: otherAgentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: {},
    });
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        title: "Cross agent run",
        status: "in_progress",
        assigneeAgentId: agentId,
      })
      .returning();

    await expectHttpError(
      svc.assertCheckoutOwner(issue.id, agentId, otherRunId),
      422,
      "does not reference a heartbeat run",
    );
  });

  it("keeps the valid run flow green: checkout and ownership with a real run id", async () => {
    const [issue] = await db
      .insert(issues)
      .values({ companyId, title: "Valid flow", status: "todo" })
      .returning();

    const checkedOut = await svc.checkout(issue.id, agentId, ["todo"], validRunId);
    expect(checkedOut).toMatchObject({
      id: issue.id,
      status: "in_progress",
      assigneeAgentId: agentId,
      checkoutRunId: validRunId,
    });

    const ownership = await svc.assertCheckoutOwner(issue.id, agentId, validRunId);
    expect(ownership).toMatchObject({
      id: issue.id,
      checkoutRunId: validRunId,
      adoptedFromRunId: null,
    });
  });

  it("allows a newer run of the same agent to adopt a stale checkout lock (valid flow)", async () => {
    const [issue] = await db
      .insert(issues)
      .values({
        companyId,
        title: "Stale adopt",
        status: "todo",
      })
      .returning();

    await svc.checkout(issue.id, agentId, ["todo"], validRunId);

    const newerRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: newerRunId,
      companyId,
      agentId,
      status: "running",
      invocationSource: "assignment",
      contextSnapshot: {},
    });
    // The previous run finished; its checkout lock is now stale and adoptable.
    await db
      .update(heartbeatRuns)
      .set({ status: "succeeded" })
      .where(eq(heartbeatRuns.id, validRunId));

    const ownership = await svc.assertCheckoutOwner(issue.id, agentId, newerRunId);
    expect(ownership).toMatchObject({
      id: issue.id,
      checkoutRunId: newerRunId,
      adoptedFromRunId: validRunId,
    });
  });
});

describe("auth middleware run id header gate", () => {
  function buildApp() {
    const app = express();
    app.use(actorMiddleware({} as never, { deploymentMode: "local_trusted" } as never));
    app.use("/api/ping", (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("rejects a non-UUID X-Paperclip-Run-Id with 400 before any handler runs", async () => {
    const res = await request(buildApp())
      .get("/api/ping")
      .set("x-paperclip-run-id", INVALID_RUN_ID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid X-Paperclip-Run-Id header");
  });

  it("rejects a UUID-prefixed-but-malformed run id with 400", async () => {
    const res = await request(buildApp())
      .get("/api/ping")
      .set("x-paperclip-run-id", "82cf0590-9282-40bf-aab2-fdd4888068ed-extra");
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed UUID run id header", async () => {
    const res = await request(buildApp())
      .get("/api/ping")
      .set("x-paperclip-run-id", "82cf0590-9282-40bf-aab2-fdd4888068ed");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("accepts requests without a run id header", async () => {
    const res = await request(buildApp()).get("/api/ping");
    expect(res.status).toBe(200);
  });
});
