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

function readMpesaTimestamp(text: string) {
  const stamp = /^\s+aos\s+(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(\d{4}|\d{2})\s+[aà]s\s+(\d{1,2}):([0-5]\d)(?:\s*([AP]M))?(?=\s|[.,;]|$)/iu.exec(text);
  if (!stamp) return {};
  const [, day, month, year, hours, minutes, meridiem] = stamp;
  const hour = Number(hours);
  if (meridiem ? hour < 1 || hour > 12 : hour > 23) return {};
  const hour24 = meridiem ? hour % 12 + (meridiem.toUpperCase() === "PM" ? 12 : 0) : hour;
  return { date: `${day}/${month}/${year.length === 2 ? `20${year}` : year}`,
    time: `${String(hour24).padStart(2, "0")}:${minutes}` };
}

function readOutgoingMpesa(text: string) {
  const confirmation = /(?:^|[\r\n.!?])\s*(?:(?:comprovativo(?:\s+(?:do\s+)?m[ -]?pesa)?|(?:pedido\s+)?AGX-[A-Z0-9-]+)\s*[:–-]?\s+)?confirmado\s+([a-z0-9]{6,20})\.\s*/iu.exec(text);
  if (!confirmation) return null;
  const body = text.slice(confirmation.index + confirmation[0].length);
  // Incoming receipts and other formats have their own amount and reference labels.
  if (!/^(?:transferiste\b|(?:a\s+)?taxa\b|o\s+teu\s+novo\s+saldo\b)/iu.test(body)) return null;
  const reference = confirmation[1].toUpperCase();
  const transfer = /^transferiste\s+(\d[\d., ]{0,23})\s*(?:MT|MZN)\s+(?:e\s+a\s+taxa\s+foi\s+de\s+\d[\d., ]{0,23}\s*(?:MT|MZN)\s+)?para\s+(\+?\d[\d -]{7,24}?)\s*[-–—]\s*([\p{L}][^\r\n;,]{0,99}?)(?=\s+aos\b|\.(?=\s|$)|[\r\n;]|$)/iu.exec(body);
  if (!transfer || !normalizeContactPhone(transfer[2])) return { reference, transfer: null };
  const [, amount, recipientAccount, rawName] = transfer;
  const name = rawName.trim();
  return { reference, transfer: { amount, recipientAccount: recipientAccount.trim(),
    recipientName: namePattern.test(name) ? name : undefined, ...readMpesaTimestamp(body.slice(transfer[0].length)) } };
}

function readOutgoingToAccount(text: string) {
  const transfer = /\btransferiste\s+(\d[\d., ]{0,23})\s*(?:MT|MZN)\s+para\s+(?:a\s+)?conta\s*[:=]?\s*([+\d][\d -]{7,24})(?=[\t ]*(?:[,.;\r\n]|[aà]s\s+\d|$))/iu.exec(text);
  if (!transfer) return null;
  const details = text.slice(transfer.index + transfer[0].length);
  const holder = /^\s*,\s*nome\s*[:=]\s*([^\r\n,;]{2,100}?)(?=\s+[aà]s\s+\d{2}:\d{2}|[.\r\n,;]|$)/iu.exec(details);
  const name = holder?.[1].trim();
  const timestamp = /^\s*[aà]s\s+((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)\s+de\s+((?:0[1-9]|[12]\d|3[01])\/(?:0[1-9]|1[0-2])\/\d{4})\b/iu
    .exec(details.slice(holder?.[0].length ?? 0));
  return { amount: transfer[1], recipientAccount: transfer[2].trim(), recipientName: name && namePattern.test(name) ? name : undefined,
    time: timestamp?.[1], date: timestamp?.[2] };
}

function readRecipient(text: string, outgoing: RecipientEvidence | null): RecipientEvidence {
  const name = text.match(new RegExp(
    `(?:^|[.;,\\n]|\\b)${recipientLabel.source}\\s*[:=–-]\\s*([^\\n;.]{2,100})`, "iu"
  ))?.[1]?.split(/,|\s+(?:(?:conta|nib|iban|telefone|refer[eê]ncia|transa[cç]+[aã]o)\s*[:=])/iu)[0]?.trim();
  const account = text.match(/\b(?:(?:n[uú]mero|telefone|conta)\s+(?:d[eo]\s+)?(?:destino|benefici[aá]rio|destinat[aá]rio)|nib|iban)\s*[:=–-]\s*((?:[A-Z]{2} *)?[+\d][\d -]{4,58})(?![\d*])/iu)?.[1]?.trim()
    ?? text.match(/\bpara\s+(?:o\s+)?(?:n[uú]mero|telefone|conta)\s*[:=]?\s*([+\d][\d -]{7,24})(?![\d*])/iu)?.[1]?.trim();
  const recipientName = outgoing?.recipientName ?? (name && namePattern.test(name) ? name : undefined);
  const recipientAccount = outgoing?.recipientAccount ?? account;
  return { ...(recipientName ? { recipientName } : {}), ...(recipientAccount ? { recipientAccount } : {}) };
}

export function proofRecipient(text: string): RecipientEvidence {
  return readRecipient(text, readOutgoingMpesa(text)?.transfer ?? readOutgoingToAccount(text));
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
  const mpesa = readOutgoingMpesa(clean);
  const outgoing = mpesa?.transfer ?? readOutgoingToAccount(clean);
  // An outgoing confirmation without a readable transfer must not borrow the fee or balance.
  if (mpesa && !outgoing) return null;
  const reference = mpesa?.transfer ? mpesa.reference : clean.match(/\b(?:transa[cç]+[aã]o|txnid|id da transa[cç]+[aã]o|refer[eê]ncia|ref\.?)\s*[:#=-]?\s*([A-Z0-9][A-Z0-9./_-]{3,79})/iu)?.[1]
    ?.replace(/[./_-]+$/, "").toUpperCase() ?? "";
  const markedTransaction = Boolean(outgoing) || /\b(?:recebeu|transferiu|enviou|pagou|confirmad[oa]|liquidad[oa]|creditad[oa]|conclu[ií]d[oa]|efetuad[oa])\b/iu.test(clean);
  const currencyAmount = clean.match(/(?<![\d.,])([0-9][0-9., ]{0,23})\s*(?:MT|MZN)\b/iu)?.[1];
  const amountText = outgoing?.amount ?? currencyAmount
    ?? clean.match(/\b(?:valor|montante|quantia)\s*[:=]\s*([0-9][0-9., ]{0,23})/iu)?.[1];
  const evidence = readRecipient(clean, outgoing);
  if ((!markedTransaction && !(reference && (amountText || evidence.recipientName))) || (!amountText && !reference)) return null;

  const sender = clean.match(/\b(?:de|from)\s+((?:\+?258\s*)?8[2-7]\d{7})\b(?:[ \t]+([\p{L}'’-]+(?:[ \t]+[\p{L}'’-]+){0,5}?))?(?=[.;,\n]|\s+(?:em|no|transa[cç]+[aã]o|ref\.?|para)\s|$)/iu);
  const eMolaTransfer = /^PP\d{6}\.\d{4}\.I\d{5}$/.test(reference) &&
    /^2588[67]\d{7}$/.test(normalizeContactPhone(outgoing?.recipientAccount) ?? "");
  const provider = mpesa?.transfer ? "mpesa"
    : eMolaTransfer || /\b(?:e[ -]?mola|movitel)\b/iu.test(clean) ? "emola"
    : /\b(?:m[ -]?pesa|vodacom)\b/iu.test(clean) ? "mpesa"
    : /\b(?:banco|bim|bci|standard bank|moza|nib|iban)\b/iu.test(clean) ? "bank_transfer"
    : /^EM[A-Z0-9]{6,12}$/.test(reference) || /^8[67]/.test(sender?.[1]?.replace(/^\+?258\s*/, "") ?? "") ? "emola"
    : /\brecebeu\b/iu.test(clean) ? "mpesa" : "other";
  const amount = amountText ? parseLocalAmount(amountText) : 0;
  return {
    provider, transactionReference: reference, amount, currency: outgoing || currencyAmount ? "MT" : "",
    senderPhone: sender?.[1], senderName: sender?.[2]?.trim(), ...evidence,
    ...(outgoing?.date ? { date: outgoing.date, time: outgoing.time } : {}),
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
  const original = proofRecipient(row.proof_raw_text ?? "");
  const recipient = {
    recipientName: original.recipientName ?? saved?.recipientName,
    recipientAccount: original.recipientAccount ?? saved?.recipientAccount
  };
  if (saved?.recipientMatch === "mismatch") return { ...recipient, recipientMatch: "mismatch" };
  const reviewed = compareProofRecipient(recipient, expected);
  return reviewed.recipientMatch === "unknown" && saved?.recipientMatch === "match"
    ? { ...recipient, recipientMatch: "match" } : reviewed;
}
