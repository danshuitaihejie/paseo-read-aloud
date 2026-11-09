interface Fulfilled<Value> {
  status: "fulfilled";
  value: Value;
}

interface Rejected {
  status: "rejected";
  reason: unknown;
}

type PreparationResult<Value> = Fulfilled<Value> | Rejected;

interface Preparation<Value> {
  ready: boolean;
  promise: Promise<PreparationResult<Value>>;
}

export interface PrefetchedPlaybackOptions<Item, Prepared> {
  items: readonly Item[];
  lookahead?: number;
  prepare(item: Item, index: number): Promise<Prepared>;
  play(prepared: Prepared, item: Item, index: number): Promise<void>;
  dispose?(prepared: Prepared): void;
  onPreparing?(item: Item, index: number): void;
  onPlaying?(prepared: Prepared, item: Item, index: number): void;
  shouldContinue?(): boolean;
}

/**
 * Plays a sequence while maintaining a small rolling buffer of prepared items.
 * Preparation includes both remote synthesis and any client-side media loading.
 */
export async function runPrefetchedPlayback<Item, Prepared>({
  items,
  lookahead = 1,
  prepare,
  play,
  dispose,
  onPreparing,
  onPlaying,
  shouldContinue = () => true,
}: PrefetchedPlaybackOptions<Item, Prepared>) {
  if (items.length === 0) return;

  const preparations = new Map<number, Preparation<Prepared>>();
  const used = new Set<number>();
  const bufferSize = Math.max(1, Math.floor(lookahead));

  const ensurePrepared = (index: number) => {
    const existing = preparations.get(index);
    if (existing) return existing;

    const entry: Preparation<Prepared> = {
      ready: false,
      promise: Promise.resolve({ status: "rejected", reason: new Error("尚未准备") }),
    };
    let pending: Promise<Prepared>;
    try {
      pending = prepare(items[index], index);
    } catch (error) {
      pending = Promise.reject(error);
    }
    entry.promise = pending.then<PreparationResult<Prepared>, PreparationResult<Prepared>>(
      (value) => {
        entry.ready = true;
        return { status: "fulfilled", value };
      },
      (reason) => {
        entry.ready = true;
        return { status: "rejected", reason };
      },
    );
    preparations.set(index, entry);
    return entry;
  };

  const readPrepared = async (index: number) => {
    const result = await ensurePrepared(index).promise;
    if (result.status === "rejected") throw result.reason;
    return result.value;
  };

  const prefetchAfter = (index: number) => {
    const end = Math.min(items.length - 1, index + bufferSize);
    for (let nextIndex = index + 1; nextIndex <= end; nextIndex += 1) {
      ensurePrepared(nextIndex);
    }
  };

  try {
    onPreparing?.(items[0], 0);
    let prepared = await readPrepared(0);

    for (let index = 0; index < items.length; index += 1) {
      if (!shouldContinue()) return;

      // Start every future preparation before current playback begins.
      prefetchAfter(index);
      used.add(index);
      onPlaying?.(prepared, items[index], index);
      await play(prepared, items[index], index);
      if (!shouldContinue()) return;

      const nextIndex = index + 1;
      if (nextIndex >= items.length) continue;
      const nextPreparation = ensurePrepared(nextIndex);
      if (!nextPreparation.ready) onPreparing?.(items[nextIndex], nextIndex);
      prepared = await readPrepared(nextIndex);
    }
  } finally {
    if (dispose) {
      for (const [index, preparation] of preparations) {
        if (used.has(index)) continue;
        void preparation.promise.then((result) => {
          if (result.status === "fulfilled") dispose(result.value);
        });
      }
    }
  }
}
