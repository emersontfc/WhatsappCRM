import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Layout from "../src/components/Layout";

vi.mock("../src/supabase", () => ({ supabase: {} }));

describe("authenticated navigation shell", () => {
  it("shows navigation and the current identity before profile and subscription effects run", () => {
    const user = { id: "account-b", email: "cliente@example.invalid", user_metadata: { full_name: "Cliente actual" } };
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ["/dashboard"] },
      createElement(Layout, { user, children: createElement("p", null, "Conteúdo do painel") })));

    expect(html).toContain("Conteúdo do painel");
    expect(html).toContain('href="/messages"');
    expect(html).toContain("Cliente actual");
    expect(html).toContain("cliente@example.invalid");
    expect(html).not.toContain('href="/admin/packs"');
    expect(html).not.toContain('href="/groups"');
  });
});
