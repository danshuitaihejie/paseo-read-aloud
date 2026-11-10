import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadAloudScreen } from "../client/read-aloud-panel";
import { prepareAudio } from "../client/audio";
import { speechAudioCache } from "../client/speech-cache";

const host = vi.hoisted(() => ({
  entries: [
    {
      item: { type: "assistant_message", messageId: "first", text: "已经读完。" },
      timestamp: new Date(1_000).toISOString(),
      seqStart: 1,
      seqEnd: 1,
    },
  ],
  listeners: new Set<() => void>(),
  show: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useHosts: () => [{ serverId: "host", status: "online" }],
  getPaseoClient: () => ({
    agents: {
      ref: () => ({
        timeline: {
          refetch: async () => ({ entries: host.entries }),
          subscribe(listener: () => void) {
            host.listeners.add(listener);
            return () => host.listeners.delete(listener);
          },
        },
      }),
    },
  }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  Icon: "Icon",
  Loading: "Loading",
  ScrollView: "ScrollView",
  useToast: () => ({ show: host.show, error: host.error }),
}));
vi.mock("../client/audio", () => ({ prepareAudio: vi.fn(), stopActiveAudio: () => true }));
vi.mock("../client/read-progress-store", () => ({
  loadReadProgress: async () => null,
  saveReadProgress: async () => undefined,
}));

let renderer: ReactTestRenderer;
let finishAudio: () => void;
const spoken: string[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host.entries = [
    {
      item: { type: "assistant_message", messageId: "first", text: "已经读完。" },
      timestamp: new Date(1_000).toISOString(),
      seqStart: 1,
      seqEnd: 1,
    },
  ];
  spoken.length = 0;
  speechAudioCache.clear();
  vi.mocked(prepareAudio).mockImplementation(async () => ({
    play: () =>
      new Promise<void>((resolve) => {
        finishAudio = resolve;
      }),
    dispose() {},
  }));
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function renderPanel() {
  const client = {
    rpc: async (_contract: unknown, input: { text: string }) => {
      spoken.push(input.text);
      return { base64: input.text, mimeType: "audio/wav", durationMs: 1_000 };
    },
  } as unknown as PluginClientContext;
  const Screen = createReadAloudScreen(client);
  const props = {
    params: { agentId: "agent" },
    host: { id: "host" },
    layout: { compact: false },
    theme: { colors: {} },
  } as unknown as PluginScreenProps;
  await act(async () => {
    renderer = create(createElement(Screen, props));
  });
}

async function press(label: string) {
  await act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: label, accessibilityRole: "button" })
      .props.onPress();
  });
}

async function refresh() {
  await act(async () => {
    for (const listener of host.listeners) listener();
    await vi.advanceTimersByTimeAsync(250);
  });
}

describe("continuous read-aloud", () => {
  it("waits at the end and automatically reads only the newly arrived reply", async () => {
    await renderPanel();
    await press("从顶部开始");
    await act(async () => finishAudio());

    expect(renderer.root.findAllByProps({ accessibilityLabel: "等待新内容" })).toHaveLength(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "停止" })).toHaveLength(1);

    host.entries = [
      ...host.entries,
      {
        item: { type: "assistant_message", messageId: "second", text: "这是新的回复。" },
        timestamp: new Date(2_000).toISOString(),
        seqStart: 2,
        seqEnd: 2,
      },
    ];
    await refresh();

    expect(spoken).toEqual(["已经读完。", "这是新的回复。"]);
    await act(async () => finishAudio());
    expect(renderer.root.findAllByProps({ accessibilityLabel: "等待新内容" })).toHaveLength(1);
    await refresh();
    expect(spoken).toEqual(["已经读完。", "这是新的回复。"]);
  });

  it("reads the appended part of a streaming response without repeating its prefix", async () => {
    host.entries[0].item.text = "正在生成的内容";
    await renderPanel();
    await press("从顶部开始");
    await act(async () => finishAudio());

    host.entries = [
      { ...host.entries[0], item: { ...host.entries[0].item, text: "正在生成的内容还在继续。" } },
    ];
    await refresh();

    expect(spoken).toEqual(["正在生成的内容", "还在继续。"]);
  });

  it("picks up a reply received during the final audio chunk after that chunk ends", async () => {
    await renderPanel();
    await press("从顶部开始");
    host.entries = [
      ...host.entries,
      {
        item: { type: "assistant_message", messageId: "second", text: "播放时收到的回复。" },
        timestamp: new Date(2_000).toISOString(),
        seqStart: 2,
        seqEnd: 2,
      },
    ];
    await refresh();
    expect(spoken).toEqual(["已经读完。"]);

    await act(async () => finishAudio());
    expect(spoken).toEqual(["已经读完。", "播放时收到的回复。"]);
  });

  it("keeps newly refreshed content silent after Stop until the user resumes", async () => {
    await renderPanel();
    await press("从顶部开始");
    await act(async () => finishAudio());
    await press("停止");

    host.entries = [
      ...host.entries,
      {
        item: { type: "assistant_message", messageId: "second", text: "手动停止后的新回复。" },
        timestamp: new Date(2_000).toISOString(),
        seqStart: 2,
        seqEnd: 2,
      },
    ];
    await refresh();
    expect(spoken).toEqual(["已经读完。"]);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "等待新内容" })).toHaveLength(0);

    await press("继续朗读");
    expect(spoken).toEqual(["已经读完。", "手动停止后的新回复。"]);
  });

  it("shows playback errors and does not restart automatically on a refresh", async () => {
    vi.mocked(prepareAudio).mockRejectedValueOnce(new Error("音频预加载失败"));
    await renderPanel();
    await press("从顶部开始");

    expect(host.error).toHaveBeenCalledWith("音频预加载失败");
    expect(renderer.root.findAllByProps({ accessibilityLabel: "重试朗读" })).toHaveLength(1);
    await refresh();
    expect(prepareAudio).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "等待新内容" })).toHaveLength(0);
  });
});
