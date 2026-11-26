import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupMetadata, WAMessageKey } from "@whiskeysockets/baileys";

const { claimWhatsAppAction, from } = vi.hoisted(() => ({ claimWhatsAppAction: vi.fn(), from: vi.fn() }));
vi.mock("../backend/supabaseAdmin.ts", () => ({ supabaseAdmin: { from } }));
vi.mock("../backend/services/whatsappActionClaims.ts", () => ({ claimWhatsAppAction }));

import { groupSalesPhone, groupSalesReply, parseGroupSalesCommand, processGroupSales } from "../backend/services/groupSales.ts";

const jid = "12036300112233@g.us";
const userId = "11b755c8-4b10-4e00-bb7b-114b805dadd9";
const owner = "258840000100@s.whatsapp.net";
const buyer = "258850000100@s.whatsapp.net";
const buyerLid = "98765000012345@lid";
const other = "258860000100@s.whatsapp.net";
const products = [
  { id: "first", name: "Café Torrado", category: "Café", stock: 3, price: "95", currency: "MT",
    description: "Titular e conta 999000001" },
  { id: "second", name: "Chá Verde", category: "Bebidas", stock: 8, price: 80, currency: "MT" },
  { id: "inactive", name: "Artigo oculto", stock: 9, price: 42, currency: "MT", is_active: false },
  { id: "sold", name: "Artigo esgotado", stock: 0, price: 42, currency: "MT" },
];

function group(overrides: Partial<GroupMetadata> = {}): GroupMetadata {
  return { id: jid, owner, subject: "Loja de teste", announce: false,
    participants: [{ id: owner }, { id: buyer, lid: buyerLid }, { id: other }], ...overrides };
}

function input(overrides: Partial<WAMessageKey> = {}) {
  return { userId, jid, timestamp: new Date().toISOString(), text: "/loja", linked: { id: owner },
    key: { id: "live-group-command", remoteJid: jid, participant: buyer, fromMe: false, ...overrides },
    loadGroup: vi.fn(async () => group()), send: vi.fn(async (_reply: string) => ({ key: { id: "outbound-reply" } })) };
}

function query(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const shape = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), order: vi.fn(), abortSignal: vi.fn(),
    maybeSingle: vi.fn(() => result), then: result.then.bind(result) };
  for (const method of [shape.select, shape.eq, shape.gt, shape.order, shape.abortSignal]) method.mockReturnValue(shape);
  return shape;
}

describe("WhatsApp group shop", () => {
  beforeEach(() => {
    from.mockReset();
    claimWhatsAppAction.mockReset();
  });

  it("responds only to a bounded explicit /loja text command", () => {
    expect(parseGroupSalesCommand(" /LOJA ")).toEqual({ query: "" });
    expect(parseGroupSalesCommand("/loja CAFÉ torrado")).toEqual({ query: "CAFÉ torrado" });
    expect(parseGroupSalesCommand("Alguém sabe quanto custa café? /loja")).toBeNull();
    expect(parseGroupSalesCommand("/lojax")).toBeNull();
    expect(parseGroupSalesCommand("/loja\nCAFÉ torrado")).toBeNull();
    expect(parseGroupSalesCommand(`/loja ${"a".repeat(121)}`)).toBeNull();
  });

  it("shows scoped public product fields and takes exact product enquiries to the linked private WhatsApp", () => {
    const catalogue = groupSalesReply("", products, "258840000100");
    expect(catalogue).toContain("Café Torrado · 95 MT · 3 em stock");
    expect(catalogue).toContain("Chá Verde · 80 MT · 8 em stock");
    expect(catalogue).not.toContain("999000001");
    expect(catalogue).not.toContain("Artigo esgotado");
    expect(catalogue).not.toContain("Artigo oculto");
    const requested = decodeURIComponent(groupSalesReply("cafe torrado", products, "258840000100"));
    expect(requested).toContain("https://wa.me/258840000100?text=Olá! Qual é o preço de Café Torrado?");
    expect(requested).not.toContain("Chá Verde");
  });

  it("requires current participants, an unambiguous linked identity and group permission to post", () => {
    expect(groupSalesPhone(group(), jid, input({ participant: buyerLid, participantAlt: buyer }).key, { id: owner }))
      .toBe("258840000100");
    expect(groupSalesPhone(group(), jid, input({ participantAlt: other }).key, { id: owner })).toBeNull();
    expect(groupSalesPhone(group(), jid, input({ participant: "11111111111@lid" }).key, { id: owner })).toBeNull();
    expect(groupSalesPhone(group(), jid, input({ participant: owner }).key, { id: owner })).toBeNull();
    expect(groupSalesPhone(group({ announce: true }), jid, input().key, { id: owner })).toBeNull();
    expect(groupSalesPhone(group({ announce: true, participants: [
      { id: owner, admin: "admin" }, { id: buyer }
    ] }), jid, input().key, { id: owner })).toBe("258840000100");
    expect(groupSalesPhone(group(), jid, input().key, { id: owner, phoneNumber: other })).toBeNull();
  });

  it("checks the tenant and group opt-in, and sends only when the ingress claim is acquired", async () => {
    const settingQuery = query({ catalog_sales_enabled: true });
    const productQuery = query(products);
    from.mockImplementation((table: string) => table === "group_rules" ? settingQuery : productQuery);
    claimWhatsAppAction.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const event = input();

    await expect(processGroupSales(event)).resolves.toBe(true);
    await expect(processGroupSales(event)).resolves.toBe(false);
    expect(settingQuery.eq).toHaveBeenCalledWith("user_id", userId);
    expect(settingQuery.eq).toHaveBeenCalledWith("group_jid", jid);
    expect(productQuery.eq).toHaveBeenCalledWith("user_id", userId);
    expect(productQuery.eq).toHaveBeenCalledWith("is_active", true);
    expect(claimWhatsAppAction).toHaveBeenCalledWith(userId, event.key.id);
    expect(event.send).toHaveBeenCalledTimes(1);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["group_rules", "products", "group_rules", "products"]);
  });

  it("stops before fetching metadata when disabled and ignores historical or self messages", async () => {
    from.mockReturnValue(query({ catalog_sales_enabled: false }));
    const event = input();
    await expect(processGroupSales(event)).resolves.toBe(false);
    await expect(processGroupSales({ ...event, timestamp: new Date(Date.now() - 8 * 60_000).toISOString() })).resolves.toBe(false);
    await expect(processGroupSales(input({ fromMe: true }))).resolves.toBe(false);
    expect(from).toHaveBeenCalledTimes(1);
    expect(event.loadGroup).not.toHaveBeenCalled();
    expect(event.send).not.toHaveBeenCalled();
    expect(claimWhatsAppAction).not.toHaveBeenCalled();
  });
});
