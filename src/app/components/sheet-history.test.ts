import { beforeEach, describe, expect, test } from "bun:test";

// A browser's session history, enough of it for sheet-history: entries,
// asynchronous back/forward (run by flush), popstate with capture listeners
// first, and the Navigation API's currententrychange on a replace.
type Entry = { state: unknown; url: string };
type Listener = (event: { state: unknown; stopImmediatePropagation: () => void }) => void;
const ORIGIN = "https://zero.test";
const resolve = (url: string) => new URL(url, ORIGIN).href;
const clone = (value: unknown) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));

class FakeHistory {
  entries: Entry[];
  index = 0;
  queue: number[] = [];
  constructor(url: string) { this.entries = [{ state: { __NA: true, tree: url }, url: resolve(url) }]; }
  get state() { return clone(this.entries[this.index].state); }
  get length() { return this.entries.length; }
  get url() { return this.entries[this.index].url; }
  pushState(state: unknown, _title: string, url?: string) {
    this.entries.splice(this.index + 1);
    this.entries.push({ state: clone(state), url: url ? resolve(url) : this.url });
    this.index++;
  }
  replaceState(state: unknown, _title: string, url?: string) {
    this.entries[this.index] = { state: clone(state), url: url ? resolve(url) : this.url };
    fakeWindow.emit("currententrychange", "replace");
  }
  back() { this.queue.push(-1); }
  forward() { this.queue.push(1); }
}

const fakeWindow = {
  listeners: [] as { type: string; fn: Listener; capture: boolean }[],
  navigation: {
    handlers: [] as ((event: { navigationType: string }) => void)[],
    addEventListener(_type: string, fn: (event: { navigationType: string }) => void) { this.handlers.push(fn); },
  },
  addEventListener(type: string, fn: Listener, capture = false) { this.listeners.push({ type, fn, capture }); },
  emit(type: string, navigationType: string) { if (type === "currententrychange") for (const fn of this.navigation.handlers) fn({ navigationType }); },
  popstate() {
    let stopped = false;
    const event = { state: history.state, stopImmediatePropagation: () => { stopped = true; } };
    const ordered = [...this.listeners.filter((item) => item.type === "popstate" && item.capture), ...this.listeners.filter((item) => item.type === "popstate" && !item.capture)];
    for (const { fn } of ordered) { if (stopped) break; fn(event); }
  },
};
let history = new FakeHistory("/");
// Writable: other test files set their own window in the same process.
Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
Object.defineProperty(globalThis, "history", { get: () => history, configurable: true });
Object.defineProperty(globalThis, "location", { get: () => ({ get href() { return history.url; } }), configurable: true });
// Imported once the stand-ins are in: it starts listening as it loads.
const { depthOf, openSheet } = await import("./sheet-history");

// Stands in for the App Router's own popstate listener.
let restored: string[] = [];
fakeWindow.addEventListener("popstate", () => { restored.push(history.url.slice(ORIGIN.length)); });

// Runs queued back/forward steps the way the browser would, later.
function flush() {
  while (history.queue.length) {
    const target = history.index + history.queue.shift()!;
    if (target < 0 || target >= history.entries.length) continue;
    history.index = target;
    fakeWindow.popstate();
  }
}
const at = () => history.url.slice(ORIGIN.length);
// A Next.js navigation: a new entry carrying the router's state.
const navigate = (url: string) => history.pushState({ __NA: true, tree: url }, "", url);
// A user's Back press.
const pressBack = () => { history.back(); flush(); };

let page = 0;
let url = "/";
beforeEach(() => {
  // A page per test, after one to go back to.
  url = `/page-${++page}`;
  history = new FakeHistory("/before");
  navigate(url);
  restored = [];
});

describe("sheet history", () => {
  test("Back closes the sheet and stays on the page", () => {
    let closed = 0;
    openSheet(() => closed++);
    expect(history.length).toBe(3);
    expect(depthOf(history.state)).toBe(1);
    expect(history.state.__NA).toBe(true);
    pressBack();
    expect(closed).toBe(1);
    expect(at()).toBe(url);
    expect(restored).toEqual([url]);
  });

  test("closing with its own controls takes its entry off", () => {
    let closed = 0;
    const sheet = openSheet(() => closed++);
    sheet.dismiss();
    sheet.release();
    flush();
    expect(closed).toBe(0);
    expect(history.index).toBe(1);
    expect(at()).toBe(url);
    pressBack();
    expect(at()).toBe("/before");
  });

  test("after a save, one Back still leaves the page", () => {
    const sheet = openSheet(() => {});
    sheet.release();
    expect(history.index).toBe(2);
    pressBack();
    expect(at()).toBe("/before");
  });

  test("a sheet that goes on to another page leaves Back one step from it", () => {
    const sheet = openSheet(() => {});
    sheet.release();
    navigate("/elsewhere");
    pressBack();
    expect(at()).toBe(url);
    expect(depthOf(history.state)).toBe(0);
    pressBack();
    expect(at()).toBe("/before");
  });

  test("a sheet swapped for another reuses its entry", () => {
    const first = openSheet(() => {});
    first.release();
    let closed = 0;
    const second = openSheet(() => closed++);
    expect(history.length).toBe(3);
    pressBack();
    expect(closed).toBe(1);
    expect(at()).toBe(url);
    second.release();
  });

  test("a sheet reopened before the last one's entry came off gets one of its own", () => {
    const first = openSheet(() => {});
    first.dismiss();
    first.release();
    let closed = 0;
    openSheet(() => closed++);
    flush();
    expect(depthOf(history.state)).toBe(1);
    expect(history.index).toBe(2);
    pressBack();
    expect(closed).toBe(1);
    expect(at()).toBe(url);
  });

  test("stacked sheets close one Back at a time", () => {
    let lower = 0;
    let upper = 0;
    const a = openSheet(() => lower++);
    openSheet(() => upper++);
    expect(depthOf(history.state)).toBe(2);
    pressBack();
    expect([lower, upper]).toEqual([0, 1]);
    a.dismiss();
    a.release();
    flush();
    expect(history.index).toBe(1);
    expect(lower).toBe(0);
  });

  test("a URL replaced as the sheet opens doesn't come back on Back", async () => {
    history.replaceState({ __NA: true, tree: "quick" }, "", `${url}?quick=1`);
    let closed = 0;
    openSheet(() => closed++);
    // The page drops ?quick=1 with router.replace, after the sheet's entry is in.
    history.replaceState({ __NA: true, tree: url }, "", url);
    await Promise.resolve();
    expect(depthOf(history.state)).toBe(1);
    pressBack();
    expect(closed).toBe(1);
    expect(at()).toBe(url);
    expect(history.state.tree).toBe(url);
    expect(restored).toEqual([]);
    pressBack();
    expect(at()).toBe("/before");
  });

  test("the same, closed with its own controls", async () => {
    history.replaceState({ __NA: true, tree: "join" }, "", `${url}?join=1`);
    const sheet = openSheet(() => {});
    history.replaceState({ __NA: true, tree: url }, "", url);
    await Promise.resolve();
    sheet.dismiss();
    sheet.release();
    flush();
    expect(history.index).toBe(1);
    expect(at()).toBe(url);
    expect(restored).toEqual([]);
  });

  test("after saving a form opened with ?quick=1, Back leaves without reopening it", async () => {
    history.replaceState({ __NA: true, tree: "quick" }, "", `${url}?quick=1`);
    const sheet = openSheet(() => {});
    history.replaceState({ __NA: true, tree: url }, "", url);
    await Promise.resolve();
    sheet.release();
    pressBack();
    expect(at()).toBe("/before");
    expect(restored).toEqual(["/before"]);
  });

  test("the same when the form was the first page, with nowhere to go back to", async () => {
    history = new FakeHistory(`${url}?quick=1`);
    const sheet = openSheet(() => {});
    history.replaceState({ __NA: true, tree: url }, "", url);
    await Promise.resolve();
    sheet.release();
    pressBack();
    expect(at()).toBe(url);
    expect(restored).toEqual([]);
  });

  test("a sheet swapped in after a replace keeps the page's new URL on Back", async () => {
    history.replaceState({ __NA: true, tree: "quick" }, "", `${url}?quick=1`);
    const form = openSheet(() => {});
    history.replaceState({ __NA: true, tree: url }, "", url);
    await Promise.resolve();
    form.release();
    let closed = 0;
    openSheet(() => closed++);
    pressBack();
    expect(closed).toBe(1);
    expect(at()).toBe(url);
    expect(restored).toEqual([]);
  });

  test("a save that replaces the page (Delete my data) still leaves Back one step from it", async () => {
    const sheet = openSheet(() => {});
    sheet.release();
    history.replaceState({ __NA: true, tree: "/" }, "", "/");
    await Promise.resolve();
    expect(depthOf(history.state)).toBe(0);
    pressBack();
    expect(at()).toBe("/before");
  });

  test("Forward onto a sheet's leftover entry isn't sent back", () => {
    const sheet = openSheet(() => {});
    sheet.release();
    pressBack();
    expect(at()).toBe("/before");
    history.forward();
    flush();
    expect(history.index).toBe(1);
    history.forward();
    flush();
    expect(history.index).toBe(2);
  });
});
