import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { GroupControls, type GroupPermissions } from "../src/components/GroupControls";

function render(permissions: GroupPermissions, announce = false) {
  const group = { id: "12036312345@g.us", subject: "Grupo de teste", announce };
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(GroupControls, { group, permissions, refresh: async () => {} })));
}

describe("group controls", () => {
  it("gives administrators the settings and opens the agenda with the current group", () => {
    const view = render({ manage: true, post: true, selfId: "1234567890@lid" });
    expect(view).toContain("Definições do grupo");
    expect(view).toContain("Convites e pedidos de entrada");
    expect(view).toContain("Publicar agora");
    expect(view).toContain("Promoção");
    expect(view).toContain("Comprovativos no grupo");
    expect(view).toContain("/schedule?new=group&amp;group=12036312345%40g.us");
  });

  it("shows member restrictions when the linked account cannot post or manage", () => {
    const view = render({ manage: false, post: false, selfId: "1234567890@lid" }, true);
    expect(view).toContain("Só administradores podem escrever.");
    expect(view).not.toContain("Gerar novo link");
    expect(view).not.toContain("Agendar anúncio");
    expect(view).not.toContain("Abrir grupo");
    expect(view).not.toContain("Promoção");
    expect(view).not.toContain("Comprovativos no grupo");
  });

  it("shows the confirmed writing mode and its opposite action for administrators", () => {
    const permissions = { manage: true, post: true, selfId: "1234567890@lid" };
    expect(render(permissions)).toContain("Grupo aberto");
    expect(render(permissions)).toContain("Fechar grupo");
    expect(render(permissions, true)).toContain("Grupo fechado");
    expect(render(permissions, true)).toContain("Abrir grupo");
  });
});
