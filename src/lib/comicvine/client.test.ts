import { describe, expect, it, vi } from "vitest";

import { ComicVineClient, ComicVineError } from "./client";

function payload(results: unknown[], total: number, offset: number) {
  return {
    status_code: 1,
    error: "OK",
    number_of_total_results: total,
    number_of_page_results: results.length,
    limit: 100,
    offset,
    results,
  };
}

const character = (id: number) => ({ id, name: `Character ${id}` });

describe("ComicVineClient", () => {
  it("follows pagination until the requested result count", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload([character(1), character(2)], 3, 0))),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(payload([character(3)], 3, 2))),
      );
    const client = new ComicVineClient("test-key", { fetch: fetchMock });

    const results = await client.searchCharacters("character", 3);

    expect(results.map(({ comicvineId }) => comicvineId)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("offset=2");
  });

  it("loads full issue details from character issue credits", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...payload([], 1, 0),
          results: {
            id: 99,
            volume: { id: 20, name: "Daredevil" },
            issue_number: "16",
            character_credits: [{ id: 1, name: "Daredevil" }],
          },
        }),
      ),
    );
    const client = new ComicVineClient("test-key", { fetch: fetchMock });

    const issues = await client.getIssues([{ comicvineId: 99 }], 1);

    expect(issues[0]).toMatchObject({ comicvineId: 99, issueNumber: "16" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/issue/4000-99/");
  });

  it("rejects malformed successful responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(payload([{ id: "bad", name: "Broken" }], 1, 0))),
    );
    const client = new ComicVineClient("test-key", {
      fetch: fetchMock,
      maxRetries: 0,
    });

    await expect(client.searchCharacters("broken", 1)).rejects.toThrow(
      /malformed data/i,
    );
  });

  it("surfaces ComicVine API errors returned over HTTP 200", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ status_code: 100, error: "Invalid API key" })),
    );
    const client = new ComicVineClient("test-key", {
      fetch: fetchMock,
      maxRetries: 0,
    });

    await expect(client.searchCharacters("daredevil", 1)).rejects.toThrow(
      "ComicVine API error: Invalid API key",
    );
  });

  it("surfaces non-retryable HTTP errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("nope", { status: 401 }),
    );
    const client = new ComicVineClient("test-key", {
      fetch: fetchMock,
      maxRetries: 0,
    });

    await expect(client.searchCharacters("daredevil", 1)).rejects.toEqual(
      expect.objectContaining<Partial<ComicVineError>>({ status: 401 }),
    );
  });
});
