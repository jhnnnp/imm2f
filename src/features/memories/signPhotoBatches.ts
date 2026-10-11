/** Match the server's authorization batch limit without dropping older photos. */
export async function signPhotoBatches(
  ids: readonly string[],
  sign: (ids: string[]) => Promise<Record<string, string>>,
  isCurrent: () => boolean = () => true,
) {
  const unique = [...new Set(ids)];
  const urls: Record<string, string> = {};
  let failed = false;
  // Two concurrent batches keep large albums responsive without flooding actions.
  for (let offset = 0; offset < unique.length && isCurrent(); offset += 96) {
    const batches = [unique.slice(offset, offset + 48), unique.slice(offset + 48, offset + 96)].filter(batch => batch.length);
    const results = await Promise.allSettled(batches.map(batch => Promise.resolve().then(() => sign(batch))));
    if (!isCurrent()) break;
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        Object.assign(urls, result.value);
        if (batches[index].some(id => !result.value[id])) failed = true;
      }
      else failed = true;
    }
  }
  return { urls, failed };
}
