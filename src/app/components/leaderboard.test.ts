import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The screen's top bar and tab bar read the route; there's no router here.
mock.module("next/navigation", () => ({ usePathname: () => "/rewards/leaderboard", useRouter: () => ({ push() {}, replace() {}, back() {}, prefetch() {} }), useSearchParams: () => new URLSearchParams() }));
const { LeaderboardScreen } = await import("./leaderboard");

describe("LeaderboardScreen", () => {
  // The prerendered page hasn't read the saved place yet, so it can't name a
  // region: the default city's would show and then change.
  test("the region button is neutral before the saved place is known", () => {
    const html = renderToStaticMarkup(createElement(LeaderboardScreen));
    expect(html).toContain(">My region</button>");
    expect(html).not.toContain(" grid</button>");
  });
});
