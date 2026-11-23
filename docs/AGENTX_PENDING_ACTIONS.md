# AÇÕES PENDENTES E INTERVENÇÕES HUMANAS NECESSÁRIAS — KAZIX AGENTX

Este documento regista bloqueios externos, dependências de fornecedores e ações que exigem intervenção direta do administrador ou proprietário da infraestrutura.

---

## 1. SEGURANÇA E CREDENCIAIS (AÇÃO DO ADMINISTRADOR OBRIGATÓRIA)

| Item | Descrição | Ação Necessária | Responsável | Estado |
|---|---|---|---|---|
| **Revogação da Chave Supabase** | A chave `service_role` esteve commitada em commits antigos do repositório público/privado. | No painel do Supabase (*Project Settings -> API*), clicar em **Generate new secret** para a `service_role key`. Atualizar a nova chave exclusivamente no `.env` do servidor de produção. | Administrador | ⚠️ Pendente de ação humana |
| **Acesso à VPS** | O domínio público responde por HTTPS. A porta SSH recusou a ligação do ambiente de desenvolvimento. | Executar a publicação a partir da sessão administrativa da VPS e conferir a revisão em `/api/ready`. | Administrador / DevOps | Publicação pendente |

---

## 2. INTEGRAÇÕES EXTERNAS EM HOMOLOGAÇÃO

| Módulo | Dependência | Estado Atual | Próximo Passo |
|---|---|---|---|
| **Pagamentos manuais** | Confirmação independente no prestador | Os testes PostgreSQL cobrem aprovação concorrente e entrega única no fluxo v2. | Usar contas de teste para verificar o percurso no painel com comprovativo, revisão e acesso digital. |
| **WhatsApp** | Sessão Baileys ligada e permissões do número | A API e os cenários simulados cobrem mensagens, anúncios e permissões. | Usar um número e grupo de teste para confirmar os envios, a receção e os estados apresentados na Agenda. |

## 3. VALIDAÇÃO DA PRÓXIMA PUBLICAÇÃO

1. Abra `/api/ready` e compare `release` com o commit publicado. Em **Estado da operação**, confirme a base, a ligação WhatsApp e o processador de entregas.
2. Use um contacto de teste para receber e responder a uma mensagem. Confirme a conversa no painel. Agende um segundo envio e confirme a receção e o estado na agenda.
3. Use um grupo de teste com um administrador e um membro. Confirme o envio do anúncio, a próxima ocorrência e a recusa de uma alteração feita pela conta sem permissão.
4. Valide uma venda de teste desde a consulta ao catálogo e criação do pedido até à revisão humana. Nos pedidos digitais, confirme o link do comprador autorizado e a unicidade da entrega.
5. Faça uma marcação de teste no fuso horário da empresa e confirme o lembrete no WhatsApp e a sua indicação no painel.

