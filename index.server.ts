import type { PluginServerContext } from "@getpaseo/plugin/server";
import { synthesizeSpeech } from "./server/speech";
import { synthesizeSpeechRpc } from "./shared/speech";

export default function contribute(server: PluginServerContext) {
  server.handle(synthesizeSpeechRpc, synthesizeSpeech);
  return () => {};
}
