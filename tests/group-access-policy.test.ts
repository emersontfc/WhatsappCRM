import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WASocket } from "@whiskeysockets/baileys";
import { groupContentRule, groupWarningText, invalidateGroupRules, moderateGroupMessage } from "../backend/services/groupModeration.ts";
import { readModerationPolicy, type ModerationPolicy } from "../backend/services/groupPolicy.ts";
import { processGroupAccessSchedules } from "../backend/services/groupAccessSchedule.ts";

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), metadata: vi.fn(), identity: vi.fn(), updateAccess: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from: mock.from, rpc: mock.rpc } }));
vi.mock("../backend/whatsappManager.ts", () => ({ whatsappManager: {
  getGroupMetadata: mock.metadata, getMe: mock.identity, updateGroupAccess: mock.updateAccess,
} }));

const actor = "1a9dd7af-6ec3-49ed-8965-993a95555b01";
const group = "1203639901@g.us";
const self = { id: "123456789123@lid", phoneNumber: "258841234567@s.whatsapp.net" };
const sender = { id: "765432109876@lid", phoneNumber: "258851234567@s.whatsapp.net", admin: null };

function metadata(jid = group, announce = false, admin = true) {
  return { id: jid, announce, participants: [{ ...self, admin: admin ? "admin" : null }, sender] };
}

const socketMetadata = vi.fn();
const send = vi.fn();
const socket = { user: self, groupMetadata: socketMetadata, sendMessage: send } as unknown as WASocket;
const groupSettings = { active: true, anti_link: false, anti_flood: false, anti_spam: true, welcome_msg: "" };
let configuredRules: typeof groupSettings & Partial<ModerationPolicy> & { blocked_words?: string[]; warning_limit?: number };
const claimModeration = vi.fn();
const update = vi.fn();

function message(id: string, content: string) {
  return moderateGroupMessage(socket, actor, group, { id, participant: sender.id }, content);
}

const rpcResult = (data: unknown) => ({ abortSignal: async () => ({ data, error: null }) });

beforeEach(() => {
  vi.resetAllMocks();
  invalidateGroupRules(actor, group);
  configuredRules = groupSettings;
  socketMetadata.mockResolvedValue(metadata());
  send.mockResolvedValue({ key: { id: "gateway-ack" } });
  mock.identity.mockReturnValue(self);
  mock.metadata.mockResolvedValue(metadata());
  mock.updateAccess.mockResolvedValue(undefined);
  claimModeration.mockReturnValue(rpcResult({ id: 123, action: "delete" }));
  mock.rpc.mockImplementation((method, args) => method === "agentx_claim_group_moderation" ? claimModeration(args) : rpcResult(null));

  mock.from.mockImplementation((table: string) => {
    if (table === "group_rules") {
      const read = { select: () => read, eq: () => read, abortSignal: () => read,
        maybeSingle: async () => ({ data: configuredRules, error: null }) };
      return read;
    }
    const finish = { eq: () => finish, abortSignal: async () => ({ error: null }) };
    return { upsert: () => finish, update: (values: unknown) => { update(table, values); return finish; } };
  });
});

describe("group policy at the WhatsApp boundary", () => {
  it("counts a replayed notify once and claims each moderation action before deleting", async () => {
    const content = "mensagem repetida";
    await message("flood-1", content);
    await message("flood-1", content);
    await message("flood-1", content);
    expect(socketMetadata).not.toHaveBeenCalled();
    await message("flood-2", content);
    await message("flood-3", content);
    expect(claimModeration).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith(group, { delete: { id: "flood-3", participant: sender.id } });
    expect(update).toHaveBeenCalledExactlyOnceWith("agentx_group_events", { outcome: "accepted" });
    expect(claimModeration.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
  });

  it("does not repeat a previously persisted deletion after a restart", async () => {
    configuredRules = { ...groupSettings, anti_link: true };
    claimModeration.mockReturnValue(rpcResult(null));
    await message("already-claimed", "https://blocked.example");
    expect(claimModeration).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it("records the acknowledged warning without deleting or sending above the threshold", async () => {
    configuredRules = { ...groupSettings, blocked_words: ["proibida"], warning_limit: 1 };
    claimModeration.mockReturnValueOnce(rpcResult({ id: 125, action: "warn", warningId: "warn-1", warningNumber: 1, warningLimit: 1 }))
      .mockReturnValueOnce(rpcResult(null));
    await message("word-1", "PALAVRA PROIBIDA");
    await message("word-2", "PALAVRA PROIBIDA");
    expect(mock.rpc).toHaveBeenNthCalledWith(1, "agentx_claim_group_moderation", {
      p_user: actor, p_group: group, p_member: sender.phoneNumber, p_rule: "word", p_message: "word-1",
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(group, {
      text: expect.stringMatching(/Olá @258851234567.*certas palavras.*vai rever/), mentions: [sender.phoneNumber],
    });
    expect(update).toHaveBeenCalledWith("agentx_group_warnings", { status: "sent" });
    expect(update).toHaveBeenCalledWith("agentx_group_events", { outcome: "accepted" });
  });

  it("sends a violation for review without a WhatsApp action", async () => {
    configuredRules = { ...groupSettings, moderation_actions: { document: "review" } };
    claimModeration.mockReturnValue(rpcResult({ id: 126, action: "review" }));
    await expect(moderateGroupMessage(socket, actor, group, { id: "review-1", participant: sender.id }, "", "document")).resolves.toBe(true);
    expect(claimModeration).toHaveBeenCalledWith(expect.objectContaining({ p_rule: "document" }));
    expect(send).not.toHaveBeenCalled();
  });

  it("distinguishes voice notes and music, GIFs and video, and validates custom actions", () => {
    expect(groupContentRule({ audioMessage: { ptt: true } })).toBe("voice");
    expect(groupContentRule({ audioMessage: {} })).toBe("audio");
    expect(groupContentRule({ videoMessage: { gifPlayback: true } })).toBe("gif");
    expect(groupContentRule({ ptvMessage: {} })).toBe("video");
    expect(groupContentRule({ contactsArrayMessage: {} })).toBe("contact");
    const policy = { moderation_actions: { image: "delete", voice: "warn" }, moderation_warning: "Olá {membro}! Evita {motivo} em {grupo}.",
      catalog_sales_enabled: true };
    expect(readModerationPolicy(policy)).toEqual(policy);
    expect(readModerationPolicy({ ...policy, moderation_actions: { image: "ban" } })).toBeNull();
    expect(groupWarningText("voice", sender.phoneNumber, "Clube", { id: 130, action: "warn", template: policy.moderation_warning }))
      .toBe("Olá @258851234567! Evita notas de voz em Clube.");
  });
});

describe("automatic group writing hours", () => {
  function execute() {
    mock.rpc.mockImplementation((method) => rpcResult(method === "agentx_claim_group_hours"
      ? [{ user_id: actor, group_jid: group, claim_token: "lease", announce: true }] : true));
    return processGroupAccessSchedules();
  }

  it("uses the scheduled account and confirms the resulting setting", async () => {
    mock.metadata.mockResolvedValueOnce(metadata()).mockResolvedValueOnce(metadata(group, true));
    await execute();
    expect(mock.updateAccess).toHaveBeenCalledExactlyOnceWith(actor, group, "announce", true);
    expect(mock.rpc).toHaveBeenLastCalledWith("agentx_finish_group_hours", expect.objectContaining({
      p_user: actor, p_group: group, p_claim: "lease", p_outcome: "confirmed",
    }));
  });

  it.each([[true, true, "confirmed"], [false, false, "no_permission"], [false, true, "retry"]] as const)(
    "reconciles announce=%s admin=%s as %s", async (announce, admin, outcome) => {
      mock.metadata.mockResolvedValue(metadata(group, announce, admin));
      await execute();
      expect(mock.rpc).toHaveBeenLastCalledWith("agentx_finish_group_hours", expect.objectContaining({ p_outcome: outcome }));
      expect(mock.updateAccess).toHaveBeenCalledTimes(outcome === "retry" ? 1 : 0);
    },
  );
});
