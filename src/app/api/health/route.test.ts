import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { handleHealthRequest } from "./route";

describe("GET /api/health", () => {
  it("returns ready when an application RPC responds", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const database = { rpc } as unknown as SupabaseClient;

    const response = await handleHealthRequest(
      new Request("http://localhost/api/health", {
        headers: { "x-request-id": "test-request" },
      }),
      database,
    );

    expect(rpc).toHaveBeenCalledWith("search_catalog", {
      search_term: "healthcheck",
      result_limit: 1,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("test-request");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 503 without exposing database errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const database = {
      rpc: vi.fn().mockResolvedValue({ error: new Error("secret detail") }),
    } as unknown as SupabaseClient;

    const response = await handleHealthRequest(
      new Request("http://localhost/api/health"),
      database,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    consoleError.mockRestore();
  });
});
