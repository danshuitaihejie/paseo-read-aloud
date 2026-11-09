import { describe, expect, it } from "vitest";
import { audioDurationMs } from "../shared/audio-duration";

describe("audioDurationMs", () => {
  it("reads PCM WAV duration", () => {
    const bytes = new Uint8Array(44 + 32_000);
    writeAscii(bytes, 0, "RIFF");
    writeUint32le(bytes, 4, bytes.length - 8);
    writeAscii(bytes, 8, "WAVE");
    writeAscii(bytes, 12, "fmt ");
    writeUint32le(bytes, 16, 16);
    writeUint32le(bytes, 28, 32_000);
    writeAscii(bytes, 36, "data");
    writeUint32le(bytes, 40, 32_000);
    expect(audioDurationMs(bytes, "audio/wav")).toBe(1_000);
  });

  it("sums MPEG-1 Layer III frame durations", () => {
    const frameLength = 417;
    const bytes = new Uint8Array(frameLength * 10);
    for (let frame = 0; frame < 10; frame += 1) {
      const offset = frame * frameLength;
      bytes[offset] = 0xff;
      bytes[offset + 1] = 0xfb;
      bytes[offset + 2] = 0x90;
      bytes[offset + 3] = 0;
    }
    expect(audioDurationMs(bytes, "audio/mpeg")).toBe(261);
  });
});

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function writeUint32le(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
  bytes[offset + 3] = (value >> 24) & 0xff;
}
