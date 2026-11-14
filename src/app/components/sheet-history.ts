// Back closes an open sheet instead of leaving the page. Opening one adds a
// history entry of its own (a copy of the page's, marked `sheet: <depth>`),
// so Android's Back, a back swipe or Alt+← lands on the page under it; the
// close button, Escape and the backdrop take that entry back off. Plain
// module state, no React: every open sheet shares it, so stacked sheets and
// one sheet swapping for another work.
//
// Next.js's App Router copes (see "Native History API" in its docs): a
// pushState carrying its own state (`__NA` and the route tree, spread in)
// goes straight through its patched history, and a popstate back onto the
// page restores the same URL and tree, so nothing re-renders.
//
// A sheet closed some other way (saved, or going on to another page) can't
// take its entry off: history.back() would cancel a navigation still on its
// way. The entry stays, and the next Back steps over it.

type Sheet = { depth: number; from: string; url: string; state: unknown; length: number; close: () => void; done: boolean };

const open: Sheet[] = [];
// A Back this module asked for, and the sheets waiting for it to land
// before they add their own entry.
let popping: { sheet: Sheet; after: (() => void)[] } | null = null;
// The entry as last seen: its URL and how many sheets deep it is.
let seen: { url: string; depth: number } | null = null;
// The last sheet that closed without taking its entry off.
let left: Sheet | null = null;
let listening = false;
let polling: ReturnType<typeof setInterval> | null = null;

export function depthOf(state: unknown) {
  const depth = (state as { sheet?: unknown } | null)?.sheet;
  return typeof depth === "number" ? depth : 0;
}

function marked(state: unknown, depth: number) {
  const copy = { ...(state ?? {}) } as Record<string, unknown>;
  delete copy.sheet;
  if (depth) copy.sheet = depth;
  return copy;
}

function forget(sheet: Sheet) {
  sheet.done = true;
  const index = open.indexOf(sheet);
  if (index >= 0) open.splice(index, 1);
  if (!open.length && polling) { clearInterval(polling); polling = null; }
}

// Next.js replaced the top sheet's entry while it was open (the Log form
// and a group invite drop their ?quick= / ?join= with router.replace as the
// sheet opens), which drops the mark: mark it again, and note the URL the
// app now shows.
function check() {
  const sheet = open.at(-1);
  if (!sheet || popping || depthOf(history.state) || history.length !== sheet.length) return;
  sheet.url = location.href;
  sheet.state = history.state;
  seen = { url: sheet.url, depth: sheet.depth };
  history.replaceState(marked(history.state, sheet.depth), "");
}

// After such a replace, the page under the sheet still has the old URL, and
// letting the router restore it would open the form again. Keep the URL the
// app is showing instead, without telling the router, which is already there.
function keepUrl(event: PopStateEvent, sheet: Sheet) {
  if (sheet.url === sheet.from || location.href !== sheet.from) return;
  event.stopImmediatePropagation();
  history.replaceState(marked(sheet.state, sheet.depth - 1), "", sheet.url);
  seen = { url: sheet.url, depth: sheet.depth - 1 };
}

function onPopState(event: PopStateEvent) {
  const top = depthOf(history.state);
  const url = location.href;
  const before = seen;
  seen = { url, depth: top };
  if (popping) {
    const { sheet, after } = popping;
    popping = null;
    keepUrl(event, sheet);
    for (const add of after) add();
    return;
  }
  // Back from a sheet's entry closes it, and any stacked on it.
  const closing = open.filter((sheet) => sheet.depth > top);
  if (closing.length) {
    // Forgotten first: keepUrl's replace mustn't look like the router's.
    for (const sheet of closing) forget(sheet);
    keepUrl(event, closing[0]);
    for (const sheet of closing.reverse()) sheet.close();
    return;
  }
  // An entry a sheet left behind looks just like the page, so each Back
  // steps over it: landing on one (unless coming forward from the page
  // under it), or stepping off one onto its page, which may still have the
  // URL from before a replace.
  const below = open.at(-1)?.depth ?? 0;
  const forward = before?.url === url && before.depth < top;
  const replaced = left !== null && before?.url === left.url && url === left.from;
  const offLeftover = !open.length && before !== null && before.depth > top && (before.url === url || replaced);
  if (top > below ? forward : !offLeftover) return;
  if (offLeftover && replaced && left) keepUrl(event, left);
  seen = null;
  history.back();
}

function listen() {
  if (listening) return;
  listening = true;
  seen = { url: location.href, depth: depthOf(history.state) };
  // Capture: it runs before the router's own popstate listener, so keepUrl
  // can stop it.
  window.addEventListener("popstate", onPopState, true);
  // Checked just after, not inside, the router's replaceState.
  const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
  navigation?.addEventListener("currententrychange", (event) => { if ((event as Event & { navigationType?: string }).navigationType === "replace") queueMicrotask(check); });
}

// From the start, so an entry a sheet left before a reload is stepped over too.
if (typeof window !== "undefined") listen();

export type SheetEntry = { dismiss: () => void; release: () => void };

// `close` runs when Back closes the sheet. Call `dismiss` when it closes
// with its own controls (then close it as usual), and `release` on unmount.
export function openSheet(close: () => void): SheetEntry {
  const sheet: Sheet = { depth: 0, from: "", url: "", state: null, length: 0, close, done: false };
  listen();
  const add = () => {
    if (sheet.done) return;
    const below = open.at(-1)?.depth ?? 0;
    const top = depthOf(history.state);
    // An entry a sheet left behind (often the sheet this one replaces, as
    // the Log form swaps for the location sheet) is reused, not stacked on.
    const reused = top > below;
    if (reused) sheet.depth = top;
    else { sheet.depth = Math.max(top, below) + 1; history.pushState(marked(history.state, sheet.depth), ""); }
    sheet.url = location.href;
    sheet.length = history.length;
    // A reused entry keeps what its first sheet knew about the page under it.
    const before = reused && left?.depth === top && left.url === sheet.url ? left : null;
    sheet.from = before ? before.from : sheet.url;
    sheet.state = before ? before.state : history.state;
    open.push(sheet);
    seen = { url: sheet.url, depth: sheet.depth };
    // Without the Navigation API (older browsers), look for a replace now and then.
    if (!polling && !("navigation" in window)) polling = setInterval(check, 300);
  };
  if (popping) popping.after.push(add); else add();
  return {
    dismiss() {
      if (sheet.done) return;
      forget(sheet);
      // Only while its entry is on top: one stacked over it, or a page it
      // went on to, keeps its place.
      if (popping || depthOf(history.state) !== sheet.depth) return;
      popping = { sheet, after: [] };
      history.back();
    },
    release() { if (!sheet.done) { forget(sheet); left = sheet; } },
  };
}
