import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NeedsYouBadge } from "@/components/lead-status";

const html = (props: Parameters<typeof NeedsYouBadge>[0]) => renderToStaticMarkup(createElement(NeedsYouBadge, props));
const classOf = (markup: string) => markup.match(/class="([^"]*)"/)![1].split(/\s+/);

describe("NeedsYouBadge", () => {
  it("REGRESSION: can shrink and wrap, so a long label stays inside a narrow card", () => {
    const classes = classOf(html({ reason: "unsure", withPrefix: true }));
    // These three made the badge one unbreakable line that ran past the card and got clipped.
    expect(classes).not.toContain("whitespace-nowrap");
    expect(classes).not.toContain("shrink-0");
    expect(classes).not.toContain("rounded-full");
    expect(classes).toEqual(expect.arrayContaining(["max-w-full", "whitespace-normal", "shrink"]));
  });

  it("shows the whole label, not a cut one", () => {
    expect(html({ reason: "unsure", withPrefix: true })).toContain("Needs you: the assistant was not sure");
    expect(html({ reason: "payment", withPrefix: false })).not.toContain("Needs you");
  });
});
