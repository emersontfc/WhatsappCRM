import { beforeEach, describe, expect, it, vi } from "vitest";
import { humanHandoffRecipient, processHumanHandoffs, requestHumanHandoff } from "../backend/services/humanHandoff.ts";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { rpc } }));

const userId = "91000000-0000-4000-8000-000000000001";
const contactId = "91000000-0000-4000-8000-000000000011";
const handoffId = "91000000-0000-4000-8000-000000000021";
const primary = "258851234567@s.whatsapp.net";
const additional = "258861234567@s.whatsapp.net";
const linked = { id: "258871234567:5@s.whatsapp.net", lid: "82345678901234@lid" };
const fields = { contact_phone: "258841234567", contact_lid: "81234567890123", admin_phone: "85 123 4567", admin_phones: "86 123 4567" };
const claim = { ...fields, id: handoffId, user_id: userId, contact_id: contactId, claim_token: "claim-1" };
const transport = { getSessionStatus: vi.fn(), getMe: vi.fn(), sendMessage: vi.fn() };
const rpcResult = (data: unknown, error: unknown = null) => ({ abortSignal: async () => ({ data, error }) });

beforeEach(() => {
  vi.resetAllMocks();
  transport.getSessionStatus.mockReturnValue("connected");
  transport.getMe.mockReturnValue(linked);
  transport.sendMessage.mockResolvedValue({ key: { id: "whatsapp-receipt" } });
  rpc.mockImplementation((name) => rpcResult(name === "agentx_claim_human_handoffs" ? [claim] : true));
});

describe("verified human handoff recipient", () => {
  it("prefers the principal administrator and skips a customer or linked account number", () => {
    expect(humanHandoffRecipient(fields, linked)).toBe(primary);
    expect(humanHandoffRecipient({ ...fields, admin_phone: "84 123 4567", admin_phones: "258871234567; 86 123 4567" }, linked))
      .toBe(additional);
    expect(humanHandoffRecipient({ ...fields, admin_phone: "87 123 4567" }, linked)).toBe(additional);
  });

  it("uses only the verified self chat as fallback and checks the customer's LID", () => {
    const noAdmins = { ...fields, admin_phone: "1234@g.us", admin_phones: "something.invalid; 84 123 4567" };
    expect(humanHandoffRecipient(noAdmins, linked)).toBe("258871234567@s.whatsapp.net");
    expect(humanHandoffRecipient(noAdmins, { id: "82345678901234:5@lid" })).toBe("82345678901234@lid");
    expect(humanHandoffRecipient({ ...noAdmins, contact_lid: "82345678901234" }, linked)).toBeNull();
    expect(humanHandoffRecipient(noAdmins, { id: "1234567@g.us" })).toBeNull();
  });
});

describe("human handoff queue", () => {
  it("asks the database to pause and queue using the authenticated contact and source identity", async () => {
    rpc.mockReturnValueOnce(rpcResult("queued"));
    await expect(requestHumanHandoff(userId, contactId, " original-message ", "requested")).resolves.toBe("queued");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("agentx_request_human_handoff", {
      p_user: userId, p_contact: contactId, p_source_message_id: "original-message", p_cause: "requested",
    });
    rpc.mockReturnValueOnce(rpcResult(null));
    await expect(requestHumanHandoff(userId, contactId)).rejects.toThrow(/acknowledged/);
  });

  it("only records sent after a private alert is acknowledged by WhatsApp", async () => {
    const when = new Date("2026-11-26T09:00:00Z");
    await processHumanHandoffs(transport, when, { userId, contactId });
    expect(rpc).toHaveBeenNthCalledWith(1, "agentx_claim_human_handoffs", {
      p_now: when.toISOString(), p_user: userId, p_contact: contactId,
    });
    expect(transport.sendMessage).toHaveBeenCalledExactlyOnceWith(userId, primary, expect.stringContaining("Mensagens → Humano"));
    expect(transport.sendMessage.mock.calls[0][2]).not.toContain(fields.contact_phone);
    expect(rpc).toHaveBeenLastCalledWith("agentx_finish_human_handoff", expect.objectContaining({
      p_user: userId, p_handoff: handoffId, p_claim: claim.claim_token, p_outcome: "sent", p_receipt: "whatsapp-receipt",
    }));
  });

  it("leaves an alert retryable while the linked account is disconnected", async () => {
    transport.getSessionStatus.mockReturnValue("connecting");
    await processHumanHandoffs(transport);
    expect(transport.sendMessage).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("agentx_finish_human_handoff",
      expect.objectContaining({ p_outcome: "retry", p_receipt: null }));
  });

  it.each([
    [new Error("WhatsApp session not connected."), "retry"],
    [new Error("timed out after handoff"), "uncertain"],
    [null, "uncertain"],
  ] as const)("distinguishes a definite pre-send disconnect from an unknown outcome", async (fault, expected) => {
    if (fault) transport.sendMessage.mockRejectedValue(fault);
    else transport.sendMessage.mockResolvedValue({ key: {} });
    await processHumanHandoffs(transport);
    expect(rpc).toHaveBeenLastCalledWith("agentx_finish_human_handoff",
      expect.objectContaining({ p_outcome: expected, p_receipt: null }));
  });
});
