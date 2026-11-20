import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertOperator, handleOperatorCommand, isOperatorSelfChat, parseOperatorCommand } from "../backend/services/whatsappOperator.ts";
import { dispatchScheduled, scheduledContactJid } from "../backend/services/scheduledDispatch.ts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), execute: vi.fn(), send: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("../backend/tools/index.ts", () => ({ executeToolByName: mocks.execute }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: { sendMessage: mocks.send } }));
const user = "owner";
const jid = "258841234567@s.whatsapp.net";
const transport = { getMe: () => ({ id: "258841234567:2@s.whatsapp.net", lid: "13579@lid" }), sendMessage: mocks.send };

function query(data: unknown) {
  const result = { data, error: null };
  const chain = {
    upsert: vi.fn(() => chain), select: vi.fn(() => chain), eq: vi.fn(() => chain), update: vi.fn(() => chain),
    lte: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: <T>(resolve: (value: typeof result) => T) => Promise.resolve(result).then(resolve)
  };
  return chain;
}
beforeEach(() => vi.resetAllMocks());

describe("WhatsApp self-chat commands", () => {
  it("accepts exact linked identities only with fromMe", async () => {
    expect(isOperatorSelfChat("13579@lid", true, transport.getMe())).toBe(true);
    expect(isOperatorSelfChat("0258841234567@s.whatsapp.net", true, transport.getMe())).toBe(false);
    expect(isOperatorSelfChat("258841234567@g.us", true, transport.getMe())).toBe(false);
    expect(await handleOperatorCommand(transport, user, jid, false, "/agentx mensagens", "test-id")).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("loads only inbox data for the account and scopes the related contact", async () => {
    const messages = query([{ text: "Olá", contacts: { name: "Cliente A" } }]);
    mocks.from.mockReturnValueOnce(query({ message_id: "test-id" })).mockReturnValueOnce(messages);
    expect(await handleOperatorCommand(transport, user, jid, true, "/agentx mensagens", "test-id")).toBe(true);
    expect(messages.eq).toHaveBeenCalledWith("user_id", user);
    expect(messages.eq).toHaveBeenCalledWith("contacts.user_id", user);
    expect(messages.eq).toHaveBeenCalledWith("is_read", false);
    expect(mocks.send).toHaveBeenCalledWith(user, jid, expect.stringContaining("Cliente A: Olá"));
  });

  it("hands the exact status text to the existing authorized tool", async () => {
    mocks.from.mockReturnValueOnce(query({ message_id: "test-id" }));
    mocks.execute.mockResolvedValue({ success: true, message: "Publicado." });
    expect(parseOperatorCommand("/agentxstatus")).toBeNull();
    await handleOperatorCommand(transport, user, jid, true, "/agentx status Hoje temos novidades", "test-id");
    expect(mocks.execute).toHaveBeenCalledWith("post_whatsapp_status", { text: "Hoje temos novidades" },
      expect.objectContaining({ role: "admin", userId: user }));
  });

  it("does not repeat side effects for a command already claimed", async () => {
    mocks.from.mockReturnValueOnce(query(null));
    await handleOperatorCommand(transport, user, jid, true, "/agentx status Hoje", "already-seen");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("only sends an alert after a successful server claim", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: false }).mockResolvedValueOnce({ data: true });
    await alertOperator(transport, user, "contact");
    expect(mocks.send).not.toHaveBeenCalled();
    await alertOperator(transport, user, "contact");
    expect(mocks.rpc).toHaveBeenLastCalledWith("agentx_claim_contact_alert", { p_user: user, p_contact: "contact" });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(user, jid, expect.stringContaining("recebeste uma mensagem"));
  });
});

describe("shared scheduled dispatch", () => {
  it("dispatches a single claimed audio message through the same path as manual sends", async () => {
    const claim = query({ contact_id: "contact", media_url: "/uploads/voice-1-1.ogg", media_type: "audio" });
    const finish = query(null);
    mocks.from.mockReturnValueOnce(claim).mockReturnValueOnce(query({ phone: "841234567" })).mockReturnValueOnce(finish);
    mocks.send.mockResolvedValue({ key: { id: "sent" } });
    expect((await dispatchScheduled("scheduled_messages", "id", user, "due")).success).toBe(true);
    expect(claim.eq).toHaveBeenCalledWith("status", "pending");
    expect(claim.lte).toHaveBeenCalledWith("scheduled_at", "due");
    expect(mocks.send).toHaveBeenCalledWith(user, jid, "", "/uploads/voice-1-1.ogg", "audio", undefined, undefined, undefined);
    expect(finish.update).toHaveBeenCalledWith({ status: "sent", error: null });
  });

  it("skips an already claimed job and freezes uncertain sends", async () => {
    mocks.from.mockReturnValueOnce(query(null));
    expect((await dispatchScheduled("scheduled_status", "id", user)).success).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    const finish = query(null);
    mocks.from.mockReturnValueOnce(query({ caption: "Mensagem" })).mockReturnValueOnce(finish);
    mocks.send.mockResolvedValue({});
    expect((await dispatchScheduled("scheduled_status", "id", user)).status).toBe("failed");
    expect(finish.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("por confirmar") }));
    expect(scheduledContactJid({ phone: "123456789", lid: "123456789" })).toBe("123456789@lid");
  });
});
