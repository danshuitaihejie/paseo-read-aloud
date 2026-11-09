import { Platform } from "react-native";
import type { PreparedAudio } from "./audio";

interface AudioLike {
  src: string;
  currentTime: number;
  preload?: string;
  readyState?: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onloadeddata?: (() => void) | null;
  oncanplaythrough?: (() => void) | null;
  load?(): void;
  play(): Promise<void>;
  pause(): void;
}

type AudioConstructor = new () => AudioLike;

let activeAudio: AudioLike | null = null;
let finishActiveAudio: (() => void) | null = null;

export function stopActiveWebAudio() {
  if (Platform.OS !== "web" || !activeAudio) return false;
  const audio = activeAudio;
  const finish = finishActiveAudio;
  activeAudio = null;
  finishActiveAudio = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.currentTime = 0;
  audio.src = "";
  finish?.();
  return true;
}

export async function prepareWebAudio(source: {
  base64: string;
  mimeType: string;
}): Promise<PreparedAudio | null> {
  if (Platform.OS !== "web") return null;
  const AudioApi = (globalThis as unknown as { Audio?: AudioConstructor }).Audio;
  if (!AudioApi) return null;

  const audio = new AudioApi();
  audio.preload = "auto";
  audio.src = `data:${source.mimeType};base64,${source.base64}`;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.onloadeddata = null;
      audio.oncanplaythrough = null;
      audio.onerror = null;
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    audio.onloadeddata = finish;
    audio.oncanplaythrough = finish;
    audio.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      audio.src = "";
      reject(new Error("音频预加载失败"));
    };
    audio.load?.();
    if (!audio.load || (audio.readyState ?? 0) >= 3) finish();
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    audio.onended = null;
    audio.onerror = null;
    audio.onloadeddata = null;
    audio.oncanplaythrough = null;
    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
  };

  return {
    dispose,
    async play() {
      if (disposed) throw new Error("音频已释放");
      stopActiveWebAudio();
      activeAudio = audio;
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          if (activeAudio === audio) activeAudio = null;
          if (finishActiveAudio === finish) finishActiveAudio = null;
          dispose();
          resolve();
        };
        finishActiveAudio = finish;
        audio.onended = finish;
        audio.onerror = () => {
          if (activeAudio === audio) activeAudio = null;
          if (finishActiveAudio === finish) finishActiveAudio = null;
          dispose();
          reject(new Error("音频播放失败"));
        };
        audio.play().catch((error) => {
          if (activeAudio === audio) activeAudio = null;
          if (finishActiveAudio === finish) finishActiveAudio = null;
          dispose();
          reject(error);
        });
      });
    },
  };
}
