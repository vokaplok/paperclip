import { describe, expect, it } from "vitest";
import { reconcileAgentWaitStatus, resolveSessionKey } from "./execute.js";

describe("reconcileAgentWaitStatus", () => {
  it("treats OpenClaw's observed error/completed wait payload as successful", () => {
    expect(
      reconcileAgentWaitStatus({
        runId: "run-123",
        status: "error",
        error: "completed",
      }),
    ).toBe("ok");
  });

  it("normalizes completion reason casing and whitespace", () => {
    expect(reconcileAgentWaitStatus({ status: "ERROR", error: " Completed " })).toBe("ok");
  });

  it("preserves genuine wait errors", () => {
    expect(
      reconcileAgentWaitStatus({
        status: "error",
        error: "Transcript compaction timed out",
      }),
    ).toBe("error");
  });

  it("does not infer success from completed text on a timeout", () => {
    expect(reconcileAgentWaitStatus({ status: "timeout", error: "completed" })).toBe(
      "timeout",
    );
  });
});

describe("resolveSessionKey", () => {
  it("prefixes run-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "run",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip:run:run-123");
  });

  it("prefixes issue-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "issue",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: "issue-456",
      }),
    ).toBe("agent:meridian:paperclip:issue:issue-456");
  });

  it("prefixes fixed session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });

  it("does not double-prefix an already-routed session key", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "agent:meridian:paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });
});
