import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  mergeReadProgress,
  type ReadProgressCursor,
  readProgressRpc,
  readProgressSettings,
} from "../shared/read-progress";

const WRITE_ATTEMPTS = 3;

export async function loadReadProgress(client: PluginClientContext, agentId: string) {
  const result = await client.rpc(readProgressRpc.read, {});
  if (result.status === "invalid") throw new Error(result.error);
  const values = readProgressSettings.schema.parse(result.values);
  return values.agents[agentId] ?? null;
}

export async function saveReadProgress(
  client: PluginClientContext,
  agentId: string,
  cursor: ReadProgressCursor,
) {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const current = await client.rpc(readProgressRpc.read, {});
    if (current.status === "invalid") throw new Error(current.error);
    const values = readProgressSettings.schema.parse(current.values);
    const result = await client.rpc(readProgressRpc.write, {
      revision: current.revision,
      values: {
        agents: mergeReadProgress(values.agents, agentId, cursor),
      },
    });
    if (result.status === "saved") return;
    if (result.status !== "conflict") throw new Error(result.error);
  }
  throw new Error("朗读位置已被其他客户端更新，请重试");
}
