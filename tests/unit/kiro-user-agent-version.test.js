import { afterEach, describe, expect, it, vi } from "vitest";
import { KIRO_IDE_VERSION } from "../../open-sse/config/kiroConstants.js";
import { buildKiroClientUserAgent } from "../../open-sse/services/kiroModels.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const originalKiroIdeVersion = process.env.KIRO_IDE_VERSION;

afterEach(() => {
  if (originalKiroIdeVersion === undefined) delete process.env.KIRO_IDE_VERSION;
  else process.env.KIRO_IDE_VERSION = originalKiroIdeVersion;
  vi.resetModules();
});

describe("Kiro IDE version & client User-Agent headers", () => {
  it("uses supported KIRO_IDE_VERSION default (>= 1.1.14)", () => {
    const parts = KIRO_IDE_VERSION.split(".").map((n) => Number.parseInt(n, 10));
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]).toBeGreaterThanOrEqual(1);
    expect(KIRO_IDE_VERSION).toBe("1.1.14");
  });

  it("supports KIRO_IDE_VERSION env override when reloaded", async () => {
    process.env.KIRO_IDE_VERSION = "1.9.42";
    vi.resetModules();
    const { KIRO_IDE_VERSION: reloadedVersion } = await import("../../open-sse/config/kiroConstants.js");
    const { buildKiroClientUserAgent: reloadedUa } = await import("../../open-sse/services/kiroModels.js");

    expect(reloadedVersion).toBe("1.9.42");
    const { userAgent, amzUserAgent } = reloadedUa({ accessToken: "tok-override" });
    expect(userAgent).toContain("KiroIDE-1.9.42-");
    expect(amzUserAgent).toContain("KiroIDE-1.9.42-");
  });

  it("builds deterministic per-account User-Agent & X-Amz-User-Agent strings", () => {
    const credsA = { providerSpecificData: { clientId: "client-alpha" } };
    const credsB = { providerSpecificData: { clientId: "client-beta" } };

    const ua1 = buildKiroClientUserAgent(credsA, "codewhispererruntime");
    const ua2 = buildKiroClientUserAgent(credsA, "codewhispererruntime");
    const uaOther = buildKiroClientUserAgent(credsB, "codewhispererruntime");

    expect(ua1).toEqual(ua2);
    expect(ua1.userAgent).toMatch(new RegExp(`KiroIDE-${KIRO_IDE_VERSION.replace(/\./g, "\\.")}-[0-9a-f]{64}$`));
    expect(ua1.amzUserAgent).toMatch(new RegExp(`^aws-sdk-js/1\\.0\\.0 KiroIDE-${KIRO_IDE_VERSION.replace(/\./g, "\\.")}-[0-9a-f]{64}$`));
    expect(ua1.userAgent).not.toBe(uaOther.userAgent);
  });

  it("sets Kiro IDE streaming User-Agent and X-Amz-User-Agent in KiroExecutor.buildHeaders", () => {
    const executor = new KiroExecutor();
    const headers = executor.buildHeaders(
      { accessToken: "tok-stream", providerSpecificData: { clientId: "cid-stream", authMethod: "builder-id" } },
      true,
      "https://q.us-east-1.amazonaws.com/"
    );

    expect(headers["User-Agent"]).toContain("api/codewhispererstreaming#1.0.0");
    expect(headers["User-Agent"]).toContain(`KiroIDE-${KIRO_IDE_VERSION}-`);
    expect(headers["X-Amz-User-Agent"]).toMatch(
      new RegExp(`^aws-sdk-js/1\\.0\\.0 KiroIDE-${KIRO_IDE_VERSION.replace(/\./g, "\\.")}-[0-9a-f]{64}$`)
    );
    expect(headers["Amz-Sdk-Request"]).toBe("attempt=1; max=3");
    expect(headers["Amz-Sdk-Invocation-Id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

