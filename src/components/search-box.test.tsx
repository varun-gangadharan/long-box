// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchBox } from "./search-box";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const daredevil = {
  type: "character",
  id: "60000000-0000-4000-8000-000000000001",
  comicvineId: 1,
  name: "Daredevil",
  description: null,
  imageUrl: null,
  context: "Marvel",
};

describe("SearchBox", () => {
  beforeEach(() => {
    push.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [daredevil] }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("searches, selects, and navigates with a canonical character", async () => {
    render(<SearchBox />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dare" } });
    expect(
      (await screen.findByRole("option", {}, { timeout: 1000 })).textContent,
    ).toContain("Daredevil");
    fireEvent.click(screen.getByRole("option").querySelector("button")!);
    expect(screen.getByRole("button", { name: "Remove Daredevil" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Find my way in" }));
    expect(push).toHaveBeenCalledWith("/read?characters=Daredevil");
  });

  it("supports keyboard selection", async () => {
    render(<SearchBox />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "dare" } });
    await waitFor(() => expect(screen.getByRole("option")).toBeDefined(), {
      timeout: 1000,
    });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove Daredevil" })).toBeDefined();
  });
});
