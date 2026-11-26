import { describe, expect, it } from "vitest";
import type { GroupMetadata } from "@whiskeysockets/baileys";
import { groupRemovalDecision, groupViolation, isGroupAdmin, readGroupRulePatch } from "../backend/services/groupModeration.ts";

const active = { active: true, anti_link: true, anti_spam: true, anti_flood: true, welcome_msg: "" };
const metadata = {
  participants: [
    { id: "100@lid", phoneNumber: "258841111111@s.whatsapp.net", admin: "admin" },
    { id: "200@lid", phoneNumber: "258842222222@s.whatsapp.net", admin: null },
    { id: "300@lid", admin: "superadmin" }
  ]
} as GroupMetadata;

describe("WhatsApp group moderation", () => {
  it("accepts only configuration fields and ignores identity overrides", () => {
    expect(readGroupRulePatch({ anti_link: true, user_id: "another", group_jid: "another" })).toEqual({ anti_link: true });
    expect(readGroupRulePatch({ anti_link: "true" })).toBeNull();
    expect(readGroupRulePatch({ welcome_msg: "x".repeat(801) })).toBeNull();
  });
  it("detects only configured violations within the sliding window", () => {
    expect(groupViolation(active, [{ at: 40000, text: "Veja https://example.com" }], 40000)).toBe("link");
    const repetitions = [{ at: 0, text: "oi" }, { at: 12000, text: "oi" }, { at: 22000, text: "oi" }];
    expect(groupViolation(active, repetitions, 22000)).toBe("spam");
    expect(groupViolation(active, repetitions, 35000)).toBeNull();
    expect(groupViolation(active, Array.from({ length: 6 }, (_, idx) => ({ at: 7000 + idx, text: String(idx) })), 8000)).toBe("flood");
  });
  it("matches complete blocked phrases and permits only real allowed hosts", () => {
    const rules = { ...active, allowed_link_hosts: ["example.com"], blocked_words: ["venda falsa", "golpe"] };
    const detect = (text: string) => groupViolation(rules, [{ at: 1, text }], 1);
    expect(detect("Veja (https://Oferta.EXAMPLE.COM/catálogo), por favor")).toBeNull();
    expect(detect("Veja https://example.com.outro.net")).toBe("link");
    expect(detect("https://outro.net@example.com https://example.com/path")).toBe("link");
    expect(detect("https://example.com/path,https://outro.net")).toBe("link");
    expect(detect("pé da VENDA—FALSA!")).toBe("word");
    expect(detect("está agolpemente escrito")).toBeNull();
  });
  it("requires a known non-admin sender and a linked group administrator", () => {
    expect(groupRemovalDecision(metadata, ["200@lid"], ["258841111111:2@s.whatsapp.net"])).toBe("remove");
    expect(groupRemovalDecision(metadata, ["300@lid"], ["100@lid"])).toBe("exempt");
    expect(groupRemovalDecision(metadata, ["200@lid"], ["200@lid"])).toBe("no_permission");
    expect(groupRemovalDecision(metadata, ["999@lid"], ["100@lid"])).toBe("unverified_sender");
  });
  it("does not grant administration for an unknown gateway role", () => {
    expect(isGroupAdmin({ id: "100@lid", admin: "member" } as unknown as GroupMetadata["participants"][number])).toBe(false);
  });
});
