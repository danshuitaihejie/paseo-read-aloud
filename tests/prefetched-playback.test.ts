import { describe, expect, it, vi } from "vitest";
import { runPrefetchedPlayback } from "../client/prefetched-playback";

describe("runPrefetchedPlayback", () => {
  it("prepares only the next item before playing the current item", async () => {
    const events: string[] = [];
    const finishPlaying = new Map<number, () => void>();

    const running = runPrefetchedPlayback({
      items: ["一", "二", "三"],
      lookahead: 1,
      async prepare(_item, index) {
        events.push(`prepare:${index}`);
        return `audio:${index}`;
      },
      play(_prepared, _item, index) {
        events.push(`play:${index}`);
        return new Promise<void>((resolve) => finishPlaying.set(index, resolve));
      },
    });

    await vi.waitFor(() => {
      expect(events).toEqual(["prepare:0", "prepare:1", "play:0"]);
    });

    finishPlaying.get(0)?.();
    await vi.waitFor(() => {
      expect(events).toContain("prepare:2");
      expect(events).toContain("play:1");
      expect(events.indexOf("prepare:2")).toBeLessThan(events.indexOf("play:1"));
    });

    finishPlaying.get(1)?.();
    await vi.waitFor(() => expect(events).toContain("play:2"));
    finishPlaying.get(2)?.();
    await running;
  });

  it("fills a five-item rolling buffer sequentially and refills it during playback", async () => {
    const preparing: number[] = [];
    const playing: number[] = [];
    const finishPreparing = new Map<number, () => void>();
    const finishPlaying = new Map<number, () => void>();
    let activePreparations = 0;
    let maxActivePreparations = 0;
    let keepRunning = true;

    const running = runPrefetchedPlayback({
      items: Array.from({ length: 8 }, (_, index) => `item:${index}`),
      lookahead: 5,
      async prepare(_item, index) {
        preparing.push(index);
        activePreparations += 1;
        maxActivePreparations = Math.max(maxActivePreparations, activePreparations);
        if (index > 0) {
          await new Promise<void>((resolve) => finishPreparing.set(index, resolve));
        }
        activePreparations -= 1;
        return `audio:${index}`;
      },
      play(_prepared, _item, index) {
        playing.push(index);
        return new Promise<void>((resolve) => finishPlaying.set(index, resolve));
      },
      shouldContinue: () => keepRunning,
    });

    await vi.waitFor(() => {
      expect(preparing).toEqual([0, 1]);
      expect(playing).toEqual([0]);
    });

    for (let index = 1; index <= 5; index += 1) {
      finishPreparing.get(index)?.();
      if (index < 5) {
        await vi.waitFor(() =>
          expect(preparing).toEqual(Array.from({ length: index + 2 }, (_, nextIndex) => nextIndex)),
        );
      }
    }
    await vi.waitFor(() => expect(activePreparations).toBe(0));
    expect(preparing).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxActivePreparations).toBe(1);

    finishPlaying.get(0)?.();
    await vi.waitFor(() => {
      expect(preparing).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(playing).toEqual([0, 1]);
    });

    keepRunning = false;
    finishPreparing.get(6)?.();
    finishPlaying.get(1)?.();
    await running;
  });

  it("stops filling the buffer when playback fails", async () => {
    const preparing: number[] = [];
    const disposed: number[] = [];
    let finishPreparingSecond: (() => void) | undefined;

    const running = runPrefetchedPlayback({
      items: Array.from({ length: 8 }, (_, index) => index),
      lookahead: 5,
      async prepare(item) {
        preparing.push(item);
        if (item === 1) {
          await new Promise<void>((resolve) => {
            finishPreparingSecond = resolve;
          });
        }
        return item;
      },
      async play() {
        throw new Error("播放失败");
      },
      dispose(item) {
        disposed.push(item);
      },
    });

    await expect(running).rejects.toThrow("播放失败");
    expect(preparing).toEqual([0, 1]);
    finishPreparingSecond?.();
    await vi.waitFor(() => expect(disposed).toEqual([1]));
    expect(preparing).toEqual([0, 1]);
  });

  it("only reports preparing between items when the buffer has not finished", async () => {
    const finishPreparingSecond: { current?: () => void } = {};
    const states: string[] = [];

    const running = runPrefetchedPlayback({
      items: ["一", "二"],
      async prepare(_item, index) {
        if (index === 1) {
          await new Promise<void>((resolve) => {
            finishPreparingSecond.current = resolve;
          });
        }
        return `audio:${index}`;
      },
      async play(_prepared, _item, index) {
        states.push(`play:${index}`);
      },
      onPreparing(_item, index) {
        states.push(`preparing:${index}`);
      },
    });

    await vi.waitFor(() => {
      expect(states).toEqual(["preparing:0", "play:0", "preparing:1"]);
    });
    finishPreparingSecond.current?.();
    await running;
    expect(states).toEqual(["preparing:0", "play:0", "preparing:1", "play:1"]);
  });
});
