import { describe, expect, it } from "vitest";
import { isTransientConnectionError } from "../client/connection-errors";

describe("isTransientConnectionError", () => {
  it.each([
    "liveness check timed out",
    "Request timeout",
    "TimeoutError",
    "transport not connected",
    "Paseo host is disconnected: local",
    "connection lost",
    "daemon connection failed",
  ])("recognizes retryable connection errors: %s", (message) => {
    expect(isTransientConnectionError(message)).toBe(true);
  });

  it("does not retry a permanent TTS configuration error", () => {
    expect(isTransientConnectionError("没有找到 TTS 凭据")).toBe(false);
  });
});
