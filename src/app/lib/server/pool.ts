// Runs `work` for every item with at most `limit` running at once, so a long
// list (e.g. push subscribers) finishes in a fraction of the time without
// opening hundreds of connections. A failing item is logged and skipped.
export async function forEachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try { await work(item); } catch (error) { console.error("forEachLimited: item failed", error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
