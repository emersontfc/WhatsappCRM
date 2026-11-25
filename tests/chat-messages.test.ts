import { afterEach, describe, expect, it, vi } from "vitest";
import { degradedChatReconcileMs, liveChatReconcileMs, makeChatRefresh, mergeMessage } from "../src/lib/chatMessages";
import type { Message } from "../src/types";

function message(id: string, time: number, msgId = id): Message {
  return {
    id, user_id: "account", contact_id: "contact", text: "Mensagem",
    type: "outbound", msg_id: msgId, timestamp: new Date(time).toISOString()
  };
}

describe("chat message synchronization", () => {
  it("deduplicates the HTTP acknowledgement and the Realtime insert", () => {
    const sent = message("saved", 1000);
    const observed = mergeMessage([], sent);
    expect(mergeMessage(observed, { ...sent })).toBe(observed);
  });

  it("replaces an optimistic row only if the WhatsApp ID matches", () => {
    const one = message("temp-1", 2000, "wa-first");
    const two = message("temp-2", 2000, "wa-second");
    const saved = message("saved", 1000, "wa-second");
    expect(mergeMessage([one, two], saved)).toEqual([saved, one]);
  });

  it("keeps delayed messages in chronological order before pending sends", () => {
    const older = message("older", 1000);
    const newer = message("newer", 3000);
    const pending = message("temp-1", 4000);
    const delayed = message("delayed", 2000);
    expect(mergeMessage([older, newer, pending], delayed)).toEqual([older, delayed, newer, pending]);
  });

  it("orders equal timestamps by persisted ID and preserves submillisecond ordering", () => {
    const first = { ...message("b", 1000), timestamp: "1970-01-01T00:00:01.000001Z" };
    const second = { ...message("a", 1000), timestamp: "1970-01-01T00:00:01.000002Z" };
    const third = { ...second, id: "c", msg_id: "c" };
    expect([third, first, second].reduce(mergeMessage, [])).toEqual([first, second, third]);
  });
});

describe("chat reconciliation cadence", () => {
  afterEach(() => vi.useRealTimers());

  it("uses fast fallback only while disconnected and stops while the tab is hidden", async () => {
    vi.useFakeTimers();
    let visible = true;
    const fetch = vi.fn(async (_head: boolean) => {});
    const sync = makeChatRefresh(fetch, () => visible, (error) => { throw error; });
    sync.recover();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls).toEqual([[true]]);
    await vi.advanceTimersByTimeAsync(degradedChatReconcileMs);
    expect(fetch.mock.calls).toEqual([[true], [false]]);

    sync.connection(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.at(-1)).toEqual([true]);
    await vi.advanceTimersByTimeAsync(liveChatReconcileMs - 1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.mock.calls).toEqual([[true], [false], [true], [true]]);

    visible = false;
    sync.suspend();
    sync.connection(false);
    await vi.advanceTimersByTimeAsync(liveChatReconcileMs * 2);
    expect(fetch).toHaveBeenCalledTimes(4);
    visible = true;
    sync.recover();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.at(-1)).toEqual([true]);
    await vi.advanceTimersByTimeAsync(degradedChatReconcileMs);
    expect(fetch.mock.calls.at(-1)).toEqual([false]);
    sync.stop();
  });

  it("coalesces continuous contact events and retains reconciliation requested during a fetch", async () => {
    vi.useFakeTimers();
    let release = () => {};
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const fetch = vi.fn(async (_head: boolean) => {}).mockImplementationOnce(() => blocked);
    const sync = makeChatRefresh(fetch, () => true, (error) => { throw error; });
    sync.received();
    await vi.advanceTimersByTimeAsync(100);
    sync.received();
    await vi.advanceTimersByTimeAsync(100);
    sync.received();
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).toHaveBeenCalledTimes(1);
    sync.recover();
    sync.received();
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch.mock.calls).toEqual([[true], [true]]);
    sync.stop();
  });

  it("reports a failed refresh and retries without concurrent requests", async () => {
    vi.useFakeTimers();
    const failure = new Error("Serviço indisponível");
    const fetch = vi.fn(async (_head: boolean) => {}).mockRejectedValueOnce(failure);
    const report = vi.fn();
    const sync = makeChatRefresh(fetch, () => true, report);
    sync.recover();
    await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(degradedChatReconcileMs);
    expect(fetch.mock.calls).toEqual([[true], [true]]);
    sync.stop();
  });
});
