# AÇÕES PENDENTES E INTERVENÇÕES HUMANAS NECESSÁRIAS — KAZIX AGENTX

Este documento regista bloqueios externos, dependências de fornecedores e ações que exigem intervenção direta do administrador ou proprietário da infraestrutura.

---

## 1. SEGURANÇA E CREDENCIAIS (AÇÃO DO ADMINISTRADOR OBRIGATÓRIA)

| Item | Descrição | Ação Necessária | Responsável | Estado |
|---|---|---|---|---|
| **Revogação da Chave Supabase** | A chave `service_role` esteve commitada em commits antigos do repositório público/privado. | No painel do Supabase (*Project Settings -> API*), clicar em **Generate new secret** para a `service_role key`. Atualizar a nova chave exclusivamente no `.env` do servidor de produção. | Administrador | ⚠️ Pendente de ação humana |
| **Configuração de Domínio DNS** | O domínio `agentx.kazix.site` precisa apontar para o IP público da VPS. | Criar registo `A` no DNS do domínio `agentx.kazix.site` apontando para o IP da VPS Ubuntu. | Administrador | ⚠️ Pendente |
| **Certificado SSL Let's Encrypt** | O Nginx precisa emitir o certificado HTTPS para `agentx.kazix.site`. | Após o DNS propagar, executar na VPS: `sudo certbot --nginx -d agentx.kazix.site`. | Administrador / DevOps | ⚠️ Pendente |

---

## 2. INTEGRAÇÕES EXTERNAS EM HOMOLOGAÇÃO

| Módulo | Dependência | Estado Atual | Próximo Passo |
|---|---|---|---|
| **Pagamentos M-Pesa / eMola** | API Oficial dos Provedores (Vodacom / Movitel) | Fluxo manual funcional com M-Pesa (`84 885 8288`), eMola (`87 620 0662`) e validação via senhas de licença. | Preparar arquitetura de webhook para quando o cliente obtiver credenciais corporativas de API M-Pesa. |
| **Meta WhatsApp Cloud API** | Conta Meta Business Verificada e Token de Produção | Baileys multi-device 100% ativo e funcional. | Interface de transporte abstrata `IWhatsAppTransport` implementada para permitir virada de chave no futuro. |
