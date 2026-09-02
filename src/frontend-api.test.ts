import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../frontend/src/api.js";

describe("OceanAgent API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not declare JSON content for a bodyless DELETE request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.deleteConversation("conversation-1");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });
});
