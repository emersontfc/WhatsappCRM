import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Workflows } from "../src/components/Workflows";
import type { BusinessNiche } from "../src/lib/niches";

function display(niche: BusinessNiche, free = false, whatsappStatus: string | null = "connected") {
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(Workflows, { niche, free, whatsappStatus })));
}

describe("guided home screen", () => {
  it("presents the five tasks and prioritizes the matching clinic links", () => {
    const view = display("clinic");
    for (const task of ["Confirmar pagamentos", "Gerir grupos", "Vender e publicar", "Atender numa clínica", "Organizar um salão"]) {
      expect(view).toContain(task);
    }
    expect(view).toContain("/appointments?context=clinic&amp;tab=services");
    expect(view).toContain("/appointments?context=clinic&amp;tab=reminders");
    expect(view).toContain("/appointments?context=clinic&amp;tab=agenda&amp;new=appointment");
  });

  it("opens the seller workspace, sales publication and salon agenda", () => {
    expect(display("services")).toContain("/appointments?context=salon&amp;tab=agenda&amp;new=appointment");
    const sales = display("retail");
    expect(sales).toContain('href="/seller"');
    expect(sales).toContain("/schedule?new=status");
  });

  it("shows the connection action and respects the existing plan limits", () => {
    const view = display("retail", true, "disconnected");
    expect(view).toContain("#ligar-whatsapp");
    expect(view).toContain("/activate");
    expect(view).not.toContain("/schedule?new=status");
    expect(view).toContain('href="/seller"');
  });
});
