# Manual do Utilizador e Administrador — Kazix AgentX 2.0

Bem-vindo ao **AgentX 2.0 by Kazix**, a sua plataforma de agentes comerciais e atendimento inteligente com gestão omnicanal para WhatsApp.

---

## 1. Primeiro Acesso e Painel Inicial

Ao iniciar sessão no endereço `agentx.kazix.site` (ou em ambiente local):
1. Introduza o seu e-mail e palavra-passe de administrador ou operador.
2. No menu lateral esquerdo terá acesso imediato aos módulos operacionais:
   - **Dashboard:** Métricas de conversão, novos contactos e atividades recentes.
   - **Mensagens:** Caixa de entrada em tempo real com conversas do WhatsApp.
   - **Vendas & Pedidos (`/orders`):** Centro de operações de comércio, catálogo e validações de pagamento.
   - **Contactos & CRM:** Gestão de clientes, tags comerciais e funil de vendas.
   - **Agente de IA (`/agent`):** Construtor visual de agentes, especializações e governança.
   - **Automações & Campanhas:** Agendamento de disparos em massa e fluxos de mensagens.
   - **Conexão WhatsApp:** QR Code e status da sessão Baileys.

---

## 2. Gestão do Catálogo de Produtos e Serviços

Para permitir que o seu agente de IA apresente produtos, informe preços corretos e crie pedidos para os clientes:

1. Aceda ao menu **Vendas & Pedidos** e selecione o separador **Catálogo de Produtos**.
2. Clique no botão **+ Novo Produto**.
3. Preencha os campos:
   - **Nome do Produto:** Ex: `Pacote de Internet 5 GB` ou `Plano Pro Mensal`.
   - **Preço (MT):** Valor em Meticais (ex: `500.00`).
   - **Categoria:** Ex: `Internet`, `Software`, `Consultoria`, `Acessórios`.
   - **Quantidade em Stock:** Stock disponível (ou deixe ilimitado para serviços/digitais).
   - **Produto Digital?:** Marque esta opção caso a entrega seja automática por WhatsApp.
   - **Conteúdo da Entrega Digital:** As credenciais, link de acesso ou instruções que o cliente receberá no WhatsApp assim que o pagamento for aprovado (ex: `Chave de Acesso: AGX-KEY-9988`).
4. Clique em **Guardar Produto**. O produto fica imediatamente disponível para os agentes de IA consultarem durante as conversas.

---

## 3. Fluxo de Venda e Validação de Pagamentos

Quando um cliente fala com a sua empresa pelo WhatsApp:
1. O agente de IA apresenta o catálogo e esclarece dúvidas.
2. Quando o cliente decide comprar, o agente gera um pedido formal (ex: `AGX-492104`) com as instruções oficiais de pagamento (M-Pesa, e-Mola ou Transferência Bancária).
3. O cliente envia o SMS copiado ou uma foto do comprovativo.
4. O motor de inteligência do AgentX extrai a referência, o montante e o remetente, criando um item em **Validações Pendentes**.
5. **Para o Administrador Aprovar:**
   - Aceda a **Vendas & Pedidos** > **Validações Pendentes**.
   - Verifique a referência do pagamento e o montante recebido na sua conta M-Pesa/e-Mola/Banco.
   - Clique no botão verde **Aprovar Pagamento**.
   - O sistema altera o pedido para **Pago** (`paid`), aciona a entrega digital no WhatsApp do cliente e grava o evento na Linha Temporal.
   - Caso o comprovativo seja falso ou incorreto, clique no botão vermelho **Rejeitar** e informe o motivo.

---

## 4. Configuração e Construtor Visual de Agentes (`/agent`)

No módulo **Agente de IA**, o administrador personaliza o comportamento do agente com total flexibilidade:

### 4.1 Escolha da Especialização
Selecione um dos 8 modelos pré-configurados:
- **Vendas:** Focado em catálogo, conversão e emissão de pedidos.
- **Pagamentos:** Especialista em instruções M-Pesa/e-Mola e receção de comprovativos.
- **Gestão de Leads:** Qualifica o perfil do cliente e pontua o interesse.
- **Marketing:** Promove ofertas e ofertas especiais com segurança anti-spam.
- **Agendamentos:** Marca reuniões e sincroniza horários.
- **Suporte Técnico:** Esclarece dúvidas técnicas e auxilia o cliente.
- **Administração:** Fornece métricas e relatórios internos para os gestores.
- **Multifuncional:** Combina as principais funções num único agente unificado.

### 4.2 Nível de Autonomia e Risco
- **Nível 1 (Supervisionado):** Não altera a base de dados sem confirmação direta.
- **Nível 2 (Semi-Autónomo):** Cria pedidos pendentes e qualifica contactos, exigindo aprovação para valores altos.
- **Nível 3 (Autónomo):** Opera livremente dentro das ferramentas habilitadas.

### 4.3 Limite Financeiro por Operação
Defina o montante máximo em Meticais (MT) que o agente pode manusear em propostas ou operações sem intervenção humana adicional.

---

## 5. Auditoria e Linha Temporal de Operações

No separador **Linha Temporal** do menu **Vendas & Pedidos**, o gestor acompanha em tempo real cada ação realizada:
- Criação de novos pedidos pelos agentes.
- Comprovativos submetidos e validados.
- Entregas digitais efetuadas aos clientes.
- Alterações em permissões e configurações de agentes.

Cada evento indica o horário, o operador/agente responsável, os detalhes do contacto e o resultado da operação.

