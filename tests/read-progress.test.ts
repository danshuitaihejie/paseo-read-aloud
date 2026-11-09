import { describe, expect, it } from "vitest";
import {
  cursorAfterSpeechUnit,
  mergeReadProgress,
  resolveSpeechStart,
  type ReadProgressCursor,
} from "../shared/read-progress";
import { buildConversationSpeechUnits, splitIntoSpeechSegments } from "../shared/text";

function response(id: string, timestampMs: number, text: string) {
  return {
    id,
    timestamp: new Date(timestampMs),
    segments: splitIntoSpeechSegments(text),
  };
}

describe("read progress", () => {
  it("resumes at the next audio chunk inside one long visible sentence", () => {
    const responses = [response("first", 1_000, "连续内容".repeat(40))];
    const units = buildConversationSpeechUnits(responses, 0, 0);
    const cursor = cursorAfterSpeechUnit(responses, units[0], 2_000);

    expect(cursor).not.toBeNull();
    const start = resolveSpeechStart(responses, cursor);
    expect(start).not.toBeNull();
    const remaining = buildConversationSpeechUnits(
      responses,
      start?.responseIndex ?? 0,
      start?.segmentIndex ?? 0,
      start?.characterOffset ?? 0,
    );

    expect(remaining.map((unit) => unit.text)).toEqual(units.slice(1).map((unit) => unit.text));
    expect(start?.characterOffset).toBe(units[0].text.length);
  });

  it("continues with a reply that arrived after the previous reply finished", () => {
    const oldResponses = [response("old", 1_000, "已经读完。")];
    const oldUnits = buildConversationSpeechUnits(oldResponses, 0, 0);
    const cursor = cursorAfterSpeechUnit(oldResponses, oldUnits.at(-1)!, 2_000);
    const currentResponses = [...oldResponses, response("new", 3_000, "这是新的回复。")];
    const start = resolveSpeechStart(currentResponses, cursor);

    expect(start).toEqual({ responseIndex: 0, segmentIndex: 0, characterOffset: 5 });
    expect(
      buildConversationSpeechUnits(
        currentResponses,
        start?.responseIndex ?? 0,
        start?.segmentIndex ?? 0,
        start?.characterOffset ?? 0,
      ).map((unit) => unit.text),
    ).toEqual(["这是新的回复。"]);
  });

  it("falls forward to the first newer reply when the saved reply left the timeline window", () => {
    const responses = [
      response("newer", 3_000, "较新的回复。"),
      response("latest", 4_000, "最新回复。"),
    ];
    const cursor: ReadProgressCursor = {
      responseId: "expired",
      responseTimestampMs: 2_000,
      segmentIndex: 0,
      characterOffset: 10,
      updatedAtMs: 2_500,
    };

    expect(resolveSpeechStart(responses, cursor)).toEqual({
      responseIndex: 0,
      segmentIndex: 0,
      characterOffset: 0,
    });
  });

  it("keeps only the 200 most recently updated conversation cursors", () => {
    const agents = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `agent-${index}`,
        {
          responseId: `response-${index}`,
          responseTimestampMs: index,
          segmentIndex: 0,
          characterOffset: 0,
          updatedAtMs: index,
        },
      ]),
    );
    const newest: ReadProgressCursor = {
      responseId: "newest-response",
      responseTimestampMs: 1_000,
      segmentIndex: 0,
      characterOffset: 0,
      updatedAtMs: 1_000,
    };

    const merged = mergeReadProgress(agents, "newest-agent", newest);

    expect(Object.keys(merged)).toHaveLength(200);
    expect(merged["newest-agent"]).toEqual(newest);
    expect(merged["agent-0"]).toBeUndefined();
  });
});
