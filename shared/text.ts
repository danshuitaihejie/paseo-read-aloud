export interface SpeechSegment {
  id: string;
  text: string;
}

export interface SpeechPlaybackUnit {
  text: string;
  segmentIndex: number;
}

export interface ConversationSpeechUnit extends SpeechPlaybackUnit {
  responseId: string;
  responseIndex: number;
}

export interface SpeechToken {
  text: string;
  start: number;
  end: number;
  isWord: boolean;
  weight: number;
}

export interface SpeechHighlightStep {
  tokenIndex: number;
  atMs: number;
}

const MAX_SEGMENT_CHARACTERS = 220;
export const MAX_SPEECH_CHUNK_CHARACTERS = 260;

export function cleanTimelineText(text: string): string {
  return text.replace(/^(?:\s*---\s*)+/u, "").trim();
}

/**
 * Converts assistant Markdown into a stable, human-readable narration script.
 * This intentionally removes presentation noise without summarizing or rewriting meaning.
 */
export function prepareTextForSpeech(text: string): string {
  const withoutBlocks = cleanTimelineText(text.replace(/\r\n?/g, "\n"))
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<(?:script|style|pre|code)\b[^>]*>[\s\S]*?<\/(?:script|style|pre|code)>/gi, "\n")
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, "\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt: string) => {
      const label = alt.trim();
      return label && !isGenericAttachmentLabel(label) ? `图片说明：${label}` : " ";
    })
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "和")
    .replace(/&lt;/gi, "小于")
    .replace(/&gt;/gi, "大于")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[←↔→]/g, "到")
    .replace(/[↑]/g, "上升")
    .replace(/[↓]/g, "下降");

  const spokenLines: string[] = [];
  for (const originalLine of withoutBlocks.split("\n")) {
    let line = originalLine.trim();
    if (!line || isMarkdownSeparator(line) || isMarkdownTableSeparator(line)) continue;

    const isHeading = /^#{1,6}\s+/u.test(line);
    const isListItem = /^\s*(?:[-+*•]|\d+[.)])\s+/u.test(line);

    line = line
      .replace(/^\s{0,3}#{1,6}\s+/u, "")
      .replace(/^\s*>+\s?/u, "")
      .replace(/^\s*(?:[-+*•]|\d+[.)])\s+/u, "")
      .replace(/^\s*\[[ xX]\]\s*/u, "")
      .replace(/[|]/g, "，")
      .replace(/_+/g, " ")
      .replace(/[*~]+/g, "")
      .replace(/[•●○◆◇■□▪▫◦※★☆✓✔✕✖]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*([，。！？；：,.!?;:])\s*/g, "$1")
      .replace(/[，,]{2,}/g, "，")
      .replace(/[。]{2,}/g, "。")
      .replace(/[！!]{2,}/g, "！")
      .replace(/[？?]{2,}/g, "？")
      .replace(/^\s*[，。；：,.!?;:]+\s*/u, "")
      .replace(/[，,]+$/u, "")
      .trim();

    if (!hasMeaningfulText(line)) continue;
    if ((isHeading || isListItem || originalLine.includes("|")) && !/[。！？；.!?;：:]$/u.test(line)) {
      line += "。";
    }
    spokenLines.push(line);
  }

  return spokenLines.join("\n").replace(/\n{2,}/g, "\n").trim();
}

export function splitIntoSpeechSegments(text: string): SpeechSegment[] {
  const normalized = cleanTimelineText(text.replace(/\r\n?/g, "\n"));
  if (!normalized) return [];

  const raw = normalized
    .split(/(?<=[。！？；;])|(?<=[.!?])\s+|\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const part of raw) {
    if (part.length <= MAX_SEGMENT_CHARACTERS) {
      segments.push(part);
      continue;
    }
    segments.push(...splitLongText(part, MAX_SEGMENT_CHARACTERS));
  }

  return segments.map((segment, index) => ({ id: `sentence-${index}`, text: segment }));
}

export function buildSpeechChunks(
  segments: readonly SpeechSegment[],
  startIndex: number,
  maxCharacters = MAX_SPEECH_CHUNK_CHARACTERS,
): string[] {
  const source = segments.slice(Math.max(0, startIndex));
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = "";
  };

  for (const segment of source) {
    const parts =
      segment.text.length > maxCharacters
        ? splitLongText(segment.text, maxCharacters)
        : [segment.text];
    for (const part of parts) {
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length <= maxCharacters) {
        current = candidate;
      } else {
        flush();
        current = part;
      }
    }
  }
  flush();
  return chunks;
}

export function buildSegmentSpeechUnits(
  segments: readonly SpeechSegment[],
  startIndex: number,
  maxCharacters = MAX_SPEECH_CHUNK_CHARACTERS,
): SpeechPlaybackUnit[] {
  const units: SpeechPlaybackUnit[] = [];
  const firstIndex = Math.max(0, startIndex);
  for (let segmentIndex = firstIndex; segmentIndex < segments.length; segmentIndex += 1) {
    for (const chunkText of buildSpeechChunks([segments[segmentIndex]], 0, maxCharacters)) {
      units.push({ text: chunkText, segmentIndex });
    }
  }
  return units;
}

export function buildConversationSpeechUnits(
  responses: readonly { id: string; segments: readonly SpeechSegment[] }[],
  startResponseIndex: number,
  startSegmentIndex: number,
): ConversationSpeechUnit[] {
  const units: ConversationSpeechUnit[] = [];
  const firstResponseIndex = Math.max(0, startResponseIndex);
  for (
    let responseIndex = firstResponseIndex;
    responseIndex < responses.length;
    responseIndex += 1
  ) {
    const response = responses[responseIndex];
    const firstSegment = responseIndex === firstResponseIndex ? startSegmentIndex : 0;
    for (const unit of buildSegmentSpeechUnits(response.segments, firstSegment)) {
      units.push({ ...unit, responseId: response.id, responseIndex });
    }
  }
  return units;
}

export function normalizeTextForSpeech(text: string): string {
  return prepareTextForSpeech(text);
}

export function tokenizeSpeechText(text: string): SpeechToken[] {
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        locale: string,
        options: { granularity: "word" },
      ) => {
        segment(value: string): Iterable<{
          segment: string;
          index: number;
          isWordLike?: boolean;
        }>;
      };
    }
  ).Segmenter;

  if (Segmenter) {
    const parts = new Segmenter("zh-CN", { granularity: "word" }).segment(text);
    return Array.from(parts, (part) => ({
      text: part.segment,
      start: part.index,
      end: part.index + part.segment.length,
      isWord: part.isWordLike ?? hasMeaningfulText(part.segment),
      weight: tokenWeight(part.segment, part.isWordLike ?? hasMeaningfulText(part.segment)),
    }));
  }

  return fallbackTokenize(text);
}

export function buildSpeechHighlightSteps(text: string, durationMs: number): SpeechHighlightStep[] {
  const tokens = tokenizeSpeechText(text);
  const totalWeight = tokens.reduce((sum, token) => sum + token.weight, 0);
  if (totalWeight <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return [];

  const steps: SpeechHighlightStep[] = [];
  let elapsedWeight = 0;
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token.isWord) {
      steps.push({
        tokenIndex,
        atMs: Math.round((elapsedWeight / totalWeight) * durationMs),
      });
    }
    elapsedWeight += token.weight;
  }
  return steps;
}

export function estimateSpeechDurationMs(text: string): number {
  const weight = tokenizeSpeechText(text).reduce((sum, token) => sum + token.weight, 0);
  return Math.max(500, Math.round(weight * 215));
}

function fallbackTokenize(text: string): SpeechToken[] {
  const tokens: SpeechToken[] = [];
  let cursor = 0;
  let buffer = "";
  let bufferStart = 0;
  let bufferKind: "word" | "number" | "separator" | null = null;

  const flush = () => {
    if (!buffer || !bufferKind) return;
    const isWord = bufferKind !== "separator";
    tokens.push({
      text: buffer,
      start: bufferStart,
      end: bufferStart + buffer.length,
      isWord,
      weight: tokenWeight(buffer, isWord),
    });
    buffer = "";
    bufferKind = null;
  };

  for (const character of text) {
    const kind = /\p{Script=Han}/u.test(character)
      ? "han"
      : /\p{L}|\p{M}/u.test(character)
        ? "word"
        : /\p{N}/u.test(character)
          ? "number"
          : "separator";
    if (kind === "han") {
      flush();
      tokens.push({
        text: character,
        start: cursor,
        end: cursor + character.length,
        isWord: true,
        weight: tokenWeight(character, true),
      });
    } else {
      if (bufferKind !== kind) {
        flush();
        bufferStart = cursor;
        bufferKind = kind;
      }
      buffer += character;
    }
    cursor += character.length;
  }
  flush();
  return tokens;
}

function tokenWeight(text: string, isWord: boolean): number {
  if (!isWord) {
    if (/[。！？.!?]/u.test(text)) return 0.9;
    if (/[，、；：,;:]/u.test(text)) return 0.45;
    return Math.max(0.08, text.length * 0.04);
  }
  const hanCount = Array.from(text.matchAll(/\p{Script=Han}/gu)).length;
  const otherCount = Array.from(text.matchAll(/[\p{L}\p{N}]/gu)).length - hanCount;
  return Math.max(0.7, hanCount + otherCount * 0.38);
}

function hasMeaningfulText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function isGenericAttachmentLabel(label: string): boolean {
  return /^(?:image|img|图片|截图|附件)(?:\s*#?\d+)?$/iu.test(label);
}

function isMarkdownSeparator(line: string): boolean {
  return /^(?:[-*_]\s*){3,}$/u.test(line);
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/u.test(line);
}

function splitLongText(text: string, maxCharacters: number): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxCharacters) {
    let boundary = Math.max(
      remaining.lastIndexOf("，", maxCharacters),
      remaining.lastIndexOf(",", maxCharacters),
      remaining.lastIndexOf(" ", maxCharacters),
    );
    if (boundary < Math.floor(maxCharacters * 0.45)) boundary = maxCharacters;
    else boundary += 1;
    parts.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}
