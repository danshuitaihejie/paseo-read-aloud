import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";
import type { ConversationSpeechUnit, SpeechSegment } from "./text";

export const readProgressCursorSchema = z.object({
  responseId: z.string().min(1),
  responseTimestampMs: z.number().int().nonnegative(),
  segmentIndex: z.number().int().nonnegative(),
  characterOffset: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative(),
});

export type ReadProgressCursor = z.infer<typeof readProgressCursorSchema>;

export const readProgressSettings = defineSettings({
  id: "read-progress",
  scope: "host",
  version: 1,
  schema: z.object({
    agents: z.record(z.string(), readProgressCursorSchema).default({}),
  }),
});

export const readProgressRpc = settingsRpc(readProgressSettings.id);

export interface ProgressResponse {
  id: string;
  timestamp: Date;
  segments: readonly SpeechSegment[];
}

export interface SpeechStart {
  responseIndex: number;
  segmentIndex: number;
  characterOffset: number;
}

const MAX_AGENT_PROGRESS_ENTRIES = 200;

export function resolveSpeechStart(
  responses: readonly ProgressResponse[],
  cursor: ReadProgressCursor | null,
): SpeechStart | null {
  if (responses.length === 0) return null;
  if (!cursor) return { responseIndex: 0, segmentIndex: 0, characterOffset: 0 };

  const exactIndex = responses.findIndex((response) => response.id === cursor.responseId);
  if (exactIndex >= 0) {
    return {
      responseIndex: exactIndex,
      segmentIndex: cursor.segmentIndex,
      characterOffset: cursor.characterOffset,
    };
  }

  const firstNewerIndex = responses.findIndex(
    (response) => response.timestamp.getTime() > cursor.responseTimestampMs,
  );
  if (firstNewerIndex < 0) return null;
  return { responseIndex: firstNewerIndex, segmentIndex: 0, characterOffset: 0 };
}

export function cursorAtSpeechStart(
  responses: readonly ProgressResponse[],
  start: SpeechStart,
  updatedAtMs = Date.now(),
): ReadProgressCursor | null {
  const response = responses[start.responseIndex];
  if (!response) return null;
  return {
    responseId: response.id,
    responseTimestampMs: response.timestamp.getTime(),
    segmentIndex: Math.max(0, start.segmentIndex),
    characterOffset: Math.max(0, start.characterOffset),
    updatedAtMs,
  };
}

export function cursorAfterSpeechUnit(
  responses: readonly ProgressResponse[],
  unit: ConversationSpeechUnit,
  updatedAtMs = Date.now(),
): ReadProgressCursor | null {
  const lastPart = unit.parts.at(-1);
  if (!lastPart) return null;
  const response = responses[lastPart.responseIndex];
  if (!response || response.id !== lastPart.responseId) return null;
  return {
    responseId: lastPart.responseId,
    responseTimestampMs: response.timestamp.getTime(),
    segmentIndex: lastPart.segmentIndex,
    characterOffset: (lastPart.characterOffset ?? 0) + lastPart.text.length,
    updatedAtMs,
  };
}

export function mergeReadProgress(
  agents: Readonly<Record<string, ReadProgressCursor>>,
  agentId: string,
  cursor: ReadProgressCursor,
) {
  const entries = Object.entries({ ...agents, [agentId]: cursor }).sort(
    ([, left], [, right]) => right.updatedAtMs - left.updatedAtMs,
  );
  return Object.fromEntries(entries.slice(0, MAX_AGENT_PROGRESS_ENTRIES));
}
