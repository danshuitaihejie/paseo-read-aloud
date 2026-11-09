import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createReadAloudScreen } from "./client/read-aloud-panel";

type AgentTarget = {
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
  internal?: boolean;
  status: "initializing" | "idle" | "running" | "error" | "closed";
};

export default function contribute(client: PluginClientContext) {
  const ReadAloudScreen = createReadAloudScreen(client);
  const pills = new Map<string, { workspaceId: string; remove(): void }>();
  let disposed = false;
  let stopAgentUpdates: (() => void) | undefined;
  let releaseDirectory: (() => Promise<void>) | undefined;

  const removeScreen = client.addScreen({
    id: "read-aloud",
    title: "专属朗读",
    Component: ReadAloudScreen,
  });

  const removeCommand = client.addCommandCenterItem({
    id: "open-read-aloud",
    title: "打开专属朗读",
    icon: "Volume2",
    keywords: ["read", "aloud", "speech", "tts", "朗读", "语音"],
    context: "agent",
    onSelect({ agent, openScreen }) {
      openScreen({ screenId: "read-aloud", params: { agentId: agent.id } });
    },
  });

  function removePill(agentId: string) {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  }

  function syncPill(agent: AgentTarget) {
    const workspaceId = agent.workspaceId;
    if (!workspaceId || agent.archivedAt || agent.internal || agent.status === "closed") {
      removePill(agent.id);
      return;
    }

    const current = pills.get(agent.id);
    if (current?.workspaceId === workspaceId) return;
    current?.remove();

    const registration = client.addComposerPill({
      id: "read-aloud",
      workspaceId,
      agentId: agent.id,
      button: {
        title: "浏览助手回复并从任意句子开始朗读",
        label: "朗读",
        icon: "Volume2",
        behavior: {
          kind: "action",
          onPress() {
            client.openScreen({
              screenId: "read-aloud",
              params: { agentId: agent.id },
            });
          },
        },
      },
    });

    pills.set(agent.id, {
      workspaceId,
      remove: () => registration.remove(),
    });
  }

  void (async () => {
    const listing = await client.paseo.agents.list({ subscribe: {} });
    if (disposed) {
      await listing.subscription.release();
      return;
    }

    releaseDirectory = () => listing.subscription.release();
    for (const entry of listing.entries) syncPill(entry.agent);

    stopAgentUpdates = client.paseo.agents.subscribe((update) => {
      if (update.kind === "upsert") syncPill(update.agent);
      else removePill(update.agentId);
    });
  })().catch((error) => {
    console.error("[paseo-read-aloud] Failed to watch agents", error);
  });

  return () => {
    disposed = true;
    removeCommand();
    removeScreen();
    stopAgentUpdates?.();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
    void releaseDirectory?.().catch((error) => {
      console.error("[paseo-read-aloud] Failed to release agent directory", error);
    });
  };
}
