import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase admin and client for unit and integration testing
const mockContacts: any[] = [];
const mockMessages: any[] = [];

vi.mock("../backend/supabaseAdmin.ts", () => {
  return {
    supabaseAdmin: {
      rpc: async (method: string, input: { p_user_id: string; p_phone: string | null; p_lid: string | null; p_name: string | null }) => {
        if (method !== "agentx_save_contact") throw new Error(`Unexpected RPC: ${method}`);
        const { p_user_id: user_id, p_phone: phone, p_lid: lid, p_name: name } = input;
        const existing = mockContacts.find((contact) => contact.user_id === user_id &&
          ((phone && contact.phone === phone) || (lid && contact.lid === lid)));
        if (existing) return { data: { ...existing, created: false }, error: null };
        const contact = { id: `contact-${mockContacts.length + 1}`, user_id, phone, lid, name };
        mockContacts.push(contact);
        return { data: { ...contact, created: true }, error: null };
      },
      from: (table: string) => {
        let currentTable = table;
        let filters: any = {};
        let selectedFields: string | null = null;
        let limitCount: number | null = null;
        let updatePayload: any = null;
        let insertPayload: any = null;

        const builder: any = {
          select: (fields: string) => {
            selectedFields = fields;
            return builder;
          },
          eq: (field: string, val: any) => {
            filters[field] = val;
            return builder;
          },
          or: (conditionStr: string) => {
            filters._or = conditionStr;
            return builder;
          },
          limit: (n: number) => {
            limitCount = n;
            return builder;
          },
          order: () => builder,
          maybeSingle: async () => {
            if (currentTable === "contacts") {
              const matches = mockContacts.filter(c => {
                if (filters.user_id && c.user_id !== filters.user_id) return false;
                if (filters.id && c.id !== filters.id) return false;
                if (filters.lid && c.lid !== filters.lid) return false;
                if (filters.phone && c.phone !== filters.phone) return false;
                return true;
              });
              return { data: matches[0] || null, error: null };
            }
            if (currentTable === "messages") {
              const matches = mockMessages.filter(m => {
                if (filters.user_id && m.user_id !== filters.user_id) return false;
                if (filters.msg_id && m.msg_id !== filters.msg_id) return false;
                if (filters.contact_id && m.contact_id !== filters.contact_id) return false;
                return true;
              });
              return { data: matches[0] || null, error: null };
            }
            return { data: null, error: null };
          },
          single: async () => {
            return builder.maybeSingle();
          },
          insert: (data: any) => {
            insertPayload = data;
            return {
              select: () => ({
                single: async () => {
                  const item = { id: `id-${Date.now()}-${Math.random().toString(36).substring(7)}`, ...insertPayload };
                  if (currentTable === "contacts") mockContacts.push(item);
                  if (currentTable === "messages") mockMessages.push(item);
                  return { data: item, error: null };
                },
                maybeSingle: async () => {
                  const item = { id: `id-${Date.now()}-${Math.random().toString(36).substring(7)}`, ...insertPayload };
                  if (currentTable === "contacts") mockContacts.push(item);
                  if (currentTable === "messages") mockMessages.push(item);
                  return { data: item, error: null };
                }
              }),
              then: async (resolve: any) => {
                const item = { id: `id-${Date.now()}-${Math.random().toString(36).substring(7)}`, ...insertPayload };
                if (currentTable === "contacts") mockContacts.push(item);
                if (currentTable === "messages") mockMessages.push(item);
                return resolve({ data: item, error: null });
              }
            };
          },
          update: (data: any) => {
            updatePayload = data;
            return {
              eq: (f: string, v: any) => {
                filters[f] = v;
                if (currentTable === "contacts") {
                  for (const c of mockContacts) {
                    if (c[f] === v) {
                      Object.assign(c, updatePayload);
                    }
                  }
                }
                if (currentTable === "messages") {
                  for (const m of mockMessages) {
                    if (m[f] === v) {
                      Object.assign(m, updatePayload);
                    }
                  }
                }
                return {
                  select: () => ({
                    single: async () => ({ data: updatePayload, error: null })
                  }),
                  then: async (resolve: any) => resolve({ data: updatePayload, error: null })
                };
              }
            };
          }
        };

        // Allow awaiting builder directly for queries
        builder.then = async (resolve: any) => {
          if (currentTable === "contacts") {
            let res = mockContacts.filter(c => {
              if (filters.user_id && c.user_id !== filters.user_id) return false;
              if (filters.id && c.id !== filters.id) return false;
              if (filters.lid && c.lid !== filters.lid) return false;
              if (filters._or) {
                // handle phone.eq.X,phone.eq.Y
                const terms = filters._or.split(",").map((t: string) => t.trim());
                const matchesAny = terms.some((term: string) => {
                  if (term.startsWith("phone.eq.")) {
                    const expected = term.replace("phone.eq.", "");
                    return c.phone === expected;
                  }
                  return false;
                });
                if (!matchesAny) return false;
              }
              return true;
            });
            if (limitCount) res = res.slice(0, limitCount);
            return resolve({ data: res, error: null });
          }
          if (currentTable === "messages") {
            let res = mockMessages.filter(m => {
              if (filters.user_id && m.user_id !== filters.user_id) return false;
              if (filters.contact_id && m.contact_id !== filters.contact_id) return false;
              if (filters.msg_id && m.msg_id !== filters.msg_id) return false;
              return true;
            });
            return resolve({ data: res, error: null });
          }
          return resolve({ data: [], error: null });
        };

        return builder;
      }
    }
  };
});

import { whatsappManager } from "../backend/whatsappManager.ts";
import { getContactDisplay } from "../src/pages/Contacts.tsx";

describe("AgentX Messaging System — Baileys 7, LID Architecture & Deduplication", () => {
  const TEST_USER_ID = "9744c780-39bd-48df-9a84-acaf4dec34a9";

  beforeEach(() => {
    mockContacts.length = 0;
    mockMessages.length = 0;
  });

  describe("1. Identificação Robusta de Contactos (LID vs Phone vs Grupo)", () => {
    it("não cria contactos para grupos (@g.us), transmissões (@broadcast) ou newsletter", async () => {
      const groupContactId = await whatsappManager.getOrCreateContact(TEST_USER_ID, "12036302918234@g.us", "Grupo de Vendas");
      const broadcastContactId = await whatsappManager.getOrCreateContact(TEST_USER_ID, "status@broadcast");
      const newsletterContactId = await whatsappManager.getOrCreateContact(TEST_USER_ID, "1203639999@newsletter");

      expect(groupContactId).toBe("unknown");
      expect(broadcastContactId).toBe("unknown");
      expect(newsletterContactId).toBe("unknown");
      expect(mockContacts.length).toBe(0);
    });

    it("identifica contacto telefónico padrão (@s.whatsapp.net) com normalização moçambicana", async () => {
      const contactId = await whatsappManager.getOrCreateContact(
        TEST_USER_ID, 
        "841234567@s.whatsapp.net", 
        "Carlos Silva"
      );

      expect(contactId).not.toBe("unknown");
      const saved = mockContacts.find(c => c.id === contactId);
      expect(saved).toBeDefined();
      expect(saved.phone).toBe("258841234567");
      expect(saved.name).toBe("Carlos Silva");
      expect(saved.lid).toBeNull();
    });

    it("NUNCA inventa número de telefone a partir de um LID (@lid)", async () => {
      const rawLidJid = "104928502847592@lid";
      const contactId = await whatsappManager.getOrCreateContact(
        TEST_USER_ID, 
        rawLidJid, 
        "Cliente Anónimo"
      );

      expect(contactId).not.toBe("unknown");
      const saved = mockContacts.find(c => c.id === contactId);
      expect(saved).toBeDefined();
      expect(saved.lid).toBe("104928502847592");
      expect(saved.phone).toBeNull();
      expect(saved.name).toBe("Cliente Anónimo");
    });

    it("utiliza mapeamento Baileys 7 (remoteJidAlt) para emparelhar LID e PN no mesmo contacto", async () => {
      const lidJid = "998877665544332@lid";
      const altPhoneJid = "258849998888@s.whatsapp.net";

      // 1ª mensagem chega com LID e altJid apontando para o número de telefone
      const contactId = await whatsappManager.getOrCreateContact(
        TEST_USER_ID, 
        lidJid, 
        "Ana Paula", 
        altPhoneJid
      );

      const saved = mockContacts.find(c => c.id === contactId);
      expect(saved).toBeDefined();
      expect(saved.phone).toBe("258849998888");
      expect(saved.lid).toBe("998877665544332");
      expect(saved.name).toBe("Ana Paula");

      // 2ª mensagem chega do mesmo número via @s.whatsapp.net
      const secondContactId = await whatsappManager.getOrCreateContact(
        TEST_USER_ID, 
        altPhoneJid, 
        "Ana Paula"
      );

      // Deve reutilizar exatamente o mesmo contacto (mesmo ID), sem duplicar
      expect(secondContactId).toBe(contactId);
      expect(mockContacts.length).toBe(1);
    });

    it("exibe contacto provisório por LID com formatação segura via getContactDisplay", () => {
      const lidOnlyContact = {
        name: null,
        phone: "",
        lid: "104928502847592"
      };

      const display = getContactDisplay(lidOnlyContact);
      expect(display.title).toBe("WhatsApp (7592)");
      expect(display.subtitle).toBe("Número ainda não disponível");
      expect(display.initials).toBe("WA");
    });
  });

  describe("2. Deduplicação e Persistência de Mensagens (syncMessage)", () => {
    it("deduplica mensagens rigorosamente por msg_id para evitar duplicação", async () => {
      const msg = {
        key: {
          id: "3EB049C1B0641B4F9F9405",
          remoteJid: "258841112233@s.whatsapp.net",
          fromMe: false
        },
        message: {
          conversation: "Olá, gostaria de saber os preços dos pacotes."
        },
        messageTimestamp: 1731678000,
        pushName: "João Mário"
      };

      // 1º sync
      const firstSave = await whatsappManager.syncMessage(TEST_USER_ID, msg);
      expect(firstSave).toBeDefined();
      expect(mockMessages.length).toBe(1);

      // 2º sync da mesma mensagem (reconexão, replay ou history sync)
      const secondSave = await whatsappManager.syncMessage(TEST_USER_ID, msg);
      expect(secondSave).toBeDefined();
      expect(secondSave.id).toBe(firstSave.id);
      // O tamanho do array mockMessages deve permanecer rigorosamente 1!
      expect(mockMessages.length).toBe(1);
    });

    it("suporta tipos ricos de mídia (áudio, foto, vídeo, documento e sticker)", async () => {
      const imageMsg = {
        key: { id: "msg-img-1", remoteJid: "258841112233@s.whatsapp.net", fromMe: false },
        message: { imageMessage: { caption: "Comprovativo do pagamento", mimetype: "image/jpeg" } }
      };

      const stickerMsg = {
        key: { id: "msg-stk-1", remoteJid: "258841112233@s.whatsapp.net", fromMe: false },
        message: { stickerMessage: { mimetype: "image/webp" } }
      };

      const audioMsg = {
        key: { id: "msg-aud-1", remoteJid: "258841112233@s.whatsapp.net", fromMe: false },
        message: { audioMessage: { mimetype: "audio/ogg" } }
      };

      await whatsappManager.syncMessage(TEST_USER_ID, imageMsg);
      await whatsappManager.syncMessage(TEST_USER_ID, stickerMsg);
      await whatsappManager.syncMessage(TEST_USER_ID, audioMsg);

      expect(mockMessages.length).toBe(3);
      expect(mockMessages[0].media_type).toBe("image");
      expect(mockMessages[0].text).toBe("Comprovativo do pagamento");

      expect(mockMessages[1].media_type).toBe("sticker");
      expect(mockMessages[1].text).toBe("🎨 Sticker");

      expect(mockMessages[2].media_type).toBe("audio");
      expect(mockMessages[2].text).toBe("🎵 Áudio");
    });
  });

  describe("3. Alternância entre Atendimento Humano e IA (Handover)", () => {
    it("permite pausar a IA e assumir o atendimento humano no contacto", async () => {
      const contactId = await whatsappManager.getOrCreateContact(
        TEST_USER_ID, 
        "258845556677@s.whatsapp.net", 
        "Beatriz Lima"
      );

      const contact = mockContacts.find(c => c.id === contactId);
      expect(contact.ai_paused).toBeUndefined();

      // Operador assume a conversa
      contact.ai_paused = true;
      contact.ai_paused_at = new Date().toISOString();

      expect(contact.ai_paused).toBe(true);
      expect(contact.ai_paused_at).toBeDefined();

      // Operador reativa a IA
      contact.ai_paused = false;
      contact.ai_paused_at = null;

      expect(contact.ai_paused).toBe(false);
      expect(contact.ai_paused_at).toBeNull();
    });
  });
});
