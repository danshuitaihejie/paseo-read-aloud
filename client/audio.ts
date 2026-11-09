import type { PluginClientContext } from "@getpaseo/plugin/client";
import { prepareWebAudio, stopActiveWebAudio } from "./web";

export interface PreparedAudio {
  play(): Promise<void>;
  dispose(): void;
}

export function stopActiveAudio(client?: PluginClientContext) {
  const stoppedWebAudio = stopActiveWebAudio();
  const stoppableClient = client as (PluginClientContext & { stopAudio?: () => void }) | undefined;
  const canStopHostAudio = typeof stoppableClient?.stopAudio === "function";
  stoppableClient?.stopAudio?.();
  return stoppedWebAudio || canStopHostAudio;
}

export async function prepareAudio(
  client: PluginClientContext,
  source: { base64: string; mimeType: string },
): Promise<PreparedAudio> {
  const webAudio = await prepareWebAudio(source);
  return (
    webAudio ?? {
      play: () => client.playAudio(source),
      dispose() {},
    }
  );
}
