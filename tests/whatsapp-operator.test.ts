import { beforeEach, describe, expect, it, vi } from "vitest";
import { alertOperator, handleOperatorCommand, isOperatorSelfChat, parseOperatorCommand } from "../backend/services/whatsappOperator.ts";
import { dispatchScheduled, scheduledContactJid } from "../backend/services/scheduledDispatch.ts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), execute: vi.fn(), send: vi.fn(), group: vi.fn(), identity: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }));
vi.mock("../backend/tools/index.ts", () => ({ executeToolByName: mocks.execute }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: { sendMessage: mocks.send, getGroupMetadata: mocks.group, getMe: mocks.identity } }));
const user = "owner";
const jid = "258841234567@s.whatsapp.net";
const transport = { getMe: () => ({ id: "258841234567:2@s.whatsapp.net", lid: "13579@lid" }), sendMessage: mocks.send };

function query(data: unknown, error: unknown = null) {
  const result = { data, error };
  const chain = {
    upsert: vi.fn(() => chain), select: vi.fn((..._columns: unknown[]) => chain),
    eq: vi.fn(() => chain), update: vi.fn(() => chain),
    lte: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(() => chain),
    or: vi.fn(() => chain), abortSignal: vi.fn(() => chain),
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

  it("lists recent orders and limits the query to the linked account", async () => {
    const orders = query([{ order_number: "AGX-SALE1", status: "paid", total_amount: 250, currency: "MT" }]);
    mocks.from.mockReturnValueOnce(query({ message_id: "orders" })).mockReturnValueOnce(orders);
    await handleOperatorCommand(transport, user, jid, true, "/agentx pedidos", "orders");
    expect(mocks.from).toHaveBeenLastCalledWith("orders");
    expect(orders.eq).toHaveBeenCalledWith("user_id", user);
    expect(orders.limit).toHaveBeenCalledWith(5);
    expect(mocks.send).toHaveBeenCalledWith(user, jid, expect.stringContaining("AGX-SALE1 · 250 MT · Pago, entrega pendente"));
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("summarizes only pending owned proof references and directs review to the authenticated panel", async () => {
    const proofs = query([
      { orders: { user_id: user, order_number: "AGX-PEND1", total_amount: "250.00", currency: "MT" } },
      { orders: { user_id: "another-account", order_number: "AGX-FOREIGN", total_amount: 300, currency: "MT" } },
    ]);
    mocks.from.mockReturnValueOnce(query({ message_id: "proofs" })).mockReturnValueOnce(proofs);
    await handleOperatorCommand(transport, user, jid, true, "/agentx comprovativos", "proofs");
    expect(proofs.eq).toHaveBeenCalledWith("user_id", user);
    expect(proofs.eq).toHaveBeenCalledWith("orders.user_id", user);
    expect(proofs.eq).toHaveBeenCalledWith("status", "pending");
    expect(proofs.limit).toHaveBeenCalledWith(5);
    const reply = mocks.send.mock.calls[0]?.[2];
    expect(reply).toContain("AGX-PEND1 · 250 MT");
    expect(reply).toContain("Vendedor → Comprovativos");
    expect(reply).not.toContain("AGX-FOREIGN");
    expect(proofs.select.mock.calls[0]?.[0]).not.toMatch(/proof_raw_text|storage|attachment|media/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("normalizes the specified number and sends the owned contact and reason to the atomic handoff", async () => {
    const destination = "258851234567";
    mocks.rpc.mockResolvedValueOnce({ data: { id: "owned-contact", phone: destination, created: false } })
      .mockReturnValueOnce(query("changed"));
    mocks.from.mockReturnValueOnce(query({ message_id: "pause-message" }));
    await handleOperatorCommand(transport, user, jid, true, "/agentx pausar +258 85 123 4567 | Consulta\nmanual", "pause-message");
    expect(mocks.rpc).toHaveBeenCalledWith("agentx_save_contact", expect.objectContaining({
      p_user_id: user, p_phone: destination, p_existing_only: true
    }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("agentx_set_whatsapp_operator_handoff", {
      p_user: user, p_contact: "owned-contact", p_phone: destination, p_paused: true,
      p_message_id: "pause-message", p_reason: "Consulta manual"
    });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("whatsapp_operator_commands");
    expect(mocks.send).toHaveBeenCalledWith(user, jid, expect.stringContaining("IA pausada para +258851234567"));
  });

  it("clears only the requested pause state and does not repeat the same command", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: "owned-contact", phone: "258851234567" } })
      .mockReturnValueOnce(query("changed"));
    mocks.from.mockReturnValueOnce(query({ message_id: "resume-message" })).mockReturnValueOnce(query(null));
    const resume = () => handleOperatorCommand(transport, user, jid, true, "/agentx retomar 85 123 4567", "resume-message");
    await resume();
    await resume();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenLastCalledWith("agentx_set_whatsapp_operator_handoff", {
      p_user: user, p_contact: "owned-contact", p_phone: "258851234567", p_paused: false,
      p_message_id: "resume-message", p_reason: null
    });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(user, jid, expect.stringContaining("IA retomada para +258851234567"));
  });

  it("reports the existing state without issuing a second change", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: "owned-contact", phone: "258851234567" } })
      .mockReturnValueOnce(query("already"));
    mocks.from.mockReturnValueOnce(query({ message_id: "already-paused" }));
    await handleOperatorCommand(transport, user, jid, true, "/agentx pausar 258851234567", "already-paused");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledWith(user, jid, expect.stringContaining("A IA já estava pausada"));
  });

  it("does not fall back to the operator's number, another account or a group", async () => {
    const missing = query({ message_id: "missing" });
    mocks.from.mockReturnValueOnce(missing).mockReturnValueOnce(query({ message_id: "foreign-phone" }));
    expect(await handleOperatorCommand(transport, user, "123456789@g.us", true,
      "/agentx pausar 258851234567", "group")).toBe(false);
    expect(await handleOperatorCommand(transport, user, "258851234567@s.whatsapp.net", true,
      "/agentx retomar 258851234567", "other-jid")).toBe(false);
    await handleOperatorCommand(transport, user, jid, true, "/agentx pausar", "missing");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith(user, jid, expect.stringContaining("Indica o número do cliente"));

    mocks.rpc.mockResolvedValue({ data: null });
    await handleOperatorCommand(transport, user, jid, true, "/agentx pausar 258851234567", "foreign-phone");
    expect(mocks.rpc).toHaveBeenCalledWith("agentx_save_contact", expect.objectContaining({ p_user_id: user, p_existing_only: true }));
    expect(mocks.from).not.toHaveBeenCalledWith("contacts");
    expect(mocks.from).not.toHaveBeenCalledWith("agent_logs");
    expect(mocks.send).toHaveBeenLastCalledWith(user, jid, expect.stringContaining("Contacto não encontrado na tua conta"));
  });

  it("does not report a successful change when the atomic handoff fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id: "owned-contact", phone: "258851234567" } })
      .mockReturnValueOnce(query(null, { code: "23514" }));
    mocks.from.mockReturnValueOnce(query({ message_id: "audit-error" }));
    await handleOperatorCommand(transport, user, jid, true, "/agentx pausar 258851234567", "audit-error");
    expect(mocks.send).toHaveBeenCalledWith(user, jid, expect.stringContaining("Não foi possível concluir o comando"));
    expect(mocks.send.mock.calls[0]?.[2]).not.toContain("IA pausada");
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
    const finish = query({ id: "id" });
    mocks.from.mockReturnValueOnce(claim).mockReturnValueOnce(query({ phone: "841234567" })).mockReturnValueOnce(finish);
    mocks.send.mockResolvedValue({ key: { id: "sent" } });
    expect((await dispatchScheduled("scheduled_messages", "id", user, "due")).success).toBe(true);
    expect(claim.eq).toHaveBeenCalledWith("status", "pending");
    expect(claim.lte).toHaveBeenCalledWith("scheduled_at", "due");
    expect(mocks.send).toHaveBeenCalledWith(user, jid, "", "/uploads/voice-1-1.ogg", "audio", undefined, undefined, undefined, "contact");
    expect(finish.update).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", error: null, dispatch_receipt_id: "sent" }));
    expect(finish.eq).toHaveBeenCalledWith("dispatch_token", expect.any(String));
  });

  it("dispatches an older schedule that only contains a phone", async () => {
    const finish = query({ id: "legacy" });
    mocks.from.mockReturnValueOnce(query({ phone: "+258 84 123 4567", message: "Olá" })).mockReturnValueOnce(finish);
    mocks.send.mockResolvedValue({ key: { id: "sent" } });
    expect((await dispatchScheduled("scheduled_messages", "legacy", user)).status).toBe("sent");
    expect(mocks.from).not.toHaveBeenCalledWith("contacts");
    expect(mocks.send).toHaveBeenCalledWith(user, jid, "Olá", undefined, undefined, undefined, undefined, undefined, undefined);
  });

  it("rejects a missing or foreign contact without falling back to the stored phone", async () => {
    const contact = query(null);
    mocks.from.mockReturnValueOnce(query({ contact_id: "other-contact", phone: "258841234567", message: "Mensagem" }))
      .mockReturnValueOnce(contact).mockReturnValueOnce(query({ id: "id" }));
    expect((await dispatchScheduled("scheduled_messages", "id", user)).status).toBe("failed");
    expect(contact.eq).toHaveBeenCalledWith("user_id", user);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends a text-only Status once the gateway accepts it", async () => {
    mocks.from.mockReturnValueOnce(query({ caption: "Novidades", media_url: null, media_type: null }))
      .mockReturnValueOnce(query({ id: "text-status" }));
    mocks.send.mockResolvedValue({ key: { id: "status-id" } });
    expect((await dispatchScheduled("scheduled_status", "text-status", user)).status).toBe("sent");
    expect(mocks.send).toHaveBeenCalledWith(user, "status@broadcast", "Novidades", undefined, undefined, undefined, undefined, undefined, undefined);
  });

  it("refuses announcements in admin-only groups unless this linked account is an admin", async () => {
    const item = { target_type: "group", group_jid: "12345@g.us", message: "Aviso" };
    mocks.from.mockReturnValueOnce(query(item)).mockReturnValueOnce(query({ id: "post" }));
    mocks.identity.mockReturnValue({ id: jid });
    mocks.group.mockResolvedValue({ announce: true, participants: [{ id: jid, admin: null }] });
    expect((await dispatchScheduled("scheduled_messages", "post", user)).status).toBe("failed");
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.from.mockReturnValueOnce(query(item)).mockReturnValueOnce(query({ id: "post" }));
    mocks.group.mockResolvedValue({ announce: true, participants: [{ id: jid, admin: "admin" }] });
    mocks.send.mockResolvedValue({ key: { id: "sent" } });
    expect((await dispatchScheduled("scheduled_messages", "post", user)).status).toBe("sent");
    expect(mocks.send).toHaveBeenCalledWith(user, "12345@g.us", "Aviso", undefined, undefined, undefined, undefined, undefined, undefined);
  });

  it("skips an already claimed job and freezes uncertain sends", async () => {
    mocks.from.mockReturnValueOnce(query(null));
    expect((await dispatchScheduled("scheduled_status", "id", user)).success).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    const finish = query({ id: "id" });
    mocks.from.mockReturnValueOnce(query({ caption: "Mensagem" })).mockReturnValueOnce(finish);
    mocks.send.mockResolvedValue({});
    expect((await dispatchScheduled("scheduled_status", "id", user)).status).toBe("failed");
    expect(finish.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("por confirmar") }));
    expect(scheduledContactJid({ phone: "123456789", lid: "123456789" })).toBe("123456789@lid");
  });

  it("retries a known disconnected send without rewriting the scheduled time", async () => {
    const finish = query({ id: "status" });
    mocks.from.mockReturnValueOnce(query({ caption: "Mensagem", attempts: 1 })).mockReturnValueOnce(finish);
    mocks.send.mockRejectedValue(new Error("WhatsApp session not connected."));
    expect((await dispatchScheduled("scheduled_status", "status", user)).status).toBe("pending");
    const [update] = finish.update.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(update.attempts).toBe(2);
    expect(update.retry_at).toEqual(expect.any(String));
    expect(update.scheduled_at).toBeUndefined();
  });

  it("does not send an attachment sourced from an arbitrary URL", async () => {
    const finish = query({ id: "status" });
    mocks.from.mockReturnValueOnce(query({ media_url: "https://external.invalid/image.png", media_type: "image" })).mockReturnValueOnce(finish);
    expect((await dispatchScheduled("scheduled_status", "status", user)).status).toBe("failed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
