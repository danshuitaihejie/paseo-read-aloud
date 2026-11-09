export interface SpeechAudioPayload {
  base64: string;
  mimeType: string;
  durationMs: number;
}

interface CacheEntry {
  promise: Promise<SpeechAudioPayload>;
  size: number;
}

interface SpeechAudioCacheOptions {
  maxEntries?: number;
  maxBase64Characters?: number;
}

export function createSpeechAudioCache({
  maxEntries = 40,
  maxBase64Characters = 8 * 1024 * 1024,
}: SpeechAudioCacheOptions = {}) {
  const entries = new Map<string, CacheEntry>();
  let totalSize = 0;

  const remove = (key: string, entry: CacheEntry) => {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    totalSize -= entry.size;
  };

  const trim = () => {
    while (entries.size > maxEntries || totalSize > maxBase64Characters) {
      const oldest = entries.entries().next().value;
      if (!oldest) return;
      remove(oldest[0], oldest[1]);
    }
  };

  return {
    getOrLoad(key: string, load: () => Promise<SpeechAudioPayload>) {
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        entries.set(key, existing);
        return existing.promise;
      }

      const entry: CacheEntry = {
        size: 0,
        promise: Promise.resolve().then(load),
      };
      entry.promise = entry.promise.then(
        (audio) => {
          if (entries.get(key) === entry) {
            entry.size = audio.base64.length;
            totalSize += entry.size;
            trim();
          }
          return audio;
        },
        (error) => {
          remove(key, entry);
          throw error;
        },
      );
      entries.set(key, entry);
      trim();
      return entry.promise;
    },
    clear() {
      entries.clear();
      totalSize = 0;
    },
  };
}

export const speechAudioCache = createSpeechAudioCache();

export function speechAudioCacheKey({
  hostId,
  voice,
  speed,
  text,
}: {
  hostId: string;
  voice: string;
  speed: number;
  text: string;
}) {
  return JSON.stringify([hostId, voice, speed, text]);
}
