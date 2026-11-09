import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";

interface AudioLike {
  src: string;
  currentTime: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

type AudioConstructor = new () => AudioLike;

let activeWebAudio: AudioLike | null = null;
let finishActiveWebAudio: (() => void) | null = null;

export function stopActiveAudio() {
  if (!activeWebAudio) return false;
  const audio = activeWebAudio;
  const finish = finishActiveWebAudio;
  activeWebAudio = null;
  finishActiveWebAudio = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.currentTime = 0;
  finish?.();
  return true;
}

export async function playAudio(
  client: PluginClientContext,
  source: { base64: string; mimeType: string },
) {
  if (Platform.OS !== "web") {
    await client.playAudio(source);
    return;
  }

  const AudioApi = (globalThis as unknown as { Audio?: AudioConstructor }).Audio;
  if (!AudioApi) {
    await client.playAudio(source);
    return;
  }

  stopActiveAudio();
  const audio = new AudioApi();
  activeWebAudio = audio;
  audio.src = `data:${source.mimeType};base64,${source.base64}`;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (activeWebAudio === audio) activeWebAudio = null;
      if (finishActiveWebAudio === finish) finishActiveWebAudio = null;
      resolve();
    };
    finishActiveWebAudio = finish;
    audio.onended = () => {
      finish();
    };
    audio.onerror = () => {
      if (activeWebAudio === audio) activeWebAudio = null;
      if (finishActiveWebAudio === finish) finishActiveWebAudio = null;
      reject(new Error("音频播放失败"));
    };
    audio.play().catch((error) => {
      if (activeWebAudio === audio) activeWebAudio = null;
      if (finishActiveWebAudio === finish) finishActiveWebAudio = null;
      reject(error);
    });
  });
}
