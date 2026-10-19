import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TranscriptPanel } from "./TranscriptPanel";

describe("TranscriptPanel", () => {
  it("shows the empty state before the first message", () => {
    render(<TranscriptPanel messages={[]} />);
    expect(screen.getByText(/waiting for the conversation/i)).toBeTruthy();
  });

  it("lists every message in order", () => {
    render(<TranscriptPanel messages={[{ id: "1", speaker: "caller", text: "Hi" }, { id: "2", speaker: "agent", text: "Hello" }]} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Hi", "Hello"]);
  });

  it("scrolls to the newest message", () => {
    const scrollTo = vi.spyOn(Element.prototype, "scrollTo");
    render(<TranscriptPanel messages={[{ id: "1", speaker: "caller", text: "Hi" }, { id: "2", speaker: "agent", text: "Hello" }]} />);
    expect(scrollTo).toHaveBeenCalled();
  });
});
