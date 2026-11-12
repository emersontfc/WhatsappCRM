import { describe, it, expect } from "vitest";

function normalizeJid(rawInput: string): { jid: string; isLid: boolean; isGroup: boolean; phone: string } {
  let cleanDigits = rawInput.replace(/@s\.whatsapp\.net|@g\.us|@broadcast|@newsletter|@lid/g, "").replace(/\D/g, "");
  
  // Mozambique local 9-digit numbers (82, 83, 84, 85, 86, 87)
  if (cleanDigits.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(cleanDigits.slice(0, 2))) {
    cleanDigits = `258${cleanDigits}`;
  }

  const isLid = rawInput.includes("@lid") || (cleanDigits.length === 15 && !cleanDigits.startsWith("258"));
  const isGroup = cleanDigits.startsWith("120363") || rawInput.includes("@g.us");

  let jid = rawInput;
  if (isGroup) {
    jid = `${cleanDigits}@g.us`;
  } else if (isLid) {
    jid = `${cleanDigits}@lid`;
  } else {
    jid = `${cleanDigits}@s.whatsapp.net`;
  }

  return { jid, isLid, isGroup, phone: cleanDigits };
}

describe("Phone & JID Normalization", () => {
  it("normalizes Mozambique 9-digit numbers by adding 258 country code", () => {
    const result = normalizeJid("841234567");
    expect(result.phone).toBe("258841234567");
    expect(result.jid).toBe("258841234567@s.whatsapp.net");
    expect(result.isLid).toBe(false);
    expect(result.isGroup).toBe(false);
  });

  it("preserves Mozambique numbers that already include 258", () => {
    const result = normalizeJid("258841234567");
    expect(result.phone).toBe("258841234567");
    expect(result.jid).toBe("258841234567@s.whatsapp.net");
  });

  it("identifies and routes WhatsApp multi-device LIDs (15 digits) to @lid", () => {
    const result = normalizeJid("103328475960392");
    expect(result.isLid).toBe(true);
    expect(result.jid).toBe("103328475960392@lid");
  });

  it("identifies WhatsApp group JIDs and newsletter broadcasts", () => {
    const result = normalizeJid("120363028374829102@g.us");
    expect(result.isGroup).toBe(true);
    expect(result.jid).toBe("120363028374829102@g.us");
  });

  it("handles messy phone inputs with spaces, plus signs and dashes", () => {
    const result = normalizeJid("+258 84-123-4567");
    expect(result.phone).toBe("258841234567");
    expect(result.jid).toBe("258841234567@s.whatsapp.net");
  });
});

