export type CatalogDiscoveryItem = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  price?: number | string | null;
  currency?: string | null;
  stock?: number | string | null;
  is_active?: boolean | null;
};

type Product = {
  name: string;
  description: string;
  category: string;
  price: number;
  currency: string;
  stock: number;
};

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (value: string) => fold(value).replace(/\be[- ]books?\b/g, "ebook").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";
const greeting = /^(?:ola|oi|bom dia|boa tarde|boa noite|boas|hello)\b\s*/;
const browse = /\b(?:catalogo|(?:que|quais) (?:sao )?(?:os |as )?(?:tipos de |opcoes de )?(?:produtos|artigos|opcoes)|o ?que (?:e que )?(?:(?:voces|voce|a loja) )?(?:tem|tens|vendem|vendes|vende|ha|existe)|(?:ver|mostra|mostre|manda|envia|lista|listar|conhecer) (?:os |as )?(?:produtos|artigos|opcoes|novidades)|(?:tem|tens|ha) (?:algum(?:a|as|s)?|opcoes|novidades))\b|^(?:produtos|artigos|opcoes|novidades)$/;
const recommendation = /\b(?:recomenda(?:s|m|r|ria|rias|coes)?|recomende|sugere(?:s|m)?|sugerir|sugira|sugestoes|indica(?:s|m|r|ria)?|indique|aconselha(?:s|m|r|ria)?|aconselhe|(?:qual|a) melhor opcao|o melhor para|(?:estou a |ando a )?procura de|procur[oa]|quero (?:algo|uma?|umas?|uns|alguma coisa)|algo para|alguma coisa para)\b/;
const comparison = /\b(?:compara(?:r|cao)?|compare|diferencas?|lado a lado)\b/;
const cheap = /\b(?:mais barat[oa]s?|barat[oa]s?|baratinh[oa]s?|mais em conta|em conta|preco baixo|economic[oa]s?)\b/;
const popularity = /\b(?:mais vendid[oa]s?|mais populares?|mais procurad[oa]s?|best sellers?)\b/;
const buyingQuestion = /\b(?:tem|tens|ha|vende(?:s|m)?|mostra|mostre|quais|qual)\b/;
const transaction = /\b(?:ja paguei|paguei|transferi|comprovativos?|reembolsos?|devolucoes?|rastrear pedido)\b/;
const browsingFiller = /\b(?:a venda|para vender$|quanto (?:custa(?:m)?|fica(?:m)?|sa[ie]m?|e|sao))\b/g;
const comparisonAsk = "Qual deles queres ver com mais detalhe?";
const productAsk = (products: readonly Product[]) => products.length === 1
  ? `Envia «${products[0].name}» para ver os detalhes.`
  : "Diz-me qual te interessa para vermos os detalhes.";
const genericTerms = new Set((
  "a as o os e em de da das do dos um uns uma umas aonde ao aos por para sobre entre eu me " +
  "que oque qual quais isso isto esse essa estes essas este esta estao sao voces voce loja tem tens ha com no na nas nos " +
  "mostrar mostra mostre mandar manda envia enviar ver quero queria gostaria conhecer favor qualquer algum " +
  "alguma alguns algumas algo coisa assim outro outra melhor bons boas bom boa aprender comecar preciso saber " +
  "recomenda recomendam recomendas recomendaria recomendar recomende recomendarias recomendacao recomendacoes sugere sugeres sugerem " +
  "sugerir sugira sugestao sugestoes indica indicas indicam indicar indicaria indique aconselha aconselhas aconselham aconselhar aconselharia aconselhe " +
  "compara compare comparar comparacao diferenca diferencas " +
  "produto produtos artigo artigos disponiveis disponivel opcao opcoes tipo tipos catalogo lista listar " +
  "vendido vendidos vendida vendidas vendem vendes vende procurar procuro procura estou ando procura procurado " +
  "novidade novidades preco precos barato baratos barata baratas baratinho baratinhos baratinha baratinhas " +
  "economic economico economica economicas economicos conta serve funciona mais menos muito baixo altas altos " +
  "populares popular best seller sellers ate maximo custa custam valor valores stock estoque ola oi ai aqui hoje agora existe"
).split(/\s+/));

function terms(value: string) {
  return [...new Set(words(value).split(" ").filter((term) => term.length >= 3 && !genericTerms.has(term))
    .map((term) => term.replace(/ais$/, "al").replace(/eis$/, "el").replace(/is$/, "il").replace(/([aeiou])s$/, "$1")))];
}

function availableProducts(catalog: readonly CatalogDiscoveryItem[]): Product[] {
  const seen = new Set<string>();
  return catalog.flatMap((item) => {
    const name = clean(item.name);
    const price = Number(item.price);
    const stock = Number(item.stock);
    if (item.is_active === false || !name || item.price == null || String(item.price).trim() === "" ||
        !Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock <= 0) return [];
    if (item.id && seen.has(item.id)) return [];
    if (item.id) seen.add(item.id);
    return [{ name, price, stock, currency: clean(item.currency) || "MT",
      category: clean(item.category), description: clean(item.description) }];
  });
}

function renderSuggestions(products: readonly Product[], heading: string, ask: string) {
  const rows = products.slice(0, 5).map((product) => {
    const summary = `• ${product.name} · ${product.price.toLocaleString("pt-MZ")} ${product.currency} · ${product.stock} em stock`;
    const detail = product.description.slice(0, 180);
    return detail ? `${summary}\n  ${detail}${product.description.length > detail.length ? "…" : ""}` : summary;
  });
  return [heading, ...rows, ask].filter(Boolean).join("\n");
}

export function presentCatalogSuggestions(products: readonly CatalogDiscoveryItem[], options?: { heading?: string; ask?: string }) {
  const available = availableProducts(products);
  return available.length ? renderSuggestions(available, options?.heading ?? "Opções do catálogo", options?.ask ?? productAsk(available))
    : "Não encontrei produtos em stock nesta seleção.";
}

const currencies: Record<string, string> = {
  mt: "MZN", mzn: "MZN", metical: "MZN", meticais: "MZN", eur: "EUR", euro: "EUR", euros: "EUR",
  usd: "USD", "us$": "USD", dolar: "USD", dolares: "USD", zar: "ZAR", rand: "ZAR", rands: "ZAR",
  brl: "BRL", "r$": "BRL", real: "BRL", reais: "BRL"
};
const currencyCode = (currency: string) => currencies[fold(currency)] ?? currency.toUpperCase();
const budgetPattern = /\b(ate|no maximo(?: de)?|menos de|abaixo de|por volta de|tenho(?: apenas| so)?)\s+(?:(mzn|mt|eur|usd|zar|brl|us\$|r\$)\s*)?(\d{1,3}(?:[ .]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(mzn|mt|metical|meticais|eur|euros?|usd|dolar|dolares|zar|rands?|brl|real|reais))?(?![.,]\d|[\p{L}\p{N}])/u;

function readBudget(message: string) {
  const match = budgetPattern.exec(message);
  if (!match) return null;
  const amount = Number(match[3].replace(/[ .](?=\d{3}(?:\D|$))/g, "").replace(",", "."));
  const currency = match[2] || match[4];
  if (!Number.isFinite(amount) || (match[1].startsWith("tenho") && !currency)) return null;
  return { limit: amount, strict: match[1] === "menos de" || match[1] === "abaixo de",
    approximate: match[1] === "por volta de", currency: currency ? currencyCode(currency) : null,
    remainder: message.slice(0, match.index) + " " + message.slice(match.index + match[0].length) };
}

function catalogMatch(product: Product, query: string, keywords: string[], useCase: string[]) {
  const name = words(product.name);
  const category = words(product.category);
  const nameWords = new Set(terms(name));
  const categoryWords = new Set(terms(category));
  const descriptionWords = new Set(terms(product.description));
  if (useCase.length && !useCase.some((keyword) => nameWords.has(keyword) || categoryWords.has(keyword) || descriptionWords.has(keyword))) {
    return 0;
  }
  const literal = (` ${query} `).includes(` ${name} `);
  return (literal ? 50 : 0) + keywords.reduce((score, word) => score + (
    nameWords.has(word) ? 6 : categoryWords.has(word) ? 4 : descriptionWords.has(word) ? 2 : 0
  ), 0);
}

export function discoverCatalog(message: string, catalog: readonly CatalogDiscoveryItem[]): { text: string; askProvider?: true } | null {
  const text = words(message).replace(greeting, "");
  if (!text || transaction.test(text)) return null;
  const browsing = browse.test(text);
  const recommending = recommendation.test(text);
  const comparing = comparison.test(text);
  const inexpensive = cheap.test(text);
  const ranking = popularity.test(text);
  const budget = readBudget(fold(message));
  let search = budget ? words(budget.remainder).replace(greeting, "") : text;
  if (browsing) search = search.replace(browsingFiller, " ").trim();
  const keywords = terms(search);
  const topic = /\b(?:para|sobre) (.+?)(?:\b(?:ou|mas)\b|$)/.exec(search)?.[1] ?? "";
  const useCase = terms(topic);
  const narrowShopping = buyingQuestion.test(text) && keywords.length > 0 && catalog.some((item) => {
    const detailTerms = terms(`${clean(item.name)} ${clean(item.category)}`);
    return detailTerms.some((keyword) => keywords.includes(keyword)) ||
      (useCase.length > 0 && terms(clean(item.description)).some((keyword) => useCase.includes(keyword)));
  });
  const categoryOnly = keywords.length > 0 && catalog.some((item) => terms(clean(item.category)).join(" ") === keywords.join(" "));
  if (!browsing && !recommending && !comparing && !inexpensive && !ranking && !budget &&
      catalog.some((item) => {
        const name = words(clean(item.name));
        return name && (` ${text} `).includes(` ${name} `);
      })) return null;
  if (!browsing && !recommending && !comparing && !inexpensive && !ranking && !budget && !narrowShopping && !categoryOnly) return null;

  const available = availableProducts(catalog);
  if (!catalog.length) return { text: "O catálogo ainda não tem produtos publicados." };
  if (!available.length) return { text: "Os produtos do catálogo estão sem stock neste momento." };

  const candidates = available.map((product) => ({ product, score: catalogMatch(product, search, keywords, useCase) }))
    .filter(({ score }) => !keywords.length || score > 0)
    .sort((left, right) => right.score - left.score);
  let selected = candidates.map(({ product }) => product);
  const currenciesInStock = new Set((selected.length ? selected : available).map((product) => currencyCode(product.currency)));
  if (budget && !budget.currency && currenciesInStock.size > 1 && !currenciesInStock.has("MZN")) {
    return { text: "Em que moeda é o teu orçamento?" };
  }
  if (budget) {
    const currency = budget.currency ?? (currenciesInStock.has("MZN") ? "MZN" : [...currenciesInStock][0]);
    selected = selected.filter((product) => currencyCode(product.currency) === currency &&
      (budget.strict ? product.price < budget.limit : product.price <= budget.limit));
  }
  if (!selected.length) {
    if (budget) return { text: "Não encontrei opções em stock dentro desse orçamento. Queres ver outra categoria ou indicar outro valor?" };
    const text = "Não encontrei opções em stock para esse pedido. Tens outro produto ou categoria em mente?";
    return !ranking && !comparing && (useCase.length || recommending) ? { text, askProvider: true } : { text };
  }
  if ((budget || inexpensive) && new Set(selected.map((product) => currencyCode(product.currency))).size === 1) {
    selected.sort((left, right) => budget?.approximate ? right.price - left.price : left.price - right.price);
  }

  const heading = ranking ? "Não tenho dados para ordenar os mais vendidos. Estas opções estão disponíveis."
    : budget ? "Opções dentro do teu orçamento"
      : comparing && selected.length > 1 ? "Opções para comparar"
        : browsing || categoryOnly ? "Produtos disponíveis" : "Opções do catálogo";
  const ask = comparing && selected.length === 1 ? "Que outro produto queres comparar com este?"
    : comparing ? comparisonAsk
      : recommending && !budget && !keywords.length && selected.length > 1 ? "Para que finalidade procuras o produto?"
        : selected.length > 5 ? "Estes são alguns dos produtos. Diz-me o nome ou a categoria para pesquisar mais." : productAsk(selected);
  return { text: renderSuggestions(selected, heading, ask) };
}
