# AgentX 2.0 — organizações, revisão financeira e acesso digital

Este marco liga uma encomenda digital a um comprador com conta Supabase Auth. O comprador pode submeter texto ou um ficheiro de comprovativo e, após a validação financeira e o processamento da outbox, pedir um link temporário para o ficheiro.

## Executar em ambiente de teste

1. Use um projeto Supabase de teste e credenciais da base de dados. Com `PGDATABASE` definido com a ligação PostgreSQL de uma sessão autorizada, execute `psql -X -f migrations/apply_agentx_v2.sql`. O script aplica as quatro migrações por ordem, ignora etapas já aplicadas e verifica os objetos necessários no fim. Em Supabase SQL Editor, execute os quatro ficheiros datados por ordem; o script agregador usa comandos exclusivos do `psql`.
2. Inicie a aplicação com `npm run dev` e o processo de entrega com `npm run worker:digital`. O worker usa `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Execute-o como processo separado e supervisione os seus logs. Em Docker Compose, ative o perfil `commerce-v2` após as migrações com `docker compose --profile commerce-v2 up -d --build`.
3. Abra **Pedidos digitais** em `/digital-orders`. Use sessões de teste distintas para o titular da empresa, o responsável financeiro e o comprador. As rotas abaixo usam o prefixo `/api/v2/commerce` e o cabeçalho `Authorization: Bearer <access_token>`.
4. Crie uma encomenda de teste, submeta um comprovativo simulado e peça a entrega antes e depois da revisão. Confirme também que o download falha com a sessão de outro comprador.

| Método e rota | Conta autorizada | Corpo ou resultado |
| --- | --- | --- |
| `GET /organizations` | Utilizador autenticado | Empresas ativas em que a sessão tem associação e respetivo papel. |
| `GET /my-orders` | Comprador | As 100 encomendas mais recentes de empresas ativas associadas à conta, com situação de pagamento e entrega. |
| `POST /organizations` | Utilizador autenticado | JSON com `name`, `slug`. Cria a empresa e a respetiva associação de titular na mesma transação. |
| `PUT /:organizationId/members/:memberId` | Titular | JSON com `role` igual a `admin`, `finance_admin`, `operator`, `viewer` ou `null` para remover a associação. O membro precisa de uma conta Auth existente. |
| `POST /:organizationId/digital-assets` | Titular, administrador ou operador | Multipart com um campo `file`, até 20 MiB. Devolve o UUID do ativo privado. |
| `PUT /:organizationId/orders/:orderId` | Titular, administrador ou operador | JSON com `customerId`, `customerPhone`, `amount` decimal em texto, `currency` ISO e `digitalAssetId`. O cliente da API gera e reutiliza o UUID da encomenda ao repetir a criação. |
| `POST /:organizationId/orders/:orderId/payment-proofs` | Comprador da encomenda | JSON com `text`, entre 10 e 4000 caracteres. O mesmo texto na mesma encomenda devolve o ID anterior. |
| `POST /:organizationId/orders/:orderId/proof-attachments` | Comprador da encomenda | Multipart com um campo `file`, até 5 MiB, em JPEG, PNG ou PDF. O mesmo ficheiro na mesma encomenda devolve o ID anterior. |
| `GET /:organizationId/payment-proofs/:proofId/attachment` | Titular ou responsável financeiro | Anexo em base64 para download autenticado. |
| `GET /:organizationId/payment-proofs/pending` | Titular ou responsável financeiro | Até 50 comprovativos pendentes por ordem de chegada, com valor da encomenda, dados extraídos e sinalização de texto repetido na empresa. |
| `POST /:organizationId/payment-proofs/:proofId/review` | Titular ou responsável financeiro | Aprovação com `decision: "approve"`, `settlementVerified: true`, `settlementMethod` e `settlementReference`. Rejeição com `decision: "reject"` e `note` obrigatória. |
| `GET /:organizationId/orders/:orderId/download` | Comprador da encomenda | Link de download com 60 segundos de validade depois de o worker registar a entrega. |

O comprador pode guardar uma confirmação em texto com a empresa, a encomenda, o montante, a data e a referência oficial. A confirmação inclui uma mensagem de agradecimento e vem identificada como documento sem valor fiscal.

Os comprovativos anexados ficam numa tabela privada com RLS e são gravados na mesma transação que a submissão. A API verifica o cabeçalho do ficheiro e o limite de tamanho. A equipa financeira analisa os anexos manualmente. A validação de formato não substitui um serviço de deteção de ficheiros maliciosos.

O responsável financeiro confere o recebimento, o montante e a moeda no extrato do prestador antes de confirmar a revisão. Use a referência oficial e o método correspondente (`mpesa`, `emola`, `bank_transfer` ou `other`). Uma extração com montante divergente bloqueia a aprovação. A mesma referência normalizada, no mesmo método e empresa, só pode liquidar uma encomenda. O estado da encomenda, o revisor e o evento de pagamento são persistidos na mesma transação.

O worker utiliza bloqueios por evento e cria um único registo de acesso por encomenda. Se a transação falhar, o evento continua pendente. A falta do objeto ou a suspensão da empresa também deixa o evento pendente. A reposição do mesmo objeto privado ou a reativação da empresa permite retomar o processamento. A API verifica a sessão do comprador quando emite o link. O URL assinado é uma credencial temporária e deve ser tratado como tal.

## Validação e rollback

- `npm test` inclui chamadas HTTP ao router e middleware reais, com serviços Supabase simulados.
- `tests/integration/run-agentx-v2.sh` usa PostgreSQL 16 em Docker e simula as tabelas e os papéis de Auth e Storage. Exercita RLS, tentativas de acesso entre empresas, rollback, liquidação duplicada, aprovação concorrente e retoma do worker.
- `npm run lint` verifica TypeScript. `npm run build` cria a distribuição React.
- O teste do PostgreSQL verifica as políticas de Storage ao nível da base de dados. A emissão e a utilização do link ainda requerem validação com o serviço Supabase Storage completo.

Faça backup antes de aplicar a migração num ambiente com dados. Para reverter uma instalação ainda sem atividade financeira ou ficheiros deste marco, encerre o worker e o tráfego da API v2, aplique primeiro `migrations/rollback/20261123_agentx_v2_proof_attachments.sql`, depois `migrations/rollback/20261122_agentx_v2_digital_orders.sql` e volte à versão anterior da aplicação. O rollback restaura a assinatura anterior da revisão e preserva as restrições de escrita para utilizadores do navegador. Se já existirem encomendas digitais, novas provas ou anexos, referências de liquidação, ficheiros ou entregas, a transação de rollback recusa a remoção. Nesse caso preserve o esquema e os dados, suspenda o tráfego e use uma correção progressiva ou um restauro planeado com reconciliação dos pagamentos.

## Continuação da reconstrução

O fluxo v2 já inclui as telas do comprador, do operador e da equipa financeira. Ficam pendentes os avisos externos de revisão e entrega por WhatsApp, a extração automática de dados dos anexos, o rastreio de ficheiros maliciosos e a emissão fiscal. O catálogo com preços, stock e itens de encomenda ainda precisa de integração com os ativos privados. Também ficam pendentes a migração auditada do CRM legado para organizações, PaySuite, moderação de grupos, ferramentas comerciais da IA com permissões por empresa, BullMQ/Redis e administração de subscrições e limites.

## Catálogo do agente e ficheiros vendidos pelo WhatsApp

Aplique `supabase/migrations/12_catalog_deliverables.sql` num projeto que já tenha a migração
`08_agentx_2_0_commerce_operations.sql` do comércio existente. A migração é aditiva e desativa
o acesso direto do navegador às tabelas do comércio. As rotas autenticadas continuam a usar
o catálogo vinculado à conta que gere a sessão WhatsApp.

Em **Vendas & Pedidos → Catálogo**, crie um produto digital ou anexe um ficheiro a um produto
já cadastrado. São aceites PDF, EPUB, JPEG, PNG e WebP até 20 MiB. O agente recebe apenas os
dados comerciais e consulta o catálogo ativo da conta. No pedido, o preço e a referência do
ficheiro vêm do catálogo. O sistema verifica o stock disponível no momento da criação do pedido.

Após conferir o pagamento no prestador, aprove o comprovativo. O WhatsApp recebe um link
assinado válido por 24 horas. Guarde o link como uma credencial temporária. Se a sessão estiver
desligada, volte a ligá-la e use **Tentar entrega**. Se o envio ficar por confirmar, verifique a
conversa antes de qualquer reenvio. O estado de pagamento permanece confirmado.

O catálogo associado a cada conta do WhatsApp permanece no módulo **Vendas & Pedidos**.
O fluxo por organização em **Pedidos digitais** continua a usar a descarga autenticada do
comprador. Uma reversão do container deve manter o esquema novo para preservar ficheiros,
aprovações e pedidos que tenham sido criados entretanto.

## Agenda e comandos pelo WhatsApp

Aplique `supabase/migrations/13_whatsapp_operator.sql` antes de atualizar o backend.
Em **Disparos Programados**, selecione um contacto e programe texto, anexos ou uma nota de voz.
O horário mostrado no painel usa o fuso do navegador. Ao programar pelo WhatsApp, o agente
usa o fuso da empresa ou África/Maputo quando não houver configuração.

A aba **Agente IA** mostra os comandos que funcionam na conversa do número ligado consigo
mesmo. `/agentx mensagens` lista até cinco mensagens por ler, `/agentx leads` lista até
cinco leads recentes e `/agentx agenda` mostra os próximos cinco envios. É possível publicar
um Status de texto, agendar Status ou agendar uma mensagem de texto. Para notas de voz
ou Status com imagem e vídeo, use a agenda no painel.

O aviso de contacto vem desativado. Quando ativado, é enviado ao próprio número ligado,
sem incluir conteúdo da conversa. O sistema limita a um aviso por contacto a cada 30 minutos.
Se a confirmação do WhatsApp for ambígua, verifique a conversa ou o Status antes de reenviar.
