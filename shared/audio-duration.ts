const MPEG1_LAYER3_BITRATES = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MPEG2_LAYER3_BITRATES = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000];

export function audioDurationMs(bytes: Uint8Array, mimeType: string): number | undefined {
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes("wav") || isRiffWave(bytes)) return wavDurationMs(bytes);
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3") || isMp3(bytes)) {
    return mp3DurationMs(bytes);
  }
  return undefined;
}

function wavDurationMs(bytes: Uint8Array): number | undefined {
  if (!isRiffWave(bytes)) return undefined;
  let offset = 12;
  let byteRate: number | undefined;
  let dataLength: number | undefined;
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(bytes, offset, 4);
    const chunkLength = uint32le(bytes, offset + 4);
    if (chunkId === "fmt " && chunkLength >= 16 && offset + 24 <= bytes.length) {
      byteRate = uint32le(bytes, offset + 16);
    } else if (chunkId === "data") {
      dataLength = Math.min(chunkLength, Math.max(0, bytes.length - offset - 8));
      break;
    }
    offset += 8 + chunkLength + (chunkLength % 2);
  }
  if (!byteRate || dataLength === undefined) return undefined;
  return Math.round((dataLength / byteRate) * 1_000);
}

function mp3DurationMs(bytes: Uint8Array): number | undefined {
  let offset = id3v2Size(bytes);
  let seconds = 0;
  let frameCount = 0;
  while (offset + 4 <= bytes.length) {
    const frame = readMp3Frame(bytes, offset);
    if (!frame) {
      offset += 1;
      continue;
    }
    if (offset + frame.length > bytes.length) break;
    seconds += frame.samples / frame.sampleRate;
    frameCount += 1;
    offset += frame.length;
  }
  if (frameCount === 0) return undefined;
  return Math.round(seconds * 1_000);
}

function readMp3Frame(bytes: Uint8Array, offset: number) {
  const first = bytes[offset];
  const second = bytes[offset + 1];
  const third = bytes[offset + 2];
  if (first !== 0xff || (second & 0xe0) !== 0xe0) return undefined;

  const versionBits = (second >> 3) & 0x03;
  const layerBits = (second >> 1) & 0x03;
  const bitrateIndex = (third >> 4) & 0x0f;
  const sampleRateIndex = (third >> 2) & 0x03;
  const padding = (third >> 1) & 0x01;
  if (
    versionBits === 1 ||
    layerBits !== 1 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    sampleRateIndex === 3
  ) {
    return undefined;
  }

  const isMpeg1 = versionBits === 3;
  const bitrate = (isMpeg1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex];
  const divisor = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex] / divisor;
  const coefficient = isMpeg1 ? 144 : 72;
  const length = Math.floor((coefficient * bitrate * 1_000) / sampleRate) + padding;
  return {
    length,
    sampleRate,
    samples: isMpeg1 ? 1_152 : 576,
  };
}

function id3v2Size(bytes: Uint8Array): number {
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return 0;
  const flags = bytes[5];
  const size =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);
  return 10 + size + (flags & 0x10 ? 10 : 0);
}

function isMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  return ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}

function isRiffWave(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE";
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length && offset + index < bytes.length; index += 1) {
    value += String.fromCharCode(bytes[offset + index]);
  }
  return value;
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}
