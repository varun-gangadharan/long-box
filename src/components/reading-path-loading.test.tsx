// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReadingPathLoading } from "./reading-path-loading";

/**
 * This component runs inside a Suspense fallback, which React does not hydrate
 * while the boundary is pending — the streamed markup is inert. So the tests
 * check the static markup and CSS timing that actually run there, and
 * deliberately do not assert on any client-side behaviour, because none exists.
 */
describe("ReadingPathLoading", () => {
  afterEach(cleanup);

  it("sets the expectation that the wait is one-off", () => {
    render(<ReadingPathLoading />);
    expect(screen.getByText(/Every search after this one is instant/)).toBeDefined();
  });

  it("ships every stage in the markup so none depends on JavaScript", () => {
    const { container } = render(<ReadingPathLoading />);
    const lines = container.querySelectorAll(".stage-line");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].textContent).toBe("Looking up both characters.");
  });

  it("schedules the stages to run in sequence without gaps", () => {
    const { container } = render(<ReadingPathLoading />);
    const lines = [...container.querySelectorAll<HTMLElement>(".stage-line")];

    let previousEnd = 0;
    for (const line of lines.slice(0, -1)) {
      const delay = Number.parseFloat(line.style.animationDelay);
      const duration = Number.parseFloat(line.style.animationDuration);
      // Each line starts exactly when the previous one ends, so the copy never
      // blinks out between stages.
      expect(delay).toBe(previousEnd);
      previousEnd = delay + duration;
    }

    const last = lines.at(-1)!;
    expect(last.className).toContain("stage-line-last");
    expect(Number.parseFloat(last.style.animationDelay)).toBe(previousEnd);
  });

  it("announces one honest line rather than reading all six aloud", () => {
    const { container } = render(<ReadingPathLoading />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/usually takes about a minute/);
    expect(container.querySelector(".loading-stage")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("hides the decorative animation from assistive technology", () => {
    const { container } = render(<ReadingPathLoading />);
    expect(container.querySelector(".long-box")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });
});
