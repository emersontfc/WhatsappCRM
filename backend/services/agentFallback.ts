import type { SellerMethod } from "../../shared/seller.ts";
import { discoverCatalog } from "./catalogDiscovery.ts";

type CatalogItem = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  price?: number | string | null;
  currency?: string | null;
  stock?: number | string | null;
};

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (value: string) => fold(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const productQuestion = /\b(?:precos?|valores?|cust[ao]|custam|quanto (?:e|fica|sai)|stock|estoque|disponiveis?|disponivel|disponibilidade|catalogo|produtos?|artigos?|detalhes|descricao|vantagens?|beneficios?|utilidade|como funciona|serve para|sobre o|sobre a)\b/;
const catalogQuestion = /\b(?:catalogo|(?:quais|que) (?:sao )?(?:os )?(?:produtos|artigos)|o ?que (?:(?:voces|voce|a loja) )?(?:tem|tens|vendem|vende|ha)|(?:ver|mostra|mostre|lista|listar) (?:os )?(?:produtos|artigos))\b/;
const paymentQuestion = /\b(?:pagar|pagamento|pagamentos|mpesa|m pesa|emola|e mola|transferencia bancaria|conta bancaria|nib|iban)\b/;
const afterPayment = /\b(?:ja paguei|paguei|transferi|comprovativos?|recibos?|reembolsos?|devolucoes?)\b/;
const purchase = /\b(?:(?:quero|queria|gostaria de|pretendo|vou) (?:comprar|encomendar|levar)|(?:confirmo|pode registar|pode registrar) (?:a compra|o pedido)|fico com)\b/;
const uncertainPurchase = /\b(?:nao|se|talvez|so queria saber|como|quanto|qual|quais|tem|tens|aceitam|aceita|voces|posso|podem|precos?|valores?)\b/;
const exploratoryPurchase = /\b(?:comprar|encomendar|levar)(?:$| (?:algo|alguma coisa|uma coisa|qualquer coisa|um presente|uma lembranca|um produto|algum produto|para)\b)/;
const humanRequest = /(?:(?:^|\b(?:quero|queria|gostaria de|preciso de|posso|podemos|por favor) )(?:falar|conversar) com|\b(?:transfere|transfiram|encaminha|encaminhe|passa|passe)(?: me)? (?:para|a)) (?:um |uma |a |o )?(?:equipa|equipe|pessoa|atendente|humano|responsavel|administrador|gerente|atendimento humano)\b/;
const stopWords = new Set(["com", "dos", "das", "para", "por", "que", "uma", "uns", "tem", "tens", "mais"]);

export function requestsHumanHandoff(message: string) {
  const text = words(message);
  return !/\b(?:nao|sem) (?:quero |preciso |gostaria de |vou |me )?(?:falar|conversar|passar|atendimento|encaminha|encaminhe|passa|passe)\b/.test(text) &&
    (humanRequest.test(text) || /^(?:quero |preciso de )?(?:um )?(?:atendimento humano|atendente humano)(?: por favor)?$/.test(text));
}

export function isExplicitPurchase(message: string) {
  const text = words(message);
  return !message.includes("?") && purchase.test(text) && !uncertainPurchase.test(text) &&
    !exploratoryPurchase.test(text) && !afterPayment.test(text);
}

export function requestedCatalogQuantity(message: string): number | null {
  const text = fold(message).replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();
  const match = /^(?:peco|quero|manda|envia|fico com|vou levar) ([1-9]\d{0,2})(?: unidades?)?(?: (?:por|via) (?:m[- ]?pesa|e[- ]?mola|transferencia bancaria|banco))?(?:,? por favor)?[.!]?$/.exec(text);
  return match ? Number(match[1]) : null;
}

/** Recognize a complete, explicit purchase using the exact published product name. */
export function catalogOrderFromMessage(message: string, catalog: CatalogItem[]) {
  const match = /^(?:eu )?(?:quero|queria|gostaria de|pretendo|vou) (?:comprar|encomendar|levar) ([1-9]\d{0,2}) (?:unidades? de )?(.+?)(?: (?:por|via) (?:mpesa|m pesa|emola|e mola|transferencia bancaria|banco))?$/.exec(words(message));
  if (!match) return null;
  const products = catalog.filter((item) => item.id && item.name && words(item.name) === match[2]);
  return products.length === 1 ? { productName: products[0].id!, quantity: Number(match[1]) } : null;
}

const paymentMethods: [SellerMethod, RegExp][] = [
  ["mpesa", /\b(?:mpesa|m pesa)\b/],
  ["emola", /\b(?:emola|e mola)\b/],
  ["bank_transfer", /\b(?:banco|bancari[ao]|nib|iban)\b/]
];

export function requestedPaymentMethods(message: string, purchase = false) {
  const text = words(message);
  const paymentText = purchase ? text.match(/\b(?:por|via) (?:m ?pesa|e ?mola|transferencia bancaria|banco)\b.*/)?.[0] ?? "" : text;
  return paymentMethods.filter(([, pattern]) => pattern.test(paymentText)).map(([method]) => method);
}

export function isPaymentQuestion(message: string, context: string[] = []) {
  const text = words(message);
  if (afterPayment.test(text) || isExplicitPurchase(message)) return false;
  if (paymentQuestion.test(text)) return true;
  const shortFollowUp = /^(?:e )?(?:qual(?: e)? |manda |envia |podes (?:mandar|enviar) )?(?:o |a )?(?:numero|conta)(?: por favor)?$/;
  return shortFollowUp.test(text) && context.slice(-2).some((turn) => paymentQuestion.test(words(turn)));
}

export function asksAboutAcceptedMethods(message: string) {
  return /\b(?:aceitam|aceita|formas de pagamento|metodos de pagamento|meios de pagamento|opcoes de pagamento)\b/.test(words(message));
}

export function containsPaymentInstructions(reply: string) {
  return /\b(?:conta|nib|iban|titular)\s*(?::|n[.º°]\s*)\s*[A-Z0-9 -]*\d/i.test(reply) ||
    (paymentQuestion.test(words(reply)) && /(?:\d[\s().+-]*){8}|https?:\/\//i.test(reply));
}

export function suggestsHumanHandoff(reply: string) {
  return /\b(?:encaminh\w*|transfer\w*|pass\w*|envi\w*|notific\w*) (?:a conversa |o atendimento |o pedido |o caso |o teu caso |te |voce |para |a |ao |um |uma ){0,4}(?:equipa|equipe|atendente|humano|pessoa|administrador|atendimento humano)\b/.test(words(reply));
}

export type CatalogOffer = { productId: string; unitPrice: number; currency: string };
type CatalogReply = { text: string; offer?: CatalogOffer; askProvider?: true };

export function readCatalogReply(message: string, catalog: CatalogItem[] | null, context: string[] = []): CatalogReply | null {
  const text = words(message);
  if (afterPayment.test(text) || isExplicitPurchase(message)) return null;
  if (catalog === null) {
    return /^(?:ola|oi|bom dia|boa tarde|boa noite|boas|hello)(?: tudo bem)?$/.test(text)
      ? { text: "Olá! Diz-me qual é o produto que procuras ou pede para ver o catálogo." } : null;
  }
  const discovery = discoverCatalog(message, catalog);
  if (discovery) return discovery;

  const products = catalog.filter((item) => typeof item.name === "string" && words(item.name) &&
    item.price != null && String(item.price).trim() && Number.isFinite(Number(item.price)) && Number(item.price) >= 0 &&
    item.stock != null && String(item.stock).trim() && Number.isInteger(Number(item.stock)) && Number(item.stock) >= 0)
    .map((item) => ({
      id: item.id, name: item.name!, price: Number(item.price), currency: item.currency || "MT", stock: Number(item.stock),
      description: String(item.description ?? "").trim().slice(0, 180)
    }));
  if (catalog.length && !products.length) return null;

  const matches = (input: string) => {
    const normalized = words(input);
    const exact = products.filter((item) => (" " + normalized + " ").includes(" " + words(item.name) + " "));
    if (exact.length) return exact;
    const terms = new Set(normalized.split(" ").filter((term) => term.length >= 3 && !stopWords.has(term)));
    return products.filter((item) => words(item.name).split(" ")
      .some((term) => term.length >= 3 && !stopWords.has(term) && terms.has(term)));
  };
  const viewingCatalog = catalogQuestion.test(text);
  let selected = viewingCatalog ? products.filter((item) => item.stock > 0) : matches(text);
  if (!viewingCatalog && !productQuestion.test(text) && !(selected.length && (/\b(?:tem|tens|ha|vendem|vende|mostra|mostre)\b/.test(text) ||
      selected.some((item) => words(item.name) === text)))) return null;
  if (!selected.length && /^(?:preco|valor|quanto custa|ainda (?:tem|esta disponivel)|tem stock)$/.test(text)) {
    const lastProductMessage = context.slice(-4).reverse().find((turn) => turn.startsWith("User:") && matches(turn).length === 1);
    if (lastProductMessage) selected = matches(lastProductMessage);
  }
  if (!selected.length) {
    if (!products.length) return { text: "O catálogo ainda não tem produtos publicados." };
    return { text: viewingCatalog ? "Os produtos do catálogo estão sem stock neste momento."
      : "Diz-me o nome do produto para consultar o preço e o stock." };
  }

  const rows = selected.slice(0, 5).map(({ name, price, currency, stock, description }) => {
    const summary = "• " + name + " · " + price.toLocaleString("pt-MZ") + " " + currency + " · " +
      (stock > 0 ? stock + " em stock" : "Esgotado");
    return !viewingCatalog && selected.length === 1 && description ? summary + "\n" + description : summary;
  });
  const item = !viewingCatalog && selected.length === 1 ? selected[0] : null;
  const offer = item?.id && item.stock > 0 && item.price > 0 && /^[A-Z]{2,3}$/.test(item.currency)
    ? { productId: item.id, unitPrice: item.price, currency: item.currency } : undefined;
  const next = viewingCatalog && selected.length > rows.length ? "Estes são alguns dos produtos. Envia um nome para pesquisar no resto do catálogo."
    : viewingCatalog || selected.length > 1 ? "Envia o nome do produto para ver mais detalhes."
    : offer ? "Para encomendar uma unidade, podes responder «peço 1»." : null;
  return { text: [viewingCatalog ? "Produtos disponíveis" : "Preço e stock no catálogo", ...rows, next].filter(Boolean).join("\n"), offer };
}

export function agentFallbackReply(message: string, catalog: CatalogItem[] | null, context: string[] = []): string | null {
  return readCatalogReply(message, catalog, context)?.text ?? null;
}
