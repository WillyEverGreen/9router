// The dashboard/CLI connection test must understand Zed instead of reporting
// "Provider test not supported" and flagging a working account as errored.
import { describe, it, expect, vi, beforeEach } from "vitest";

const connection = { id: "z1", provider: "zed", authType: "oauth", accessToken: "tok", providerSpecificData: { userId: "42" } };
const updates = [];

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(async () => connection),
  updateProviderConnection: vi.fn(async (_id, data) => { updates.push(data); }),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false })),
}));
vi.mock("open-sse/shared/zedAuth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchZedAuthenticatedUser: vi.fn(),
}));

import { fetchZedAuthenticatedUser } from "open-sse/shared/zedAuth.js";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

beforeEach(() => { updates.length = 0; vi.clearAllMocks(); });

describe("Zed connection test", () => {
  it("passes when /client/users/me answers", async () => {
    fetchZedAuthenticatedUser.mockResolvedValue({ user: { id: 42 } });
    const res = await testSingleConnection("z1");
    expect(res.valid).toBe(true);
    expect(updates.at(-1).testStatus).toBe("active");
  });

  it("fails with a re-login hint when Zed rejects the credentials", async () => {
    fetchZedAuthenticatedUser.mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 401 }));
    const res = await testSingleConnection("z1");
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/sign in again/);
  });

  it("stays active on a network error", async () => {
    fetchZedAuthenticatedUser.mockRejectedValue(new Error("fetch failed"));
    const res = await testSingleConnection("z1");
    expect(res.valid).toBe(true);
    expect(updates.at(-1).testStatus).toBe("active");
  });
});
