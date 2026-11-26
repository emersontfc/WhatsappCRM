import { describe, expect, it } from "vitest";
import { discoverCatalog, presentCatalogSuggestions } from "../backend/services/catalogDiscovery.ts";

const products = [
  { id: "office", name: "Caderno A5", category: "Papelaria", description: "Tem páginas pautadas para organizar tarefas.", price: 250, currency: "MT", stock: 5 },
  { id: "sales", name: "Manual Prático", category: "Livros digitais", description: "Exemplos para começar a aprender vendas.", price: 95, currency: "MZN", stock: 3 },
  { id: "food", name: "Receitas Rápidas", category: "Livros digitais", description: "Ideias para preparar refeições em casa.", price: 87, currency: "MT", stock: 2 },
  { id: "expensive", name: "Coleção de Formação", category: "Livros digitais", description: "Ensina técnicas de vendas.", price: 1_500, currency: "MT", stock: 1 },
  { id: "usd", name: "Calendário Fotográfico", category: "Papelaria", price: 3, currency: "USD", stock: 4 },
  { id: "sold", name: "Introdução ao desenho", category: "Livros digitais", price: 1, currency: "MT", stock: 0 },
  { id: "hidden", name: "Dicas de Vendas Avançadas", category: "Livros digitais", price: 19, currency: "MT", stock: 1, is_active: false },
];

describe("seller catalogue discovery", () => {
  it.each(["oque voces tem", "O que vocês vendem?", "O que tens aí?", "Mostra os produtos", "Há novidades?", "O que têm para me recomendar?",
    "Boa noite, o que é que vocês têm?", "Quais os produtos disponíveis e quanto custam?", "Quais os produtos que têm à venda?", "O que têm agora?",
    "O que me aconselhas?"])(
    "shows real in-stock products for %s",
    (message) => {
      const result = discoverCatalog(message, products);
      expect(result?.text).toContain("Manual Prático · 95 MZN · 3 em stock");
      expect(result?.text).toContain("Exemplos para começar a aprender vendas.");
      expect(result?.text).not.toContain("Introdução ao desenho");
      expect(result?.text).not.toContain("Dicas de Vendas Avançadas");
      expect(result).not.toHaveProperty("offer");
    }
  );

  it("uses category and an explicitly requested purpose without inferring claims", () => {
    const category = discoverCatalog("Tens livros digitais?", products)?.text;
    expect(category).toContain("Receitas Rápidas");
    expect(category).not.toContain("Caderno A5");
    const useCase = discoverCatalog("Indicas um livro para aprender vendas?", products)?.text;
    expect(useCase).toContain("Manual Prático");
    expect(useCase).toContain("Coleção de Formação");
    expect(useCase).not.toContain("Receitas Rápidas");
  });

  it("uses original currency and excludes options over or exactly at a strict limit", () => {
    const budget = discoverCatalog("Tens algo até 1.250,50 MT?", products)?.text;
    expect(budget).toContain("Manual Prático");
    expect(budget).toContain("Caderno A5");
    expect(budget).not.toContain("Coleção de Formação");
    expect(budget).not.toContain("Calendário Fotográfico");
    const strict = discoverCatalog("Quero algo por menos de 95 meticais", products)?.text;
    expect(strict).toContain("Receitas Rápidas");
    expect(strict).not.toContain("Manual Prático");
    expect(strict).toContain("Envia «Receitas Rápidas»");
    const foreign = discoverCatalog("Tens opções até 5 dólares?", products)?.text;
    expect(foreign).toContain("Calendário Fotográfico");
    expect(foreign).not.toContain("Receitas Rápidas");
  });

  it("compares grounded options without making up sales or recommendation evidence", () => {
    const comparison = discoverCatalog("Qual é a diferença entre o Caderno A5 e o Manual Prático?", products)?.text;
    expect(comparison).toContain("Opções para comparar");
    expect(comparison).toContain("Caderno A5");
    expect(comparison).toContain("Manual Prático");
    expect(comparison).not.toContain("Receitas Rápidas");
    expect(discoverCatalog("Quais são os mais vendidos?", products)?.text).toContain("Não tenho dados");
  });

  it("asks for grounded matches on unsupported purposes and leaves direct product questions or checkout to their handlers", () => {
    expect(discoverCatalog("O que recomendas para tocar guitarra?", products)).toMatchObject({ askProvider: true });
    expect(discoverCatalog("O que recomendas para tocar guitarra por até 250 MT?", products)).not.toHaveProperty("askProvider");
    expect(discoverCatalog("Que vantagem tem o Caderno A5 para organizar tarefas?", products)).toBeNull();
    expect(discoverCatalog("O Caderno A5 serve para organizar tarefas?", products)).toBeNull();
    expect(discoverCatalog("Peço 1", products)).toBeNull();
    expect(discoverCatalog("Já paguei pelo Manual Prático", products)).toBeNull();
    expect(discoverCatalog("Que horas são?", products)).toBeNull();
  });

  it("renders only available real rows and allows a caller to choose the heading and prompt", () => {
    const reply = presentCatalogSuggestions([products[0], products[0], ...products.slice(-2)], {
      heading: "Para a tua secretária", ask: "Queres ver o caderno?"
    });
    expect(reply).toContain("Para a tua secretária");
    expect(reply.match(/Caderno A5/g)).toHaveLength(1);
    expect(reply).toContain("Tem páginas pautadas para organizar tarefas.");
    expect(reply).toContain("Queres ver o caderno?");
    expect(reply).not.toContain("Introdução ao desenho");
    expect(reply).not.toContain("Dicas de Vendas Avançadas");
  });
});
