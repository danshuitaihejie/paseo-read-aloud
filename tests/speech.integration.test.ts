import { expect, it } from "vitest";
import { synthesizeSpeech } from "../server/speech";

const realTts = process.env.PASEO_READ_ALOUD_REAL_TTS === "1" ? it : it.skip;

realTts(
  "synthesizes every offered female voice through the configured Paseo TTS endpoint",
  async () => {
    for (const voice of [
      "female-shaonv",
      "female-yujie",
      "female-chengshu",
      "female-tianmei",
    ]) {
      const audio = await synthesizeSpeech({
        text: "这是女声和语速测试。",
        voice,
        speed: 1.2,
      });
      expect(audio.mimeType).toMatch(/^audio\//);
      expect(Buffer.from(audio.base64, "base64").byteLength).toBeGreaterThan(1_000);
      expect(audio.durationMs).toBeGreaterThan(500);
    }
  },
  120_000,
);

realTts(
  "returns a clear error for an unsupported voice",
  async () => {
    await expect(
      synthesizeSpeech({
        text: "错误路径测试。",
        voice: "paseo-read-aloud-invalid-voice",
      }),
    ).rejects.toThrow(/TTS 请求失败/);
  },
  120_000,
);
