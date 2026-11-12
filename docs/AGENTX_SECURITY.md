# DIRETRIZES E CORREÇÕES DE SEGURANÇA — KAZIX AGENTX

Este documento detalha o estado de segurança da plataforma, as vulnerabilidades identificadas e as contramedidas aplicadas.

---

## 1. POLÍTICA DE CREDENCIAIS E SEGREDOS

### 1.1 Supabase Service Role Key
* **Regra:** A chave `SUPABASE_SERVICE_ROLE_KEY` tem privilégios de superadministrador sobre todas as tabelas do banco, ignorando as políticas RLS (Row Level Security).
* **Vulnerabilidade Anterior:** A chave estava embutida no código claro em `backend/supabaseAdmin.ts` e exportada para o frontend como `DEFAULT_KEY` em `src/supabase.ts`.
* **Ação Corretiva:**
  1. Remoção imediata de todas as chaves estáticas do código-fonte.
  2. Validação obrigatória no arranque (`backend/supabaseAdmin.ts`): se `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` não estiverem configuradas nas variáveis de ambiente, o processo backend falha controladamente com erro explícito sem expor segredos.
  3. No frontend (`src/supabase.ts`), apenas a chave pública `VITE_SUPABASE_ANON_KEY` é permitida. Nunca incluir a chave de serviço no bundle do navegador.
  4. **Nota ao Administrador:** A chave que esteve exposta em commits anteriores deve ser revogada e regenerada no painel do Supabase (*Project Settings -> API -> Regenerate Service Role Key*).

---

## 2. SEGURANÇA NO CONTROLE DE VERSÕES (GIT)

### 2.1 Rastreio de Sessões e Ficheiros de Clientes
* **Vulnerabilidade Anterior:** O ficheiro `whatsapp_sessions_data/9744c780-39bd-48df-9a84-acaf4dec34a9.json` contendo chaves criptográficas de autenticação do WhatsApp e ficheiros de áudio/imagem em `uploads/` estavam commitados no repositório.
* **Ação Corretiva:**
  1. Executado `git rm --cached` para retirar do tracking do Git os ficheiros existentes sem apagá-los do disco local do utilizador.
  2. Adicionadas regras abrangentes no `.gitignore`:
     ```gitignore
     whatsapp_sessions_data/
     uploads/
     *.session
     *.key
     .env*
     !.env.example
     ```

---

## 3. AUTENTICAÇÃO E CONTROLO DE ACESSO BASEADO EM PAPÉIS (RBAC)

### 3.1 Remoção de Administradores por E-mail Estático
* **Vulnerabilidade Anterior:** O ficheiro `backend/routes/auth.ts` concedia papel `admin` automaticamente se o e-mail fosse igual a `"alcindacharles@gmail.com"` ou `"emersontorres42@gmail.com"`.
* **Ação Corretiva:**
  - O papel do utilizador deve ser obtido exclusivamente da tabela `public.users(role)` autenticada pelo Supabase.
  - Apenas um superadministrador já existente pode alterar o papel de outro utilizador na tabela de utilizadores.
  - Nenhum endpoint público de registo permite autoatribuição de privilégios `admin`.

### 3.2 Papéis Suportados
1. `superadmin`: Acesso irrestrito a configurações do servidor, packs de modelos e planos de preços.
2. `admin`: Administrador da empresa/tenant. Acesso total a contactos, leads, agentes e automações da sua conta.
3. `manager`: Gestor comercial. Acesso a leads, Kanban, agendamentos e métricas da empresa.
4. `operator`: Atendente humano. Acesso ao chat de mensagens e contactos designados.
5. `user`: Utilizador padrão do plano cadastrado.

---

## 4. PROTEÇÃO DO AGENTE DE IA CONTRA PROMPT INJECTION E ESCALADA DE PRIVILÉGIOS

### 4.1 Identificação Insegura de Administradores
* **Vulnerabilidade Anterior:** O Agente de IA verificava se o remetente de uma mensagem no WhatsApp tinha o nome contendo "emerson" ou uma tag "admin" e, caso afirmativo, concedia privilégios de execução de ferramentas administrativas (`role = "admin"`). Qualquer contacto salvo com esse nome ou que enviasse mensagens forjadas poderia executar comandos restritos.
* **Ação Corretiva:**
  - Remoção de verificação baseada em texto, nome de contacto ou tags editáveis.
  - A permissão administrativa via WhatsApp é concedida unicamente se o número do remetente coincidir de forma exata e verificada com o telefone do dono da conta (`users.phone`) ou constar na lista oficial e restrita de telefones gerenciais autorizados (`users.admin_phones`).

### 4.2 Restrição de Execução do Agente Desativado
* Se `agent.is_active === false`, o agente rejeita silenciosamente qualquer processamento, sem disparar chamadas de LLM ou ferramentas.

---

## 5. PROTEÇÃO DE FICHEIROS E PATH TRAVERSAL

### 5.1 Acesso à Pasta `/uploads`
* **Vulnerabilidade Anterior:** A rota `/uploads` servia diretamente os ficheiros estáticos via Express sem conferir se o visitante pertencia à mesma empresa ou se estava logado.
* **Ação Corretiva:**
  - Implementação de middleware com verificação de autenticação e higienização estrita de nomes de arquivos (`path.basename`), impedindo ataques de travessia de diretório (`../`).
