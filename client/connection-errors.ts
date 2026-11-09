export function isTransientConnectionError(message: string): boolean {
  return /\btimeout(?:error)?\b|\btimed out\b|transport not connected|host is disconnected|connection (?:closed|lost)|daemon connection/i.test(
    message,
  );
}
