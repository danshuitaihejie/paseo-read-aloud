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

  it("continues from the selected sentence through every later response", () => {
    const responses = [
      { id: "first", segments: splitIntoSpeechSegments("一。二。") },
      { id: "second", segments: splitIntoSpeechSegments("三。四。") },
    ];
    expect(buildConversationSpeechUnits(responses, 0, 1)).toEqual([
      {
        text: "二。",
        segmentIndex: 1,
        responseId: "first",
        responseIndex: 0,
        parts: [
          { text: "二。", segmentIndex: 1, responseId: "first", responseIndex: 0 },
        ],
      },
      {
        text: "三。 四。",
        segmentIndex: 0,
        responseId: "second",
        responseIndex: 1,
        parts: [
          { text: "三。", segmentIndex: 0, responseId: "second", responseIndex: 1 },
          { text: "四。", segmentIndex: 1, responseId: "second", responseIndex: 1 },
        ],
      },
    ]);
  });

  it("keeps the first chunk short and groups later sentences into larger chunks", () => {
    const segments = Array.from({ length: 10 }, (_, index) => ({
      id: `sentence-${index}`,
      text: String(index).repeat(100),
    }));
    const units = buildConversationSpeechUnits([{ id: "response", segments }], 0, 0);

    expect(units.map((unit) => unit.text.length)).toEqual([201, 706, 100]);
    expect(units.map((unit) => unit.parts.length)).toEqual([2, 7, 1]);
    expect(units.flatMap((unit) => unit.parts).map((part) => part.segmentIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("keeps decimal numbers together and drops Paseo commentary separators", () => {
    expect(cleanTimelineText("--- 语音耗时 4.6 秒。下一句。")).toBe(
      "语音耗时 4.6 秒。下一句。",
    );
    expect(
      splitIntoSpeechSegments("--- 语音耗时 4.6 秒。下一句。").map(
        ({ text }) => text,
      ),
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
    expect(prepareTextForSpeech("安装 `node_modules` 后继续。")).toBe(
      "安装 node modules 后继续。",
    );
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
