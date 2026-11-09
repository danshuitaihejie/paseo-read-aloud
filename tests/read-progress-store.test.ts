import type { PluginClientContext } from "@getpaseo/plugin/client";
import { describe, expect, it, vi } from "vitest";
import { loadReadProgress, saveReadProgress } from "../client/read-progress-store";
import { readProgressRpc, type ReadProgressCursor } from "../shared/read-progress";

const cursor: ReadProgressCursor = {
  responseId: "response",
  responseTimestampMs: 1_000,
  segmentIndex: 2,
  characterOffset: 40,
  updatedAtMs: 2_000,
};

describe("read progress store", () => {
  it("loads one conversation cursor from host-scoped plugin settings", async () => {
    const rpc = vi.fn().mockResolvedValue({
      status: "ready",
      revision: "revision-1",
      values: { agents: { agent: cursor } },
    });
    const client = { rpc } as unknown as PluginClientContext;

    await expect(loadReadProgress(client, "agent")).resolves.toEqual(cursor);
    expect(rpc).toHaveBeenCalledWith(readProgressRpc.read, {});
  });

  it("retries a revision conflict without losing another conversation cursor", async () => {
    const otherCursor = { ...cursor, responseId: "other-response", updatedAtMs: 3_000 };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ status: "ready", revision: "revision-1", values: { agents: {} } })
      .mockResolvedValueOnce({ status: "conflict", error: "settings changed" })
      .mockResolvedValueOnce({
        status: "ready",
        revision: "revision-2",
        values: { agents: { other: otherCursor } },
      })
      .mockResolvedValueOnce({
        status: "saved",
        revision: "revision-3",
        values: { agents: { agent: cursor, other: otherCursor } },
      });
    const client = { rpc } as unknown as PluginClientContext;

    await saveReadProgress(client, "agent", cursor);

    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc.mock.calls[3]).toEqual([
      readProgressRpc.write,
      {
        revision: "revision-2",
        values: { agents: { other: otherCursor, agent: cursor } },
      },
    ]);
  });
});
