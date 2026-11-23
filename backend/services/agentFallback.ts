type CatalogItem = {
  name?: string | null;
  price?: number | string | null;
  currency?: string | null;
  stock?: number | string | null;
};

const words = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const needsReview = /\b(?:comprar|encomendar|pedidos?|pagar|paguei|pagamentos?|comprovativos?|recibos?|transferi|transferencias?|referencia|reembolsos?|devolucoes?|entregas?|faturas?|descontos?|m\s*pesa|e\s*mola)\b/;
const productQuestion = /\b(?:precos?|valores?|cust[ao]|custam|stock|disponiveis?|disponivel|disponibilidade|catalogo|produtos?|artigos?)\b/;
const catalogQuestion = /\b(?:catalogo|quais produtos|que produtos|que artigos|quais artigos|o que tem|ver produtos)\b/;

export function agentFallbackReply(message: string, catalog: CatalogItem[] | null, context: string[] = []): string | null {
  const text = words(message);
  if (needsReview.test(text)) return null;
  if (/^(?:ola|oi|bom dia|boa tarde|boa noite|boas|hello)(?: tudo bem)?$/.test(text)) {
    return "Olá! Diz-me qual é o produto que procuras ou pede para ver o catálogo.";
  }
  if ((!productQuestion.test(text) && !catalogQuestion.test(text)) || catalog === null) return null;

  const products = catalog.filter((item) => typeof item.name === "string" && words(item.name) &&
    item.price != null && String(item.price).trim() && Number.isFinite(Number(item.price)) && Number(item.price) >= 0 &&
    item.stock != null && String(item.stock).trim() && Number.isInteger(Number(item.stock)) && Number(item.stock) >= 0)
    .map((item) => ({ name: item.name!, price: Number(item.price), currency: item.currency || "MT", stock: Number(item.stock) }));
  if (catalog.length && !products.length) return null;

  const matches = (input: string) => products.filter((item) => ` ${words(input)} `.includes(` ${words(item.name)} `));
  let selected = matches(text);
  if (!selected.length && /^(?:preco|valor|quanto custa|ainda (?:tem|esta disponivel)|tem stock)$/.test(text)) {
    const lastProductMessage = context.slice(-4).reverse().find((turn) => turn.startsWith("User:") && matches(turn).length === 1);
    if (lastProductMessage) selected = matches(lastProductMessage);
  }
  if (!selected.length && catalogQuestion.test(text)) selected = products.filter((item) => item.stock > 0);
  if (!selected.length) {
    if (!products.length) return "O catálogo ainda não tem produtos publicados.";
    return catalogQuestion.test(text) ? "Os produtos do catálogo estão sem stock neste momento."
      : "Diz-me o nome do produto para consultar o preço e o stock.";
  }

  const rows = selected.slice(0, 5).map(({ name, price, currency, stock }) =>
    `• ${name} · ${price.toLocaleString("pt-MZ")} ${currency} · ${stock > 0 ? `${stock} em stock` : "Esgotado"}`);
  return [catalogQuestion.test(text) ? "Produtos disponíveis" : "Preço e stock no catálogo", ...rows,
    ...(selected.length > rows.length ? ["Diz-me o nome do produto para pesquisar no restante catálogo."] : [])].join("\n");
}
