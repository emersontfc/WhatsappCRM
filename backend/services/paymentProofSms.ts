import { normalizeContactPhone } from "../../shared/contactPhone.ts";
import type { OrderPayment, RecipientEvidence } from "../../shared/seller.ts";

export interface ExtractedPaymentData extends RecipientEvidence {
  provider: "mpesa" | "emola" | "bank_transfer" | "reference" | "other";
  transactionReference: string;
  amount: number;
  currency: string;
  senderPhone?: string;
  senderName?: string;
  date?: string;
  time?: string;
  confidenceScore: number;
  rawText: string;
}

const namePattern = /^[\p{L}][\p{L}\p{M}\d '&’.-]{1,99}$/u;
const recipientLabel = /(?:nome d[oa]\s+)?(?:benefici[aá]ri[oa]|destinat[aá]ri[oa]|recebedor[a]?|titular d(?:a conta (?:de destino|creditada)|o destino)|titular destinat[aá]ri[oa])/iu;

export function proofRecipient(text: string): RecipientEvidence {
  const name = text.match(new RegExp(
    `(?:^|[.;,\\n]|\\b)${recipientLabel.source}\\s*[:=–-]\\s*([^\\n;.]{2,100})`, "iu"
  ))?.[1]?.split(/,|\s+(?:(?:conta|nib|iban|telefone|refer[eê]ncia|transa[cç]+[aã]o)\s*[:=])/iu)[0]?.trim();
  const account = text.match(/\b(?:(?:n[uú]mero|telefone|conta)\s+(?:d[eo]\s+)?(?:destino|benefici[aá]rio|destinat[aá]rio)|nib|iban)\s*[:=–-]\s*((?:[A-Z]{2} *)?[+\d][\d -]{4,58})(?![\d*])/iu)?.[1]?.trim()
    ?? text.match(/\bpara\s+(?:o\s+)?(?:n[uú]mero|telefone|conta)\s*[:=]?\s*([+\d][\d -]{7,24})(?![\d*])/iu)?.[1]?.trim();
  return { ...(name && namePattern.test(name) ? { recipientName: name } : {}), ...(account ? { recipientAccount: account } : {}) };
}

function parseLocalAmount(value: string) {
  const raw = value.replace(/\s/g, "");
  const decimal = /[.,]\d{1,2}$/.exec(raw);
  const digits = decimal ? raw.slice(0, decimal.index).replace(/[.,]/g, "") + "." + decimal[0].slice(1) : raw.replace(/[.,]/g, "");
  const amount = Number(digits);
  return Number.isFinite(amount) && amount <= 9999999999.99 ? amount : 0;
}

export function parseMozambicanReceiptSMS(text: string): ExtractedPaymentData | null {
  if (typeof text !== "string" || text.trim().length < 10) return null;
  const clean = text.trim();
  const reference = clean.match(/\b(?:transa[cç]+[aã]o|txnid|id da transa[cç]+[aã]o|refer[eê]ncia|ref\.?)\s*[:#=-]?\s*([A-Z0-9][A-Z0-9./_-]{3,79})/iu)?.[1]
    ?.replace(/[./_-]+$/, "").toUpperCase() ?? "";
  const markedTransaction = /\b(?:recebeu|transferiu|enviou|pagou|confirmad[oa]|liquidad[oa]|creditad[oa]|conclu[ií]d[oa]|efetuad[oa])\b/iu.test(clean);
  const amountText = clean.match(/(?<![\d.,])([0-9][0-9., ]{0,23})\s*(?:MT|MZN)\b/iu)?.[1]
    ?? clean.match(/\b(?:valor|montante|quantia)\s*[:=]\s*([0-9][0-9., ]{0,23})/iu)?.[1];
  const evidence = proofRecipient(clean);
  if ((!markedTransaction && !(reference && (amountText || evidence.recipientName))) || (!amountText && !reference)) return null;

  const sender = clean.match(/\b(?:de|from)\s+((?:\+?258\s*)?8[2-7]\d{7})\b(?:[ \t]+([\p{L}'’-]+(?:[ \t]+[\p{L}'’-]+){0,5}?))?(?=[.;,\n]|\s+(?:em|no|transa[cç]+[aã]o|ref\.?|para)\s|$)/iu);
  const provider = /\b(?:e[ -]?mola|movitel)\b/iu.test(clean) ? "emola"
    : /\b(?:m[ -]?pesa|vodacom)\b/iu.test(clean) ? "mpesa"
    : /\b(?:banco|bim|bci|standard bank|moza|nib|iban)\b/iu.test(clean) ? "bank_transfer"
    : /^EM[A-Z0-9]{6,12}$/.test(reference) || /^8[67]/.test(sender?.[1]?.replace(/^\+?258\s*/, "") ?? "") ? "emola"
    : /\brecebeu\b/iu.test(clean) ? "mpesa" : "other";
  const amount = amountText ? parseLocalAmount(amountText) : 0;
  return {
    provider, transactionReference: reference, amount, currency: amountText && /\b(?:MT|MZN)\b/iu.test(clean) ? "MT" : "",
    senderPhone: sender?.[1], senderName: sender?.[2]?.trim(), ...evidence,
    confidenceScore: provider !== "other" && amount > 0 && reference.length >= 6 ? 0.95 : 0.7, rawText: clean
  };
}

const comparableName = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "")
  .toLowerCase().split(/[^\p{L}\d]+/u).filter((word) => word && !["da", "de", "do", "das", "dos", "e"].includes(word));

export function compareProofRecipient(evidence: RecipientEvidence, expected?: OrderPayment | null): RecipientEvidence {
  const result: RecipientEvidence = { recipientName: evidence.recipientName, recipientAccount: evidence.recipientAccount, recipientMatch: "unknown" };
  if (typeof expected?.name !== "string" || typeof expected.recipient !== "string") return result;
  const displayed = comparableName(evidence.recipientName ?? "");
  const stored = comparableName(expected.name);
  const nameMatch = displayed.length > 0 && displayed.join(" ") === stored.join(" ");
  const nameMismatch = displayed.filter((token) => token.length > 1).length >= 2 &&
    stored.filter((token) => token.length > 1).length >= 2 &&
    !displayed.some((token) => token.length > 1 && stored.includes(token));
  const account = expected.method === "bank_transfer"
    ? evidence.recipientAccount?.replace(/[^A-Z0-9]/gi, "").toUpperCase() : normalizeContactPhone(evidence.recipientAccount);
  const expectedAccount = expected.method === "bank_transfer"
    ? expected.recipient.replace(/[^A-Z0-9]/gi, "").toUpperCase() : normalizeContactPhone(expected.recipient);
  const comparableAccounts = !!account && !!expectedAccount && account.length === expectedAccount.length;
  if (nameMismatch || (comparableAccounts && account !== expectedAccount)) result.recipientMatch = "mismatch";
  else if (nameMatch || (comparableAccounts && account === expectedAccount)) result.recipientMatch = "match";
  return result;
}

export function reviewProofRecipient(
  row: { proof_raw_text?: string | null; extracted_data?: RecipientEvidence | null },
  expected?: OrderPayment | null
): RecipientEvidence {
  const saved = row.extracted_data;
  if (saved?.recipientMatch === "match" || saved?.recipientMatch === "mismatch") {
    return { recipientName: saved.recipientName, recipientAccount: saved.recipientAccount, recipientMatch: saved.recipientMatch };
  }
  const original = proofRecipient(row.proof_raw_text ?? "");
  return compareProofRecipient({ recipientName: saved?.recipientName ?? original.recipientName,
    recipientAccount: saved?.recipientAccount ?? original.recipientAccount }, expected);
}
