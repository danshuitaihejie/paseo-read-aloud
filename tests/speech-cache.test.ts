import { describe, expect, it, vi } from "vitest";
import { createSpeechAudioCache, speechAudioCacheKey } from "../client/speech-cache";

const audio = (value: string) => ({
  base64: value,
  mimeType: "audio/mpeg",
  durationMs: 1_000,
});

describe("speech audio cache", () => {
  it("reuses one synthesis result for the same playback settings", async () => {
    const cache = createSpeechAudioCache();
    const load = vi.fn(async () => audio("cached"));
    const key = speechAudioCacheKey({
      hostId: "host",
      voice: "voice",
      speed: 1,
      text: "同一段内容",
    });

    const first = cache.getOrLoad(key, load);
    const second = cache.getOrLoad(key, load);

    await expect(first).resolves.toEqual(audio("cached"));
    await expect(second).resolves.toEqual(audio("cached"));
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not retain failed synthesis requests", async () => {
    const cache = createSpeechAudioCache();
    const load = vi
      .fn<() => Promise<ReturnType<typeof audio>>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(audio("retry"));

    await expect(cache.getOrLoad("key", load)).rejects.toThrow("network");
    await expect(cache.getOrLoad("key", load)).resolves.toEqual(audio("retry"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry when full", async () => {
    const cache = createSpeechAudioCache({ maxEntries: 2 });
    const loadA = vi.fn(async () => audio("a"));
    const loadB = vi.fn(async () => audio("b"));
    const loadC = vi.fn(async () => audio("c"));

    await cache.getOrLoad("a", loadA);
    await cache.getOrLoad("b", loadB);
    await cache.getOrLoad("a", loadA);
    await cache.getOrLoad("c", loadC);
    await cache.getOrLoad("b", loadB);

    expect(loadA).toHaveBeenCalledOnce();
    expect(loadB).toHaveBeenCalledTimes(2);
    expect(loadC).toHaveBeenCalledOnce();
  });
});
