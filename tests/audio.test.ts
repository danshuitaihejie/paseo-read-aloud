import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { prepareWebAudio, stopActiveWebAudio } from "../client/web";

interface TestAudioInstance {
  src: string;
  currentTime: number;
  preload?: string;
  readyState?: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onloadeddata: (() => void) | null;
  oncanplaythrough: (() => void) | null;
  load: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  stopActiveWebAudio();
  Reflect.deleteProperty(globalThis, "Audio");
});

describe("web audio preloading", () => {
  it("loads the complete next audio source without starting playback", async () => {
    let audio: TestAudioInstance | undefined;
    class TestAudio implements TestAudioInstance {
      src = "";
      currentTime = 0;
      preload?: string;
      readyState = 0;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onloadeddata: (() => void) | null = null;
      oncanplaythrough: (() => void) | null = null;
      pause = vi.fn();
      play = vi.fn(async () => undefined);
      load = vi.fn(() => this.onloadeddata?.());

      constructor() {
        audio = this;
      }
    }
    Object.assign(globalThis, { Audio: TestAudio });

    const prepared = await prepareWebAudio({ base64: "UklGRg==", mimeType: "audio/wav" });
    expect(prepared).not.toBeNull();
    expect(audio?.load).toHaveBeenCalledOnce();
    expect(audio?.play).not.toHaveBeenCalled();
    expect(audio?.src).toBe("data:audio/wav;base64,UklGRg==");

    const playing = prepared?.play();
    expect(audio?.play).toHaveBeenCalledOnce();
    audio?.onended?.();
    await playing;
    expect(audio?.src).toBe("");
  });
});
