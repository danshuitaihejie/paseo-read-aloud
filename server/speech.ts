import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { audioDurationMs } from "../shared/audio-duration";
import { estimateSpeechDurationMs, normalizeTextForSpeech } from "../shared/text";

interface OpenAiSpeechConfig {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
}

interface PaseoConfig {
  features?: {
    voiceMode?: {
      tts?: OpenAiSpeechConfig;
    };
  };
}

const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

export async function synthesizeSpeech({
  text,
  voice,
  speed,
}: {
  text: string;
  voice?: string;
  speed?: number;
}) {
  const cleanText = normalizeTextForSpeech(text);
  if (!cleanText) throw new Error("所选内容没有可朗读的文字");

  const config = await resolveSpeechConfig();
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/audio/speech`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      voice: voice ?? config.voice,
      speed: speed ?? 1,
      input: cleanText,
      response_format: "mp3",
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 400);
    throw new Error(`TTS 请求失败（${response.status}）：${detail || response.statusText}`);
  }

  const mimeType = response.headers.get("content-type")?.split(";", 1)[0] || "audio/mpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("TTS 服务返回了空音频");
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("TTS 音频分段过大，请缩短所选内容");

  const durationMs =
    audioDurationMs(bytes, mimeType) ??
    Math.round(estimateSpeechDurationMs(cleanText) / (speed ?? 1));
  return { base64: bytes.toString("base64"), mimeType, durationMs };
}

async function resolveSpeechConfig() {
  const configured = await readPaseoVoiceTts();
  const provider = configured?.provider ?? "openai";
  if (provider !== "openai") {
    throw new Error(
      "当前正式版插件 API 不能直接调用 Paseo 本地 TTS。请在“设置 → 语音”中选择 OpenAI 兼容的 TTS 服务。",
    );
  }

  const apiKey =
    configured?.apiKey ?? process.env.OPENAI_TTS_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl =
    configured?.baseUrl ??
    process.env.OPENAI_TTS_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1";
  const model = configured?.model ?? process.env.TTS_MODEL ?? "tts-1";
  const voice = configured?.voice ?? process.env.TTS_VOICE ?? "alloy";

  if (!apiKey) {
    throw new Error("没有找到 TTS 凭据，请先在 Paseo 的“设置 → 语音”中配置语音输出");
  }
  return { apiKey, baseUrl, model, voice };
}

async function readPaseoVoiceTts(): Promise<OpenAiSpeechConfig | undefined> {
  const paseoHome = process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
  try {
    const parsed = JSON.parse(await readFile(join(paseoHome, "config.json"), "utf8")) as PaseoConfig;
    return parsed.features?.voiceMode?.tts;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("无法读取 Paseo 语音配置");
  }
}
