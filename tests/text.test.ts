import { describe, expect, it } from "vitest";
import {
  buildConversationSpeechUnits,
  buildSegmentSpeechUnits,
  buildSpeechHighlightSteps,
  buildSpeechChunks,
  cleanTimelineText,
  normalizeTextForSpeech,
  prepareTextForSpeech,
  splitIntoSpeechSegments,
  tokenizeSpeechText,
} from "../shared/text";

describe("splitIntoSpeechSegments", () => {
  it("creates sentence-level starting points for Chinese and English text", () => {
    const segments = splitIntoSpeechSegments("第一句。第二句！ English one. English two?");
    expect(segments.map((segment) => segment.text)).toEqual([
      "第一句。",
      "第二句！",
      "English one.",
      "English two?",
    ]);
  });

  it("packs speech from the selected sentence without including earlier text", () => {
    const segments = splitIntoSpeechSegments("一。二。三。四。");
    expect(buildSpeechChunks(segments, 2, 20)).toEqual(["三。 四。"]);
  });

  it("keeps playback units associated with the sentence being highlighted", () => {
    const segments = splitIntoSpeechSegments("第一句。第二句。abcdefghij");
    expect(buildSegmentSpeechUnits(segments, 1, 4)).toEqual([
      { text: "第二句。", segmentIndex: 1 },
      { text: "abcd", segmentIndex: 2 },
      { text: "efgh", segmentIndex: 2 },
      { text: "ij", segmentIndex: 2 },
    ]);
  });

  it("packs short sentences across response boundaries", () => {
    const responses = [
      { id: "first", segments: splitIntoSpeechSegments("一。二。") },
      { id: "second", segments: splitIntoSpeechSegments("三。四。") },
    ];
    expect(buildConversationSpeechUnits(responses, 0, 1)).toEqual([
      {
        text: "二。 三。 四。",
        segmentIndex: 1,
        responseId: "first",
        responseIndex: 0,
        parts: [
          { text: "二。", segmentIndex: 1, responseId: "first", responseIndex: 0 },
          { text: "三。", segmentIndex: 0, responseId: "second", responseIndex: 1 },
          { text: "四。", segmentIndex: 1, responseId: "second", responseIndex: 1 },
        ],
      },
    ]);
  });

  it("packs only cleaned speakable text into the request", () => {
    const responses = [
      {
        id: "first",
        segments: splitIntoSpeechSegments(
          prepareTextForSpeech("## 标题\n```ts\nconst ignored = true;\n```"),
        ),
      },
      {
        id: "second",
        segments: splitIntoSpeechSegments(prepareTextForSpeech("✨✨\n第二句。")),
      },
    ];

    expect(buildConversationSpeechUnits(responses, 0, 0).map((unit) => unit.text)).toEqual([
      "标题。 第二句。",
    ]);
  });

  it("keeps every relay audio chunk within 80 characters", () => {
    const segments = Array.from({ length: 10 }, (_, index) => ({
      id: `sentence-${index}`,
      text: String(index).repeat(80),
    }));
    const units = buildConversationSpeechUnits([{ id: "response", segments }], 0, 0);

    expect(units.map((unit) => unit.text.length)).toEqual(Array(10).fill(80));
    expect(units.map((unit) => unit.parts.length)).toEqual(Array(10).fill(1));
    expect(units.flatMap((unit) => unit.parts).map((part) => part.segmentIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("keeps a long sentence visible as one segment while splitting only its audio", () => {
    const segments = splitIntoSpeechSegments("连续内容".repeat(40));
    const units = buildConversationSpeechUnits([{ id: "response", segments }], 0, 0);

    expect(segments).toHaveLength(1);
    expect(units).toHaveLength(2);
    expect(units.every((unit) => unit.text.length <= 80)).toBe(true);
    expect(units.flatMap((unit) => unit.parts).every((part) => part.segmentIndex === 0)).toBe(true);
    expect(units[1].parts[0].characterOffset).toBe(units[0].text.length);
    expect(units[1].parts[0].tokenOffset).toBeGreaterThan(0);
  });

  it("starts a long sentence from an exact character offset", () => {
    const responses = [
      { id: "response", segments: splitIntoSpeechSegments("连续内容".repeat(40)) },
    ];
    const units = buildConversationSpeechUnits(responses, 0, 0);
    const resumed = buildConversationSpeechUnits(responses, 0, 0, units[0].text.length);

    expect(resumed.map((unit) => unit.text)).toEqual(units.slice(1).map((unit) => unit.text));
    expect(resumed[0].parts[0].characterOffset).toBe(units[0].text.length);
  });

  it("keeps decimal numbers together and drops Paseo commentary separators", () => {
    expect(cleanTimelineText("--- 语音耗时 4.6 秒。下一句。")).toBe("语音耗时 4.6 秒。下一句。");
    expect(
      splitIntoSpeechSegments("--- 语音耗时 4.6 秒。下一句。").map(({ text }) => text),
    ).toEqual(["语音耗时 4.6 秒。", "下一句。"]);
  });
});

describe("normalizeTextForSpeech", () => {
  it("removes markdown noise and code while keeping meaningful labels", () => {
    const normalized = normalizeTextForSpeech(
      "## 标题\n访问 [Paseo](https://paseo.sh) 和 `config.json`。\n---\n```ts\nconst secret = 1;\n```",
    );
    expect(normalized).toBe("标题。\n访问 Paseo 和 config.json。");
  });

  it("turns lists and tables into complete spoken lines and drops decorative paragraphs", () => {
    expect(
      prepareTextForSpeech(
        "✨✨\n- 第一项\n- 第二项\n| 名称 | 状态 |\n| --- | --- |\n| Paseo | 可用 |\n![Image #1](test.png)",
      ),
    ).toBe("第一项。\n第二项。\n名称，状态。\nPaseo，可用。");
  });

  it("keeps identifier words separated instead of gluing them together", () => {
    expect(prepareTextForSpeech("安装 `node_modules` 后继续。")).toBe("安装 node modules 后继续。");
  });
});

describe("word highlighting", () => {
  it("segments Chinese words and English words while preserving punctuation", () => {
    const tokens = tokenizeSpeechText("今天使用 Paseo 朗读。 ");
    expect(tokens.map(({ text }) => text).join("")).toBe("今天使用 Paseo 朗读。 ");
    expect(tokens.filter(({ isWord }) => isWord).map(({ text }) => text)).toEqual(
      expect.arrayContaining(["今天", "使用", "Paseo", "朗读"]),
    );
  });

  it("builds a monotonic approximate timeline within the audio duration", () => {
    const steps = buildSpeechHighlightSteps("第一句可以自然朗读。", 2_400);
    expect(steps.length).toBeGreaterThan(2);
    expect(steps[0].atMs).toBe(0);
    expect(steps.every((step, index) => index === 0 || step.atMs >= steps[index - 1].atMs)).toBe(
      true,
    );
    expect(steps.at(-1)?.atMs).toBeLessThan(2_400);
  });
});
