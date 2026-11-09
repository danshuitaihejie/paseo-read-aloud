import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const synthesizeSpeechRpc = defineRpc({
  name: "read-aloud.synthesize",
  input: z.object({
    text: z.string().trim().min(1).max(1_200),
    voice: z.string().trim().min(1).max(120).optional(),
    speed: z.number().min(0.5).max(2).optional(),
  }),
  output: z.object({
    base64: z.string().min(1),
    mimeType: z.string().min(1),
    durationMs: z.number().int().positive(),
  }),
});
