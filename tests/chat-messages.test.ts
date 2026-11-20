import { describe, expect, it } from "vitest";
import { mergeMessage } from "../src/lib/chatMessages";
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
});
