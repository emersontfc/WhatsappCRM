# AgentX 2.0 — organizações, revisão financeira e acesso digital

Este marco liga uma encomenda digital a um comprador com conta Supabase Auth. O comprador pode submeter texto ou um ficheiro de comprovativo e, após a validação financeira e o processamento da outbox, pedir um link temporário para o ficheiro.

## Executar em ambiente de teste

1. Use um projeto Supabase de teste e credenciais da base de dados. Com `PGDATABASE` definido com a ligação PostgreSQL de uma sessão autorizada, execute `psql -X -f migrations/apply_agentx_v2.sql`. O script aplica as quatro migrações por ordem, ignora etapas já aplicadas e verifica os objetos necessários no fim. Em Supabase SQL Editor, execute os quatro ficheiros datados por ordem; o script agregador usa comandos exclusivos do `psql`.
2. Inicie a aplicação com `npm run dev`. O servidor processa a outbox de entregas usando `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Para executar `npm run worker:digital` como processo separado, configure `DISABLE_DIGITAL_DELIVERY_WORKER=true` no servidor web e use as mesmas credenciais Supabase.
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

O fluxo v2 já inclui as telas do comprador, do operador e da equipa financeira. Ficam pendentes os avisos externos de revisão e entrega por WhatsApp, a extração automática de dados dos anexos, o rastreio de ficheiros maliciosos e a emissão fiscal. O catálogo com preços, stock e itens de encomenda ainda precisa de integração com os ativos privados. Também ficam pendentes a migração auditada do CRM legado para organizações, moderação de grupos, ferramentas comerciais da IA com permissões por empresa, BullMQ/Redis e administração de subscrições e limites.

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

## Piloto Vendedor pelo WhatsApp

Aplique `supabase/migrations/20_seller_workspace.sql` depois das migrações 12, 14 e 19 e antes de publicar a versão. A atualização preserva o catálogo, os pedidos e os comprovativos existentes. A verificação antes da publicação exige o esquema novo. A versão anterior pode continuar a operar com as tabelas e colunas adicionadas.

Em instalações que já receberam a migração 20, aplique `supabase/migrations/21_seller_lead_compatibility.sql`. Repare a base antes de publicar a aplicação. A migração adiciona os campos que o CRM antigo ainda possa não ter, como `leads.last_action`, e preserva os registos existentes. No SQL Editor, `select public.agentx_seller_contract_ready();` deve devolver `true`. O endpoint `/api/ready` da nova versão também valida o contrato de vendas.

Abra **Vendedor** em `/seller`. Ligue o WhatsApp, ative um agente com perfil **Vendas** ou **Multifuncional**, publique um produto com stock e configure o destino de pagamento. Os produtos digitais precisam de um ficheiro privado ou conteúdo de entrega. O agente guarda as instruções de pagamento no pedido para que uma alteração posterior do destino só afete novos pedidos.

O cliente pode enviar um SMS ou um comprovativo em texto pelo WhatsApp. Inclua o número do pedido se tiver mais de um aberto. A receção cria um comprovativo pendente e envia um aviso ao número indicado, se estiver configurado. O titular da conta abre o painel, confere o recebimento no prestador e introduz o método, a referência oficial e o montante. O mesmo pagamento confirmado só pode liquidar um pedido por conta e por método. A entrega digital usa um link temporário e a confirmação por WhatsApp.

O teste `tests/integration/run-agentx-inbox.sh` verifica o fluxo com PostgreSQL e PostgREST. Use `AGENTX_INBOX_BROWSER=1` após compilar para incluir a configuração e a aprovação no navegador. A IA, o transporte WhatsApp e o Storage são simulados neste ensaio. A operação com números reais e ficheiros privados precisa de teste num ambiente de homologação.

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

## Venda fechada, moderação e publicações recorrentes

Aplique as migrações 14 a 17 em `supabase/migrations`, por ordem, depois das migrações
12 e 13 e da configuração do CRM existente. Atualize a aplicação depois da base.

Em bases que já receberam 12 a 16, execute apenas `17_whatsapp_schedule_compatibility.sql`
no SQL Editor. A migração permite que a agenda guarde mensagens sem preencher a coluna
antiga `phone`, mantém o histórico e aplica o isolamento entre contas na agenda.

Depois, aplique `18_agentx_operations.sql`. A migração restringe a função SQL administrativa
à credencial de servidor e permite ao painel diagnosticar as restrições que impedem
agendar contactos, grupos e Status. As duas migrações podem ser executadas novamente.

- Uma consulta comercial pode criar ou atualizar o lead. Um pedido novo fica ligado ao lead
  e aparece em **Vendas & Pedidos** com pagamento pendente. Repetir a mesma mensagem
  de compra do WhatsApp devolve o pedido original. Na revisão manual confirmada, a venda
  fecha o lead e baixa o stock uma vez. O stock é verificado na criação e na confirmação.
  A criação do pedido não reserva unidades.
- Em **Grupos**, active as regras de cada grupo e configure as boas-vindas. A remoção de
  mensagens exige uma conta administradora e preserva as mensagens dos administradores.
  O histórico mostra o resultado recebido do WhatsApp.
- Selecione um grupo para pesquisar membros, publicar um anúncio ou abrir o agendamento
  com o grupo selecionado. A conta administradora pode alterar o nome e a descrição,
  limitar quem escreve ou edita, ativar aprovação de novos membros e decidir os pedidos.
  Em **Convites e pedidos de entrada**, pode copiar o link ou revogá-lo e gerar outro.
  Se a privacidade impedir adicionar alguém pelo número, o WhatsApp exige um convite.
- Em **Disparos Programados**, selecione **Status** ou **Anúncio de grupo** e escolha
  uma publicação única, diária ou semanal. Os anúncios de grupo aceitam texto e exigem
  que a conta ligada possa publicar. O envio confirmado cria uma única ocorrência futura.
  Para parar uma série, elimine ou edite a próxima ocorrência pendente.
