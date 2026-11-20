# AgentX 2.0 — organizações, revisão financeira e acesso digital

Este marco liga uma encomenda digital a um comprador com conta Supabase Auth. O comprador pode submeter texto de um comprovativo e, após a validação financeira e o processamento da outbox, pedir um link temporário para o ficheiro.

## Executar em ambiente de teste

1. Use um projeto Supabase de teste e as credenciais de servidor. Aplique por ordem `migrations/20261121_agentx_v2_foundation.sql`, `migrations/20261121_agentx_v2_payment_reviews.sql` e `migrations/20261122_agentx_v2_digital_orders.sql`. Se as duas primeiras já estiverem aplicadas, execute apenas a terceira.
2. Inicie a aplicação com `npm run dev` e o processo de entrega com `npm run worker:digital`. O worker usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Execute-o como processo separado e supervisione os seus logs.
3. Use sessões de teste distintas para o titular da empresa, o responsável financeiro e o comprador. As rotas abaixo usam o prefixo `/api/v2/commerce` e o cabeçalho `Authorization: Bearer <access_token>`.
4. Crie uma encomenda de teste, submeta um comprovativo simulado e peça a entrega antes e depois da revisão. Confirme também que o download falha com a sessão de outro comprador.

| Método e rota | Conta autorizada | Corpo ou resultado |
| --- | --- | --- |
| `POST /organizations` | Utilizador autenticado | JSON com `name`, `slug`. Cria a empresa e a respetiva associação de titular na mesma transação. |
| `PUT /:organizationId/members/:memberId` | Titular | JSON com `role` igual a `admin`, `finance_admin`, `operator`, `viewer` ou `null` para remover a associação. O membro precisa de uma conta Auth existente. |
| `POST /:organizationId/digital-assets` | Titular, administrador ou operador | Multipart com um campo `file`, até 20 MiB. Devolve o UUID do ativo privado. |
| `PUT /:organizationId/orders/:orderId` | Titular, administrador ou operador | JSON com `customerId`, `customerPhone`, `amount` decimal em texto, `currency` ISO e `digitalAssetId`. O cliente da API gera e reutiliza o UUID da encomenda ao repetir a criação. |
| `POST /:organizationId/orders/:orderId/payment-proofs` | Comprador da encomenda | JSON com `text`, entre 10 e 4000 caracteres. O mesmo texto na mesma encomenda devolve o ID anterior. |
| `GET /:organizationId/payment-proofs/pending` | Titular ou responsável financeiro | Até 50 comprovativos pendentes por ordem de chegada, com valor da encomenda, dados extraídos e sinalização de texto repetido na empresa. |
| `POST /:organizationId/payment-proofs/:proofId/review` | Titular ou responsável financeiro | Aprovação com `decision: "approve"`, `settlementVerified: true`, `settlementMethod` e `settlementReference`. Rejeição com `decision: "reject"` e `note` obrigatória. |
| `GET /:organizationId/orders/:orderId/download` | Comprador da encomenda | Link de download com 60 segundos de validade depois de o worker registar a entrega. |

O responsável financeiro confere o recebimento, o montante e a moeda no extrato do prestador antes de confirmar a revisão. Use a referência oficial e o método correspondente (`mpesa`, `emola`, `bank_transfer` ou `other`). Uma extração com montante divergente bloqueia a aprovação. A mesma referência normalizada, no mesmo método e empresa, só pode liquidar uma encomenda. O estado da encomenda, o revisor e o evento de pagamento são persistidos na mesma transação.

O worker utiliza bloqueios por evento e cria um único registo de acesso por encomenda. Se a transação falhar, o evento continua pendente. A falta do objeto ou a suspensão da empresa também deixa o evento pendente. A reposição do mesmo objeto privado ou a reativação da empresa permite retomar o processamento. A API verifica a sessão do comprador quando emite o link. O URL assinado é uma credencial temporária e deve ser tratado como tal.

## Validação e rollback

- `npm test` inclui chamadas HTTP ao router e middleware reais, com serviços Supabase simulados.
- `tests/integration/run-agentx-v2.sh` usa PostgreSQL 16 em Docker e simula as tabelas e os papéis de Auth e Storage. Exercita RLS, tentativas de acesso entre empresas, rollback, liquidação duplicada, aprovação concorrente e retoma do worker.
- `npm run lint` verifica TypeScript. `npm run build` cria a distribuição React.
- O teste do PostgreSQL verifica as políticas de Storage ao nível da base de dados. A emissão e a utilização do link ainda requerem validação com o serviço Supabase Storage completo.

Faça backup antes de aplicar a migração num ambiente com dados. Para reverter uma instalação ainda sem atividade financeira ou ficheiros deste marco, encerre o worker e o tráfego da API v2, aplique `migrations/rollback/20261122_agentx_v2_digital_orders.sql` e volte à versão anterior da aplicação. O rollback restaura a assinatura anterior da revisão e preserva as restrições de escrita para utilizadores do navegador. Se já existirem encomendas digitais, novas provas, referências de liquidação, ficheiros ou entregas, a transação de rollback recusa a remoção. Nesse caso preserve o esquema e os dados, suspenda o tráfego e use uma correção progressiva ou um restauro planeado com reconciliação dos pagamentos.

## Continuação da reconstrução

O fluxo v2 deste marco é uma API para comprovativos em texto e entrega por download autenticado. Ficam pendentes a interface do comprador e da equipa financeira, anexos de comprovativos, notificações, envios por WhatsApp, agradecimentos e recibos. O catálogo com preços, stock e itens de encomenda ainda precisa de integração com os ativos privados. Também ficam pendentes a migração auditada do CRM legado para organizações, PaySuite, moderação de grupos, ferramentas comerciais da IA com permissões por empresa, BullMQ/Redis e administração de subscrições e limites.
