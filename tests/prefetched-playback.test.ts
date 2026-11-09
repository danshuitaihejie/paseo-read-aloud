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
