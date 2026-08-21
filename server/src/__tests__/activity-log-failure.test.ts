import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWarn = vi.hoisted(() => vi.fn());

vi.mock("../middleware/logger.js", () => ({
  logger: { warn: mockWarn },
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({
    getGeneral: async () => ({ censorUsernameInLogs: false }),
  }),
}));

const { logActivity } = await import("../services/activity-log.js");

describe("failure-safe activity logging", () => {
  beforeEach(() => {
    mockWarn.mockReset();
  });

  it("resolves and emits a structured warning when activity persistence fails", async () => {
    const persistenceError = new Error("activity insert failed");
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(async () => {
          throw persistenceError;
        }),
      })),
    };

    await expect(logActivity(db as never, {
      companyId: "22222222-2222-4222-8222-222222222222",
      actorType: "agent",
      actorId: "33333333-3333-4333-8333-333333333333",
      agentId: "33333333-3333-4333-8333-333333333333",
      runId: "55555555-5555-4555-8555-555555555555",
      action: "issue.created",
      entityType: "issue",
      entityId: "88888888-8888-4888-8888-888888888888",
    })).resolves.toBeUndefined();

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: persistenceError,
        companyId: "22222222-2222-4222-8222-222222222222",
        action: "issue.created",
        entityType: "issue",
        entityId: "88888888-8888-4888-8888-888888888888",
        runId: "55555555-5555-4555-8555-555555555555",
      }),
      "failed to persist non-critical activity log",
    );
  });
});
