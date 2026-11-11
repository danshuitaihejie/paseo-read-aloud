import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ OS: "web" }));

vi.mock("react-native", () => ({ Platform: platform }));

import { observeWebScrollIntent, stopWebScrollAnimation } from "../client/web";

interface EventLike {
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

function makeScrollView() {
  const listeners = new Map<string, Set<(event: EventLike) => void>>();
  const node = {
    closest: () => null,
    scrollTop: 120,
    scrollLeft: 24,
    clientWidth: 180,
    clientHeight: 80,
    clientLeft: 0,
    clientTop: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 100 }),
    scrollTo: vi.fn(),
    addEventListener: vi.fn((type: string, listener: (event: EventLike) => void) => {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: EventLike) => void) => {
      listeners.get(type)?.delete(listener);
    }),
  };
  const view = { getScrollableNode: () => node };
  const emit = (type: string, event: EventLike = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return { view, node, listeners, emit };
}

afterEach(() => {
  platform.OS = "web";
});

describe("web scroll following helpers", () => {
  it("reports wheel, touch movement, scroll keys, and scrollbar gestures", () => {
    const { view, node, emit } = makeScrollView();
    const onIntent = vi.fn();
    observeWebScrollIntent(view, onIntent);

    emit("wheel", { deltaY: 20 });
    emit("touchmove");
    emit("keydown", { key: "ArrowDown" });
    emit("pointerdown", { button: 0, target: node, clientX: 181, clientY: 40 });
    emit("pointerdown", { button: 0, target: node, clientX: 40, clientY: 81 });
    emit("pointerdown", { button: 1 });

    expect(onIntent).toHaveBeenCalledTimes(6);
  });

  it("ignores ordinary scroll, form and button keys, and Ctrl+wheel", () => {
    const { view, emit } = makeScrollView();
    const onIntent = vi.fn();
    observeWebScrollIntent(view, onIntent);
    const interactiveTarget = (selector: string) => ({
      closest: vi.fn((query: string) => (query.includes(selector) ? selector : null)),
    });

    emit("scroll");
    emit("wheel", { deltaY: 20, ctrlKey: true });
    emit("wheel", { deltaY: 0 });
    emit("keydown", { key: "ArrowDown", target: interactiveTarget("input") });
    emit("keydown", { key: " ", target: interactiveTarget("button") });
    emit("keydown", { key: " ", altKey: true });
    emit("keydown", { key: "a" });

    expect(onIntent).not.toHaveBeenCalled();
  });

  it("recognizes page navigation from focused sentences and modified document navigation", () => {
    const { view, emit } = makeScrollView();
    const onIntent = vi.fn();
    observeWebScrollIntent(view, onIntent);
    emit("keydown", {
      key: "PageDown",
      target: { closest: (query) => (query.includes("button") ? {} : null) },
    });
    emit("keydown", { key: "End", ctrlKey: true });
    emit("keydown", { key: "Home", metaKey: true });
    expect(onIntent).toHaveBeenCalledTimes(3);
  });

  it("removes every registered listener when observation is cleaned up", () => {
    const { view, node, listeners } = makeScrollView();
    const cleanup = observeWebScrollIntent(view, vi.fn());

    expect([...listeners.keys()].sort()).toEqual(["keydown", "pointerdown", "touchmove", "wheel"]);
    expect(node.addEventListener).toHaveBeenCalledTimes(4);
    cleanup();

    expect([...listeners.values()].every((group) => group.size === 0)).toBe(true);
    expect(node.removeEventListener).toHaveBeenCalledTimes(4);
  });

  it("stops an active scroll animation at the current position immediately", () => {
    const { view, node } = makeScrollView();

    stopWebScrollAnimation(view);

    expect(node.scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 120,
      left: 24,
      behavior: "instant",
    });
  });

  it("does nothing for a missing view or on native platforms", () => {
    const { view, node } = makeScrollView();
    const onIntent = vi.fn();

    expect(observeWebScrollIntent(null, onIntent)).toEqual(expect.any(Function));
    stopWebScrollAnimation(null);
    expect(node.scrollTo).not.toHaveBeenCalled();

    platform.OS = "ios";
    const cleanup = observeWebScrollIntent(view, onIntent);
    stopWebScrollAnimation(view);
    cleanup();

    expect(node.addEventListener).not.toHaveBeenCalled();
    expect(node.scrollTo).not.toHaveBeenCalled();
    expect(onIntent).not.toHaveBeenCalled();
  });
});
