import { Platform } from "react-native";
import type { PreparedAudio } from "./audio";

interface ScrollIntentEvent {
  deltaY?: number;
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  button?: number;
  clientX?: number;
  clientY?: number;
  target?: { closest(selector: string): unknown };
}

interface ScrollNode {
  closest(selector: string): unknown;
  scrollTop: number;
  scrollLeft: number;
  clientWidth: number;
  clientHeight: number;
  clientLeft: number;
  clientTop: number;
  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number };
  scrollTo(options: { top: number; left: number; behavior: "instant" }): void;
  addEventListener(
    type: string,
    listener: (event: ScrollIntentEvent) => void,
    options: { passive: boolean },
  ): void;
  removeEventListener(type: string, listener: (event: ScrollIntentEvent) => void): void;
}

interface WebScrollView {
  getScrollableNode(): ScrollNode;
}

const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export function stopWebScrollAnimation(view: WebScrollView | null) {
  if (!view || Platform.OS !== "web") return;
  const node = view.getScrollableNode();
  node.scrollTo({ top: node.scrollTop, left: node.scrollLeft, behavior: "instant" });
}

export function observeWebScrollIntent(view: WebScrollView | null, onIntent: () => void) {
  if (!view || Platform.OS !== "web") return () => {};
  const node = view.getScrollableNode();
  const onWheel = (event: ScrollIntentEvent) => {
    if (event.deltaY && !event.ctrlKey) onIntent();
  };
  const onKeyDown = (event: ScrollIntentEvent) => {
    if (!SCROLL_KEYS.has(event.key ?? "") || event.altKey) return;
    if (
      event.target?.closest(
        "input, textarea, select, [contenteditable]:not([contenteditable=false])",
      )
    )
      return;
    if (
      event.key === " " &&
      (event.ctrlKey || event.metaKey || event.target?.closest("button, [role=button], a[href]"))
    )
      return;
    onIntent();
  };
  const onPointerDown = (event: ScrollIntentEvent) => {
    if (event.button === 1) {
      onIntent();
      return;
    }
    if (event.button !== 0 || event.target !== node) return;
    const rect = node.getBoundingClientRect();
    // Overlay scrollbars do not reduce clientWidth/clientHeight; include their edge hit area.
    const rightEdge = Math.min(rect.right - 12, rect.left + node.clientLeft + node.clientWidth);
    const bottomEdge = Math.min(rect.bottom - 12, rect.top + node.clientTop + node.clientHeight);
    if ((event.clientX ?? 0) >= rightEdge || (event.clientY ?? 0) >= bottomEdge) onIntent();
  };
  const listeners = [
    ["wheel", onWheel],
    ["touchmove", onIntent],
    ["keydown", onKeyDown],
    ["pointerdown", onPointerDown],
  ] as const;
  for (const [type, listener] of listeners)
    node.addEventListener(type, listener, { passive: true });
  return () => {
    for (const [type, listener] of listeners) node.removeEventListener(type, listener);
  };
}

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
