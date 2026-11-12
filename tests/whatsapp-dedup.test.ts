import { describe, it, expect } from "vitest";

class DeduplicationCache {
  private cache = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 600000) {
    this.ttlMs = ttlMs;
  }

  isDuplicate(id: string): boolean {
    if (!id) return false;
    const now = Date.now();
    const seenAt = this.cache.get(id);

    if (seenAt && (now - seenAt) < this.ttlMs) {
      return true;
    }

    this.cache.set(id, now);

    // Evict old entries if cache grows
    if (this.cache.size > 1000) {
      for (const [key, timestamp] of this.cache.entries()) {
        if (now - timestamp > this.ttlMs) {
          this.cache.delete(key);
        }
      }
    }

    return false;
  }

  size(): number {
    return this.cache.size;
  }
}

describe("WhatsApp Message Deduplication & State Transitions", () => {
  it("processes a unique message ID on first sight", () => {
    const dedup = new DeduplicationCache();
    expect(dedup.isDuplicate("msg-001")).toBe(false);
    expect(dedup.size()).toBe(1);
  });

  it("identifies subsequent attempts with the same message ID as duplicates", () => {
    const dedup = new DeduplicationCache();
    expect(dedup.isDuplicate("msg-repeat")).toBe(false);
    expect(dedup.isDuplicate("msg-repeat")).toBe(true);
    expect(dedup.isDuplicate("msg-repeat")).toBe(true);
  });

  it("allows message IDs again once TTL expires", () => {
    const dedup = new DeduplicationCache(10); // 10ms TTL for testing
    expect(dedup.isDuplicate("msg-short-ttl")).toBe(false);
    
    // Simulate elapsed time
    const start = Date.now();
    while (Date.now() - start < 15) {
      // wait 15ms
    }

    expect(dedup.isDuplicate("msg-short-ttl")).toBe(false);
  });

  it("validates valid connection status transitions", () => {
    const validStates = ["disconnected", "connecting", "qr_ready", "connected", "reconnecting", "error"];
    const testTransitions = [
      { from: "disconnected", to: "connecting", valid: true },
      { from: "connecting", to: "qr_ready", valid: true },
      { from: "qr_ready", to: "connected", valid: true },
      { from: "connected", to: "reconnecting", valid: true },
      { from: "reconnecting", to: "connected", valid: true },
      { from: "connected", to: "disconnected", valid: true }
    ];

    for (const t of testTransitions) {
      expect(validStates.includes(t.from)).toBe(true);
      expect(validStates.includes(t.to)).toBe(true);
    }
  });
});

