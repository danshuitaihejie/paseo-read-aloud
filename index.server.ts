import type { PluginServerContext } from "@getpaseo/plugin/server";
import { synthesizeSpeech } from "./server/speech";
import { readProgressSettings } from "./shared/read-progress";
import { synthesizeSpeechRpc } from "./shared/speech";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(readProgressSettings);
  server.handle(synthesizeSpeechRpc, synthesizeSpeech);
  return () => {};
}
