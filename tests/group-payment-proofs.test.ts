import { describe, expect, it } from "vitest";
import type { GroupMetadata } from "@whiskeysockets/baileys";
import { groupBuyerPhone, groupProofOrderNumber } from "../backend/services/groupPaymentProofs.ts";

const owner = { id: "258841234567:6@s.whatsapp.net" };
const buyer = { id: "123456789012345@lid", phoneNumber: "258851234567@s.whatsapp.net" };
const group = { participants: [{ ...owner, admin: "admin" }, buyer] } as GroupMetadata;
const order = "AGX-ABCD1234EF56";

describe("Group payment proof eligibility", () => {
  it("requires one explicit order reference in the attachment caption or receipt text", () => {
    expect(groupProofOrderNumber(`Comprovativo de ${order.toLowerCase()}`, true)).toBe(order);
    expect(groupProofOrderNumber(`Confirmado 6ABC1234. Pagaste 250,00 MT via M-Pesa. Pedido ${order}`, false)).toBe(order);
    expect(groupProofOrderNumber(`${order}: Confirmado ABZA12CD34. Transferiste 5.00MT e a taxa foi de 0.00MT para 258850000000 - António Exemplo aos 25/11/26 as 8:47 PM.`, false)).toBe(order);
    expect(groupProofOrderNumber(`D da transacao PP261125.2001.i00000. Transferiste 30.00MT para conta 870000000, nome: MARIA EXEMPLO CLIENTE as 20:01:33 de 25/11/2026. Pedido ${order}`, false)).toBe(order);
    expect(groupProofOrderNumber(`Como vai o pedido ${order}?`, false)).toBeNull();
    expect(groupProofOrderNumber(`Comprovativo de ${order} e AGX-ABCD12345678`, true)).toBeNull();
    expect(groupProofOrderNumber("Anexo do pagamento", true)).toBeNull();
  });

  it("resolves a verified LID to the buyer number and fails closed without admin or matching identity", () => {
    expect(groupBuyerPhone(group, { participant: buyer.id }, owner)).toBe("258851234567");
    expect(groupBuyerPhone(group, { participant: buyer.id, fromMe: true }, owner)).toBeNull();
    expect(groupBuyerPhone(group, { participant: "999999999999999@lid" }, owner)).toBeNull();
    expect(groupBuyerPhone(group, { participant: buyer.id, participantAlt: "258861234567@s.whatsapp.net" }, owner)).toBeNull();
    expect(groupBuyerPhone(group, { participant: buyer.id }, buyer)).toBeNull();
    expect(groupBuyerPhone({ ...group, participants: [group.participants[0], { id: buyer.id }] }, { participant: buyer.id }, owner)).toBeNull();
  });
});
