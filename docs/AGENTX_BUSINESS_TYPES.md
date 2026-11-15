# Arquitetura dos Tipos de Negócio e Perfis — Kazix AgentX

## 1. O Problema Identificado e a Causa Raiz

Anteriormente, os utilizadores relatavam que:
- O sistema apresentava frequentemente o perfil "Clínica", mesmo após terem selecionado "Geral".
- Ao fazer logout, trocar de dispositivo ou recarregar a página, as configurações voltavam para "Clínica".

### Causa Raiz Identificada na Auditoria
1. Em `src/lib/niches.ts`, a constante `DEFAULT_NICHE` estava hardcoded como `"clinica"`.
2. O perfil selecionado era guardado **apenas no `localStorage` do navegador** (`crm_niche`). Não existia nenhuma rota ou serviço no backend para persistir a escolha.
3. No logout (`handleLogout` em `Layout.tsx`), o código executava `localStorage.clear()`, apagando a chave `crm_niche`.
4. Ao regressar à plataforma ou abrir uma aba em anônimo, o sistema recorria ao `DEFAULT_NICHE` ("clinica").
5. A tabela `company_profile` no Supabase possuía uma restrição antiga (`type IN ('sales', 'services', 'support', 'ecommerce')`) que nem sequer permitia valores canónicos.

---

## 2. A Nova Arquitetura: Fonte Única de Verdade no Backend

A plataforma foi refatorada para seguir uma arquitetura multi-tenant onde o tipo de negócio pertence à empresa e é persistido no banco de dados Supabase:

### 2.1 Os 5 Identificadores Canónicos
| Identificador Canónico | Nome na Interface | Foco Operacional | Módulos em Destaque |
| :--- | :--- | :--- | :--- |
| **`general`** | **Geral / Flexível** (Padrão) | Comunicação multicanal e CRM amplo | Dashboard, Mensagens, Vendas, Agenda, Disparos, Contatos |
| **`clinic`** | **Clínica & Saúde** | Consultório, médicos, dentistas e triagem | Pacientes & Triagem, Lembretes de Consulta 24h/2h, Agenda |
| **`retail`** | **Comércio & Vendas** | Lojas físicas/digitais, produtos e propostas | Catálogo de Produtos, Pedidos, Comprovativos M-Pesa/e-Mola |
| **`restaurant`** | **Restaurante & Gastronomia** | Bares, delivery e alimentação | Cardápio Digital, Pedidos do Dia, Reservas de Mesa |
| **`services`** | **Serviços & Estética** | Salões, estética, barbearias e profissionais | Cardápio de Serviços, Marcação de Sessões, Histórico |

---

## 3. Migração 09 Aplicada no Supabase (`09_business_profile_canonical.sql`)

```sql
CREATE TABLE IF NOT EXISTS public.company_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    name TEXT NOT NULL DEFAULT 'Minha Empresa',
    type TEXT NOT NULL DEFAULT 'general',
    description TEXT DEFAULT '',
    timezone TEXT NOT NULL DEFAULT 'Africa/Maputo',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.company_profile 
ADD CONSTRAINT company_profile_type_check 
CHECK (type IN ('general', 'clinic', 'retail', 'restaurant', 'services', 'sales', 'support', 'ecommerce'));
```

---

## 4. Endpoints REST da API de Empresa (`/api/company`)

- **`GET /api/company/profile`**:
  - Requer Bearer Token de autenticação.
  - Carrega o perfil do utilizador autenticado.
  - Se for o primeiro acesso da empresa, inicializa atomicamente com `type: 'general'`, `name: 'Minha Empresa'` e `timezone: 'Africa/Maputo'`.
- **`PUT /api/company/profile`**:
  - Atualiza o tipo canónico, nome da empresa, fuso horário e configurações personalizadas.
  - Registra evento de auditoria no log do sistema.

---

## 5. Garantia de Preservação de Dados e Segurança

- A troca de tipo de negócio entre "Geral", "Clínica", "Comércio", "Restaurante" e "Serviços" **não apaga** nenhum contacto, conversa, lead, pedido ou agendamento existente.
- A configuração altera a experiência visual e os termos na interface (ex: "Leads" vs "Pacientes" vs "Pedidos"), mantendo os registros originais 100% seguros e intactos.

