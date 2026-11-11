import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  status: "online",
  statusListeners: new Set<() => void>(),
  send: vi.fn<(hostId: string, agentId: string, text: string) => Promise<void>>(),
  scrollTo: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("@getpaseo/plugin/client", async () => {
  const { useSyncExternalStore } = await import("react");
  function subscribe(listener: () => void) {
    host.statusListeners.add(listener);
    return () => host.statusListeners.delete(listener);
  }
  return {
    useHosts: () => {
      const status = useSyncExternalStore(subscribe, () => host.status);
      return [{ serverId: "host", status }];
    },
    getPaseoClient: (hostId: string) => ({
      agents: {
        ref: (agentId: string) => ({
          send: (text: string) => host.send(hostId, agentId, text),
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
  };
});
vi.mock("@getpaseo/plugin/client/ui", () => ({
  Icon: "Icon",
  Loading: "Loading",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
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
  host.status = "online";
  host.send.mockResolvedValue(undefined);
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
    const queryClient = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
    renderer = create(
      createElement(QueryClientProvider, { client: queryClient }, createElement(Screen, props)),
      {
        createNodeMock: (element) =>
          element.type === "ScrollView" ? { scrollTo: host.scrollTo } : null,
      },
    );
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

async function enterMessage(text: string) {
  await act(async () => {
    renderer.root
      .findByProps({ accessibilityLabel: "发送给当前 Agent 的消息" })
      .props.onChangeText(text);
  });
}

async function layoutResponses() {
  await act(async () => {
    for (const node of renderer.root.findAll(
      (item) => typeof item.type === "string" && item.props.onLayout,
    )) {
      node.props.onLayout({ nativeEvent: { layout: { y: 100 } } });
    }
  });
}

function beginScrollDrag() {
  renderer.root
    .find((node) => typeof node.props.onScrollBeginDrag === "function")
    .props.onScrollBeginDrag();
}

describe("read-aloud scroll following", () => {
  it("keeps highlighting across sentences without scrolling until following is explicitly resumed", async () => {
    host.entries[0].item.text = "先读第一句。再读第二句。";
    await renderPanel();
    await layoutResponses();
    await press("从顶部开始");
    expect(host.scrollTo).toHaveBeenCalledWith({ y: 284, animated: true });

    await act(async () => {
      beginScrollDrag();
    });
    const scrollCount = host.scrollTo.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(
      renderer.root.findByProps({ testID: "read-aloud-segment-0-1" }).props.accessibilityState
        .selected,
    ).toBe(true);
    expect(renderer.root.findAllByProps({ testID: "read-aloud-active-word" })).not.toHaveLength(0);
    expect(host.scrollTo).toHaveBeenCalledTimes(scrollCount);

    // A long pause, audio completion, and a newly arrived response must not re-enable following.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => finishAudio());
    host.entries.push({
      item: { type: "assistant_message", messageId: "second", text: "继续读新回复。" },
      timestamp: new Date(2_000).toISOString(),
      seqStart: 2,
      seqEnd: 2,
    });
    await refresh();
    await layoutResponses();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(spoken).toEqual(["先读第一句。 再读第二句。", "继续读新回复。"]);
    expect(host.scrollTo).toHaveBeenCalledTimes(scrollCount);

    await press("恢复跟随");
    expect(host.scrollTo).toHaveBeenCalledTimes(scrollCount + 1);
    expect(renderer.root.findAllByProps({ accessibilityLabel: "暂停跟随" })).toHaveLength(1);
  });

  it("blocks an audio preparation callback that finishes after the user starts scrolling", async () => {
    let releasePreparation: () => void = () => {};
    vi.mocked(prepareAudio).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePreparation = () =>
            resolve({
              play: () =>
                new Promise<void>((finish) => {
                  finishAudio = finish;
                }),
              dispose() {},
            });
        }),
    );
    await renderPanel();
    await layoutResponses();
    await press("从顶部开始");
    const scrollCount = host.scrollTo.mock.calls.length;
    await act(async () => {
      beginScrollDrag();
      releasePreparation();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(host.scrollTo).toHaveBeenCalledTimes(scrollCount);
    expect(renderer.root.findAllByProps({ testID: "read-aloud-active-word" })).not.toHaveLength(0);
    await press("恢复跟随");
    expect(host.scrollTo).toHaveBeenCalledTimes(scrollCount + 1);
  });
});

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

describe("messages from the read-aloud page", () => {
  it("sends a follow-up without interrupting playback and clears the accepted message", async () => {
    await renderPanel();
    await press("从顶部开始");
    await enterMessage("请继续解释。");
    await press("发送消息");

    expect(host.send).toHaveBeenCalledExactlyOnceWith("host", "agent", "请继续解释。");
    expect(
      renderer.root.findByProps({ accessibilityLabel: "发送给当前 Agent 的消息" }).props.value,
    ).toBe("");
    expect(host.show).toHaveBeenCalledWith("消息已发送", { variant: "success" });
    expect(renderer.root.findAllByProps({ accessibilityLabel: "停止" })).toHaveLength(1);
    expect(spoken).toEqual(["已经读完。"]);
    await act(async () => finishAudio());
    expect(renderer.root.findAllByProps({ accessibilityLabel: "等待新内容" })).toHaveLength(1);
  });

  it("keeps a failed message and shows an actionable error until a successful retry", async () => {
    host.send.mockRejectedValueOnce(new Error("连接已断开"));
    await renderPanel();
    await enterMessage("请保留这条问题。");
    await press("发送消息");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      renderer.root.findByProps({ accessibilityLabel: "发送给当前 Agent 的消息" }).props.value,
    ).toBe("请保留这条问题。");
    const alert = renderer.root.findByProps({ accessibilityRole: "alert" });
    expect(alert.children).toEqual(["发送失败：", "连接已断开", "。内容已保留，请重试。"]);
    expect(host.send).toHaveBeenCalledTimes(1);

    await press("发送消息");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(host.send).toHaveBeenCalledTimes(2);
    expect(
      renderer.root.findByProps({ accessibilityLabel: "发送给当前 Agent 的消息" }).props.value,
    ).toBe("");
    expect(renderer.root.findAllByProps({ accessibilityRole: "alert" })).toHaveLength(0);
  });

  it("shows pending progress and prevents another submission while the message is being accepted", async () => {
    let accept: () => void = () => {};
    host.send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          accept = resolve;
        }),
    );
    await renderPanel();
    await enterMessage("还在发送的问题。");
    await press("发送消息");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const pending = renderer.root.findByProps({
      accessibilityLabel: "正在发送消息",
      accessibilityRole: "button",
    });
    expect(pending.props.disabled).toBe(true);
    expect(
      renderer.root.findByProps({ accessibilityLabel: "发送给当前 Agent 的消息" }).props.editable,
    ).toBe(false);
    await act(async () => pending.props.onPress());
    expect(host.send).toHaveBeenCalledTimes(1);
    await act(async () => accept());
  });

  it("does not submit whitespace and retains an offline draft until the host reconnects", async () => {
    await renderPanel();
    await enterMessage(" \n ");
    await press("发送消息");
    expect(host.send).not.toHaveBeenCalled();

    await act(async () => {
      host.status = "offline";
      for (const listener of host.statusListeners) listener();
    });
    await enterMessage("离线时写好的问题。");
    await press("发送消息");
    expect(host.send).not.toHaveBeenCalled();
    expect(
      renderer.root.findByProps({ accessibilityLabel: "发送给当前 Agent 的消息" }).props.value,
    ).toBe("离线时写好的问题。");

    await act(async () => {
      host.status = "online";
      for (const listener of host.statusListeners) listener();
    });
    await press("发送消息");
    expect(host.send).toHaveBeenCalledExactlyOnceWith("host", "agent", "离线时写好的问题。");
  });
});
