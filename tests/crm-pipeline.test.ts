import { describe, it, expect } from "vitest";

const VALID_STAGES = ["novo", "em_atendimento", "proposta_enviada", "venda_fechada", "perdido"] as const;
type StageType = typeof VALID_STAGES[number];

function normalizeStage(rawStage: string): { stage: StageType; status: string } {
  let normalized = rawStage.toLowerCase().trim();
  if (normalized === "ganho" || normalized === "fechado" || normalized === "closed") {
    normalized = "venda_fechada";
  } else if (normalized === "novo_lead" || normalized === "new") {
    normalized = "novo";
  } else if (normalized === "atendimento" || normalized === "in_progress") {
    normalized = "em_atendimento";
  } else if (normalized === "proposta") {
    normalized = "proposta_enviada";
  } else if (normalized === "lost") {
    normalized = "perdido";
  }

  if (!VALID_STAGES.includes(normalized as StageType)) {
    throw new Error(`Estágio inválido: "${rawStage}". Os estágios válidos são: ${VALID_STAGES.join(", ")}`);
  }

  return {
    stage: normalized as StageType,
    status: normalized as StageType
  };
}

describe("CRM Pipeline & Stage Normalization", () => {
  it("accepts all 5 canonical stages without modification", () => {
    for (const stage of VALID_STAGES) {
      const res = normalizeStage(stage);
      expect(res.stage).toBe(stage);
      expect(res.status).toBe(stage);
    }
  });

  it("normalizes legacy 'ganho' and 'fechado' to 'venda_fechada'", () => {
    expect(normalizeStage("ganho").stage).toBe("venda_fechada");
    expect(normalizeStage("fechado").stage).toBe("venda_fechada");
    expect(normalizeStage("closed").stage).toBe("venda_fechada");
  });

  it("normalizes legacy 'atendimento' to 'em_atendimento'", () => {
    expect(normalizeStage("atendimento").stage).toBe("em_atendimento");
  });

  it("normalizes legacy 'proposta' to 'proposta_enviada'", () => {
    expect(normalizeStage("proposta").stage).toBe("proposta_enviada");
  });

  it("rejects unknown or invalid stages with a helpful error", () => {
    expect(() => normalizeStage("invalid_stage_xyz")).toThrow("Estágio inválido");
  });
});
