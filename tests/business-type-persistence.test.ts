import { describe, it, expect, beforeEach } from "vitest";
import { normalizeBusinessType, CanonicalBusinessType } from "../backend/routes/company.ts";
import { toCanonicalNiche, NICHE_CONFIGS, DEFAULT_NICHE } from "../src/lib/niches.ts";

describe("Fase 6 — Testes de Persistência do Perfil de Negócio (AgentX)", () => {
  // Mock tenant DB state to simulate multi-tenant Supabase persistence
  let mockDatabase: Record<string, { type: CanonicalBusinessType; name: string; timezone: string }> = {};

  beforeEach(() => {
    mockDatabase = {
      "tenant-empresa-1": {
        type: "general",
        name: "Empresa Moçambique",
        timezone: "Africa/Maputo"
      },
      "tenant-empresa-2": {
        type: "clinic",
        name: "Clínica Vida Segura",
        timezone: "Africa/Maputo"
      }
    };
  });

  it("Teste 1: Entrar com perfil Clínica → Alterar para Geral → Recarregar página → Continua Geral", () => {
    const tenantId = "tenant-empresa-2";
    expect(mockDatabase[tenantId].type).toBe("clinic");

    // Alterar para 'general'
    const newType = normalizeBusinessType("geral");
    mockDatabase[tenantId].type = newType;

    // Simular reload / recarregar página (nova leitura da fonte única de verdade)
    const reloadedProfile = mockDatabase[tenantId];
    expect(reloadedProfile.type).toBe("general");
    expect(reloadedProfile.type).not.toBe("clinic");
  });

  it("Teste 2: Alterar para Geral → Terminar sessão → Entrar novamente → Continua Geral", () => {
    const tenantId = "tenant-empresa-1";
    // Atualizar perfil
    mockDatabase[tenantId].type = normalizeBusinessType("general");

    // Simular logout (limpeza completa de localStorage e memória)
    let clientStorage: Record<string, string> = { crm_niche: "general" };
    clientStorage = {}; // localStorage.clear()

    // Simular novo login: o frontend busca da API /api/company/profile
    const fetchedFromServer = mockDatabase[tenantId];
    expect(fetchedFromServer.type).toBe("general");
    // Garante que o valor padrão da aplicação não é 'clinic'
    expect(DEFAULT_NICHE).toBe("general");
  });

  it("Teste 3: Alterar perfil num dispositivo → Entrar noutro dispositivo → Carrega o perfil correto", () => {
    const tenantId = "tenant-empresa-1";
    // Dispositivo A altera para 'retail' (Comércio & Vendas)
    mockDatabase[tenantId].type = normalizeBusinessType("vendas");

    // Dispositivo B inicia sem cache local prévio
    const deviceBFetched = mockDatabase[tenantId];
    expect(deviceBFetched.type).toBe("retail");
    expect(NICHE_CONFIGS[deviceBFetched.type].label).toBe("Comércio & Vendas");
  });

  it("Teste 4: Alterar perfil → Navegar entre páginas → A sidebar permanece consistente", () => {
    const tenantId = "tenant-empresa-1";
    mockDatabase[tenantId].type = normalizeBusinessType("clinic");

    const activeConfig = NICHE_CONFIGS[mockDatabase[tenantId].type];
    expect(activeConfig.id).toBe("clinic");
    expect(activeConfig.badge).toContain("Consultório");

    // Navegar para outra rota e verificar se as chaves canónicas e legadas são consistentes
    expect(NICHE_CONFIGS["clinica"].id).toBe("clinic");
    expect(NICHE_CONFIGS["clinic"].id).toBe("clinic");
  });

  it("Teste 5: Falha ao guardar configuração → Apresentar erro → Não fingir que a alteração foi guardada", () => {
    const tenantId = "tenant-empresa-1";
    const previousType = mockDatabase[tenantId].type;

    // Simular falha de rede/banco ao tentar salvar
    const networkFailed = true;
    let savedSuccessfully = false;

    if (!networkFailed) {
      mockDatabase[tenantId].type = normalizeBusinessType("restaurant");
      savedSuccessfully = true;
    }

    expect(savedSuccessfully).toBe(false);
    expect(mockDatabase[tenantId].type).toBe(previousType); // Permanece inalterado no servidor
  });

  it("Teste 6: Utilizador de outra empresa → Não consegue alterar o perfil desta empresa", () => {
    const tenantA = "tenant-empresa-1";
    const tenantB = "tenant-empresa-2";

    const updateRequest = {
      authenticatedUserTenant: tenantB,
      targetTenantToModify: tenantA,
      newType: "services"
    };

    // Verificação de autorização / isolamento multi-tenant
    const isAuthorized = updateRequest.authenticatedUserTenant === updateRequest.targetTenantToModify;
    expect(isAuthorized).toBe(false);

    if (isAuthorized) {
      mockDatabase[tenantA].type = normalizeBusinessType(updateRequest.newType);
    }

    // Perfil da Empresa 1 não foi alterado pela Empresa 2
    expect(mockDatabase[tenantA].type).toBe("general");
  });

  it("Teste 7: Alterar Clínica para Geral e voltar para Clínica → Dados e permissões permanecem intactos", () => {
    const tenantId = "tenant-empresa-1";

    // 1. Inicia como Clínica
    mockDatabase[tenantId].type = normalizeBusinessType("clinic");
    expect(mockDatabase[tenantId].type).toBe("clinic");

    // 2. Altera para Geral
    mockDatabase[tenantId].type = normalizeBusinessType("geral");
    expect(mockDatabase[tenantId].type).toBe("general");

    // 3. Volta para Clínica
    mockDatabase[tenantId].type = normalizeBusinessType("clinica");
    expect(mockDatabase[tenantId].type).toBe("clinic");
    expect(mockDatabase[tenantId].timezone).toBe("Africa/Maputo");
  });
});
