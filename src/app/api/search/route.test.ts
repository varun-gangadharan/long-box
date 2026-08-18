import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { handleCatalogSearch } from "./route";

const database = {} as SupabaseClient;

describe("GET /api/search", () => {
  it("returns catalog matches", async () => {
    const search = vi.fn().mockResolvedValue([{ type: "character", name: "Daredevil" }]);
    const response = await handleCatalogSearch(
      new Request("http://localhost/api/search?q=dare"),
      database,
      search,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ type: "character", name: "Daredevil" }],
    });
    expect(search).toHaveBeenCalledWith(database, "dare", 8);
  });

  it("rejects short or oversized searches", async () => {
    const search = vi.fn();
    const response = await handleCatalogSearch(
      new Request("http://localhost/api/search?q=d"),
      database,
      search,
    );
    expect(response.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("contains configuration failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleCatalogSearch(
      new Request("http://localhost/api/search?q=dare"),
      () => {
        throw new Error("missing environment");
      },
    );
    expect(response.status).toBe(500);
    consoleError.mockRestore();
  });
});
