import {
  Bell, Bot, CalendarCheck, Clock, Download, ListChecks, Megaphone, MessageCircle, Mic,
  Package, ShieldCheck, Terminal, UserRoundPlus, UsersRound, Workflow,
  type LucideIcon
} from "lucide-react";

export const guideGroups = ["Começar", "Atendimento e vendas", "Operação diária"] as const;
export const whatsappCommandsSettingsPath = "/settings?tab=profile#whatsapp-comandos";

export const whatsappCommandExamples = [
  { label: "Ajuda", text: "/agentx", detail: "Pede a lista de comandos disponíveis." },
  { label: "Mensagens por ler", text: "/agentx mensagens", detail: "Consulta as mensagens por ler." },
  { label: "Leads recentes", text: "/agentx leads", detail: "Vê os leads recentes e as suas etapas." },
  { label: "Agenda", text: "/agentx agenda", detail: "Consulta os próximos envios agendados." },
  { label: "Pedidos", text: "/agentx pedidos", detail: "Vê os pedidos recentes e os seus estados." },
  { label: "Comprovativos", text: "/agentx comprovativos", detail: "Consulta os comprovativos pendentes. A aprovação é feita no painel." },
  { label: "Pausar IA", text: "/agentx pausar 258841234567 | Atendimento em curso", detail: "Pausa a IA na conversa do cliente. O motivo é opcional." },
  { label: "Retomar IA", text: "/agentx retomar 258841234567", detail: "Volta a ativar a IA na conversa do cliente." },
  { label: "Publicar Status", text: "/agentx status Horário de hoje", detail: "Publica o texto no Status do número ligado." },
  { label: "Agendar Status", text: "/agentx agendar-status amanhã às 09:00 | Novidades da loja", detail: "Guarda uma publicação de texto na Agenda." },
  { label: "Agendar mensagem", text: "/agentx agendar 258841234567 | amanhã às 09:00 | Bom dia!", detail: "Agenda uma mensagem de texto para o cliente indicado." }
];

type Guide = {
  id: string;
  group: typeof guideGroups[number];
  title: string;
  summary: string;
  icon: LucideIcon;
  steps: Array<{ title: string; detail: string; link?: { label: string; to: string } }>;
  action: { label: string; to: string };
  note?: { title: string; detail: string };
  commands?: Array<{ text: string; detail: string }>;
  keywords?: string;
};

export const guides: Guide[] = [
  {
    id: "quick-start",
    group: "Começar",
    title: "Ligar o WhatsApp",
    summary: "Prepara o teu número e confirma que consegues receber e responder a uma mensagem.",
    icon: ListChecks,
    action: { label: "Abrir ligação WhatsApp", to: "/dashboard#ligar-whatsapp" },
    steps: [
      { title: "Entra no AgentX", detail: "No ecrã de acesso, usa Criar conta se ainda não tens uma. Depois abre Início e encontra o cartão de ligação ao WhatsApp." },
      { title: "Liga o teu número", detail: "No telemóvel, abre WhatsApp → Aparelhos ligados → Ligar um aparelho e lê o QR apresentado no painel. A opção por código permite emparelhar com o número de telefone." },
      { title: "Faz um teste de atendimento", detail: "Depois de a ligação aparecer como ativa, envia uma mensagem a partir de outro número. Abre Mensagens, escolhe a conversa e responde.", link: { label: "Escolher um percurso para o primeiro teste", to: "#first-test" } }
    ],
    note: { title: "Se a ligação cair", detail: "Consulta o estado em Início. O AgentX tenta recuperar de falhas temporárias. Quando for necessário voltar a emparelhar, o painel apresenta um novo QR ou código." },
    keywords: "conectar qr code emparelhamento pareamento login número whatsapp business"
  },
  {
    id: "first-test",
    group: "Começar",
    title: "Preparar o primeiro teste",
    summary: "Segue o percurso da tua loja, clínica ou salão, ou prepara a moderação de um grupo.",
    icon: ListChecks,
    action: { label: "Preparar primeiro teste", to: "/onboarding" },
    steps: [
      { title: "Loja", detail: "Liga o WhatsApp, cria um produto com preço e stock, guarda um método de pagamento e ativa o agente de vendas. Envia o nome do produto de outro número e responde «peço 1». Confere o prazo de reserva no pedido e cancela o teste para devolver o stock à loja.", link: { label: "Seguir o percurso Loja", to: "/onboarding?percurso=loja" } },
      { title: "Clínica ou salão", detail: "Liga o WhatsApp, cria um serviço ativo, regista os profissionais e define um horário livre. Abre o link público numa aba privada, faz uma marcação e confirma que aparece na Agenda. Usa Gerir marcação para cancelar o teste.", link: { label: "Seguir o percurso Clínica ou salão", to: "/onboarding?percurso=marcacoes" } },
      { title: "Gestão de grupos", detail: "Escolhe um grupo de teste em que a conta ligada é administradora. Configura Imagens como Enviar para revisão. Envia uma imagem de outra conta, confirma a ocorrência na Fila de revisão e seleciona Marcar como revista.", link: { label: "Seguir o percurso Gestão de grupos", to: "/onboarding?percurso=grupos" } }
    ],
    note: { title: "Progresso do percurso", detail: "Depois de concluíres cada passo, assinala-o em Primeiro teste. A lista fica guardada neste navegador para a tua conta." },
    keywords: "onboarding configuração primeiros passos loja clínica salão grupos tutorial teste"
  },
  {
    id: "messages-inbox",
    group: "Atendimento e vendas",
    title: "Conversas e atendimento",
    summary: "Responde no WhatsApp, cita uma mensagem e assume o atendimento quando for preciso.",
    icon: MessageCircle,
    action: { label: "Abrir Mensagens", to: "/messages" },
    steps: [
      { title: "Abre a conversa", detail: "Encontra o contacto na lista de Mensagens. Usa Carregar mensagens anteriores para consultar uma parte mais antiga do histórico." },
      { title: "Responde com contexto", detail: "Numa mensagem de texto guardada, escolhe Responder para a citar. Escreve a resposta e envia, ou usa Agendar mensagem para definir uma hora." },
      { title: "Assume o atendimento", detail: "Usa o filtro Humano para encontrar conversas com a IA pausada, incluindo as que o agente encaminhou. Para assumir outra conversa, seleciona Assumir Conversa. Depois de responderes, usa Retomar IA quando quiseres voltar a ativá-la." },
      { title: "Guarda notas internas", detail: "Abre o perfil CRM do contacto, escreve em Notas Internas e guarda. A nota fica disponível no painel para consulta." }
    ],
    keywords: "inbox chat citação atendimento humano notas etiquetas contacto"
  },
  {
    id: "voice-audio",
    group: "Atendimento e vendas",
    title: "Notas de voz e ficheiros",
    summary: "Grava e ouve uma nota de voz, ou anexa um ficheiro na conversa.",
    icon: Mic,
    action: { label: "Abrir Mensagens", to: "/messages" },
    steps: [
      { title: "Grava uma nota", detail: "Abre uma conversa, seleciona o microfone e autoriza o acesso no navegador. Termina a gravação para ouvir a prévia." },
      { title: "Confere e envia", detail: "Ouve a gravação e envia quando estiver pronta. Se preferires, descarta-a e grava outra. Também podes ouvir as notas já recebidas no histórico." },
      { title: "Anexa um ficheiro", detail: "Usa o botão de anexar para escolher uma imagem, um vídeo, um áudio ou um documento. Revê o anexo e o destinatário antes de enviar." }
    ],
    note: { title: "Citação e multimédia", detail: "Uma resposta citada aceita texto. Remove a citação do rascunho para gravar ou enviar um anexo." },
    keywords: "audio microfone ptt mídia multimédia anexo imagem documento gravar ouvir"
  },
  {
    id: "leads-funnel",
    group: "Atendimento e vendas",
    title: "Contactos e leads",
    summary: "Mantém a agenda de clientes organizada e acompanha as oportunidades de venda.",
    icon: UserRoundPlus,
    action: { label: "Abrir Leads", to: "/leads" },
    steps: [
      { title: "Guarda o número do cliente", detail: "Em Contactos, cria ou importa contactos com o número de telefone. Usar o indicativo do país ajuda a identificar o mesmo contacto mesmo quando o número aparece com espaços ou sinais." },
      { title: "Acompanha o interesse", detail: "O agente pode registar interesse quando o cliente interage com o catálogo. Abre Leads para consultar as oportunidades, o contacto associado e a etapa no funil. Atualiza a etapa e regista as informações úteis para o seguimento." },
      { title: "Consulta a origem", detail: "Se o cliente tiver usado o link de uma promoção, abre o lead e consulta Origem · Campanhas do catálogo. A informação liga o interesse à campanha e ao grupo." }
    ],
    keywords: "crm importar telefone número funil kanban cliente duplicado atribuição"
  },
  {
    id: "ai-agent",
    group: "Atendimento e vendas",
    title: "Configurar o agente IA",
    summary: "Configura o agente para responder sobre o teu negócio e acompanhar pedidos.",
    icon: Bot,
    action: { label: "Abrir Agente IA", to: "/agent" },
    steps: [
      { title: "Configura o fornecedor de IA", detail: "Em Agente IA, escolhe um fornecedor e um modelo, preenche a configuração pedida e testa a ligação antes de ativar o agente." },
      { title: "Define o papel do agente", detail: "Escolhe Vendas ou Multifuncional para o percurso comercial. Escreve instruções que expliquem o que vendes, como atendes e quando o agente deve encaminhar a conversa para uma pessoa." },
      { title: "Testa com o teu catálogo", detail: "Publica um produto ativo. A partir de outro número, pergunta pelo produto e pelo preço. Em seguida testa um pedido e confirma se o lead e o pedido aparecem no painel." }
    ],
    note: { title: "Avisos de atendimento humano", detail: "Em Configurações → Meu Perfil → Comandos e avisos pelo WhatsApp, guarda o número do administrador com o indicativo do país. Com a ligação ativa, o AgentX tenta avisar esse número quando a IA encaminha uma conversa. Se o número não puder ser usado, tenta o primeiro número adicional elegível. Na falta de um número separado elegível, o aviso pode aparecer na conversa do número ligado consigo mesmo. Abre Mensagens e usa o filtro Humano para responder." },
    keywords: "inteligência artificial gemini bot catálogo vendedor teste humano configuração"
  },
  {
    id: "seller-catalog",
    group: "Atendimento e vendas",
    title: "Catálogo, pedidos e entregas",
    summary: "Publica produtos, fecha pedidos no WhatsApp e acompanha a reserva de stock e a entrega.",
    icon: Package,
    action: { label: "Abrir Catálogo e pedidos", to: "/orders" },
    steps: [
      { title: "Cria o produto", detail: "Em Catálogo e pedidos, escolhe Novo Produto. Guarda o nome, o preço, o stock, a categoria e a descrição que o agente pode usar na conversa. Para entrega pelo WhatsApp, anexa um PDF, EPUB ou imagem JPEG, PNG ou WebP de até 20 MiB, ou indica o conteúdo a entregar.", link: { label: "Abrir catálogo", to: "/orders?tab=products" } },
      { title: "Aceita a proposta no WhatsApp", detail: "Pede o catálogo ou pergunta pelo nome do produto. O agente usa o preço e o stock disponível. Responde «peço 1» à proposta atual para aceitar. A proposta dura 10 minutos e continua disponível se o servidor reiniciar nesse intervalo." },
      { title: "Acompanha a reserva", detail: "Depois da aceitação, o agente dá as instruções de pagamento quando consegue reservar as unidades. O prazo é de 30 minutos, indicado na hora de Maputo. Um comprovativo recebido a tempo mantém a reserva durante a revisão. A reserva termina se o pedido for cancelado, rejeitado ou se expirar sem comprovativo. O stock total baixa quando o pagamento é aprovado.", link: { label: "Consultar pedidos e reservas", to: "/orders?tab=orders" } },
      { title: "Acompanha a entrega", detail: "Após a aprovação, o AgentX pode enviar o ficheiro ou conteúdo preparado pelo WhatsApp. Consulta Entregas por concluir no Vendedor. Para um pedido pago que precisa de intervenção, abre a tarefa em Equipa e tarefas.", link: { label: "Ver como recuperar uma entrega", to: "#seller-notices" } }
    ],
    note: { title: "Pedidos anteriores sem prazo", detail: "Os pedidos criados antes das reservas podem aparecer sem prazo. Nesses casos, confirma o stock e os dados de pagamento com a equipa antes de pedir uma transferência. Se o cliente já pagou, revê o comprovativo desse pedido." },
    keywords: "stock inventário proposta peço 1 prazo reinício último item cancelamento encomenda pedido digital ebook epub pdf entrega"
  },
  {
    id: "seller-payments",
    group: "Atendimento e vendas",
    title: "Aprovar comprovativos",
    summary: "Recebe comprovativos no WhatsApp, abre o anexo privado e confirma o pagamento no painel.",
    icon: ShieldCheck,
    action: { label: "Abrir Comprovativos pendentes", to: "/orders?tab=verifications" },
    steps: [
      { title: "Configura os meios de pagamento", detail: "Em Vendedor → Pagamento e avisos, guarda o destinatário e o titular para M-Pesa, e-Mola ou transferência bancária. Indica o WhatsApp que deve receber os avisos de comprovativos.", link: { label: "Configurar pagamentos no Vendedor", to: "/seller#seller-payment" } },
      { title: "Pede o comprovativo no WhatsApp privado", detail: "O cliente usa o mesmo número do pedido e envia o SMS do prestador, uma foto JPEG, PNG ou WebP, ou um PDF de até 5 MB. Pede que escreva o código AGX do pedido na legenda do ficheiro e o envie antes do fim da reserva." },
      { title: "Confirma a associação ao pedido", detail: "O AgentX associa o ficheiro pelo código AGX ou quando identifica um único pedido elegível do remetente. Quando há vários pedidos possíveis, pede ao cliente que reenvie o ficheiro com um único código na legenda. Um comprovativo identificado sem pedido disponível aparece na fila da equipa.", link: { label: "Consultar tarefas de comprovativos", to: "/team" } },
      { title: "Confere o dinheiro com o prestador", detail: "O AgentX pode aproveitar o valor, a referência ou o titular que apareçam no SMS ou na legenda. Em Equipa e tarefas, abre Comprovativo por rever e usa Descarregar comprovativo para ler a foto ou o PDF. Confere diretamente no M-Pesa, e-Mola ou banco a entrada do valor na conta certa. Só então seleciona Rever e aprovar e assinala a confirmação." },
      { title: "Trata as divergências", detail: "Se o dinheiro não estiver confirmado ou se houver divergências no valor, titular ou destinatário, consulta o pedido e usa Rejeitar com o motivo. Num pedido sem associação, pede ao cliente que reenvie o ficheiro com o código AGX e marca a tarefa como tratada depois de esclareceres o caso." }
    ],
    note: { title: "Quem pode confirmar pagamentos", detail: "A decisão é feita no painel pelo titular ou pelo responsável financeiro da empresa. O aviso no WhatsApp serve para indicar que existe um comprovativo para rever." },
    keywords: "mpesa m-pesa emola e-mola transferência banco recibo foto imagem jpeg png webp pdf anexo conversa privada código referência agx pagamento ambíguo invalidação"
  },
  {
    id: "seller-team",
    group: "Atendimento e vendas",
    title: "Equipa e tarefas da loja",
    summary: "Partilha a loja com vendedores e responsáveis financeiros, cada um com a sua conta e as suas permissões.",
    icon: UsersRound,
    action: { label: "Abrir Equipa e tarefas", to: "/team" },
    steps: [
      { title: "Associa a loja à empresa", detail: "Como titular, abre Equipa e tarefas e escolhe A minha loja. Em Ativar equipa, seleciona uma empresa existente ou indica o nome para criar uma. Usa Associar loja para que a equipa passe a acompanhar os pedidos do WhatsApp já ligado à loja." },
      { title: "Atribui uma função a cada membro", detail: "Seleciona a empresa na lista Loja. Em Membros, escreve o email confirmado da conta AgentX da pessoa. Escolhe Vendedor ou Responsável financeiro e seleciona Guardar acesso. Para alterar a função, guarda novamente o mesmo email. Usa Remover quando a pessoa deixar a equipa." },
      { title: "Trabalha na mesma fila", detail: "Cada pessoa entra com a sua conta e abre a empresa em Equipa e tarefas. O vendedor cria produtos, atualiza os ficheiros a entregar, cancela pedidos que aguardam pagamento e trata das entregas. O responsável financeiro consulta comprovativos, confere o recebimento no prestador e decide se deve aprovar ou rejeitar. A fila abre o pedido correspondente e mostra as ações de cada função." },
      { title: "Verifica o registo das decisões", detail: "As decisões de pagamento e as ações de pedido registam a conta que as executou. O titular pode consultar o histórico para acompanhar o que aconteceu e a equipa pode confirmar o estado no pedido." }
    ],
    keywords: "equipe equipa loja empresas multiempresa membro convite email confirmado permissões funções vendedor financeiro titular auditoria fila partilhada"
  },
  {
    id: "catalog-campaigns",
    group: "Atendimento e vendas",
    title: "Campanhas do catálogo",
    summary: "Publica ofertas em grupos e identifica as conversas iniciadas pela campanha.",
    icon: Megaphone,
    action: { label: "Abrir Campanhas do catálogo", to: "/seller#campanhas" },
    steps: [
      { title: "Prepara a campanha", detail: "Em Vendedor → Campanhas do catálogo, seleciona Abrir campanhas. Escolhe um produto ativo com stock e adiciona a fotografia da promoção, em JPEG, PNG ou WebP, até 5 MiB." },
      { title: "Revê a publicação", detail: "Escolhe um grupo onde a conta ligada pode escrever. Seleciona Rever publicação para conferir a fotografia, o preço e o stock disponível. As unidades já reservadas ficam fora da disponibilidade apresentada. Depois confirma a publicação imediata ou define uma data." },
      { title: "Gere a fila", detail: "Enquanto a publicação estiver pendente, usa Reagendar ou Cancelar agendamento. Confere o estado antes de enviar outra promoção." },
      { title: "Acompanha o lead", detail: "A publicação inclui um link para conversar em privado. Quando o cliente envia a mensagem por esse link, o AgentX guarda a origem no lead." }
    ],
    keywords: "promoção grupo vendas origem fotografia preço stock whatsapp wa.me campanha"
  },
  {
    id: "digital-file-delivery",
    group: "Atendimento e vendas",
    title: "Downloads privados no AgentX",
    summary: "Usa Entrega de ficheiros quando o cliente precisa de descarregar uma compra na sua conta AgentX.",
    icon: Download,
    action: { label: "Abrir Entrega de ficheiros", to: "/digital-orders" },
    steps: [
      { title: "Prepara o ficheiro", detail: "Seleciona a empresa em Entrega de ficheiros. Se ainda não tiveres uma, abre Configuração → Criar empresa. Em Criar pedido digital, escolhe o ficheiro de até 20 MiB e seleciona Guardar ficheiro privado." },
      { title: "Associa a compra à conta do cliente", detail: "Pede ao cliente o código em As minhas compras → Identificador de comprador. Introduz esse código, o telefone, o montante e a moeda. Confere o identificador do ficheiro preenchido pelo painel e cria o pedido." },
      { title: "Confirma o pagamento", detail: "O cliente abre As minhas compras e envia o texto do comprovativo ou um anexo JPEG, PNG ou PDF de até 5 MiB. O titular ou responsável financeiro revê o pedido e confirma o recebimento junto do prestador." },
      { title: "Descarrega a compra", detail: "Quando a entrega estiver disponível, o cliente pode usar Descarregar ficheiro na sua conta. Guardar confirmação descarrega um registo do pagamento sem valor fiscal." }
    ],
    keywords: "pedidos digitais comprador download segurança ficheiro privado compra recibo confirmação sem valor fiscal"
  },
  {
    id: "seller-notices",
    group: "Operação diária",
    title: "Recuperar avisos e entregas",
    summary: "Consulta o que ficou pendente, volta a tentar um envio seguro e trata os casos que precisam de confirmação.",
    icon: Bell,
    action: { label: "Abrir Equipa e tarefas", to: "/team" },
    steps: [
      { title: "Abre a fila da loja", detail: "Em Equipa e tarefas, seleciona a loja. A fila reúne comprovativos, avisos e entregas que exigem atenção, de acordo com a tua função. Abre a tarefa para consultar o pedido correspondente." },
      { title: "Recupera um aviso por enviar", detail: "Quando o WhatsApp está desligado antes do envio, o servidor tenta novamente. Se a fila mostrar Voltar a tentar, confirma a ligação e o número de destino antes de selecionar essa ação. Para os avisos de comprovativo, o titular pode corrigir o número em Vendedor → Pagamento e avisos.", link: { label: "Ver pagamento e avisos", to: "/seller#seller-payment" } },
      { title: "Confere um envio por confirmar", detail: "Quando o WhatsApp não confirma um aviso, abre o histórico da conversa antes de enviar outra mensagem. Se um aviso de atendimento humano ficar pendente, o titular pode abrir a conversa a partir da tarefa e responder." },
      { title: "Resolve uma entrega", detail: "Na fila, abre Entrega pendente ou Entrega por confirmar. Num pedido pago, usa Tentar entrega quando a ação estiver disponível. Se aparecer Rever entrega, confere a conversa e confirma com o cliente a receção dos itens antes de registar a entrega." }
    ],
    keywords: "recuperação fila intervenção avisos notificações tentativa retry reenviar falha offline erro ambíguo envio por confirmar entrega pendente confirmação"
  },
  {
    id: "groups-schedule",
    group: "Operação diária",
    title: "Gerir grupos",
    summary: "Configura horários, moderação, catálogo e comprovativos para cada grupo do WhatsApp.",
    icon: UsersRound,
    action: { label: "Abrir Grupos", to: "/groups" },
    steps: [
      { title: "Escolhe o grupo", detail: "Com o WhatsApp ligado, abre Grupos e seleciona um dos grupos da conta. Consulta os membros e o estado de escrita. Com o acesso necessário, podes adicionar ou remover participantes, gerir pedidos de entrada e alterar quem pode escrever." },
      { title: "Define horários e boas-vindas", detail: "Ativa as regras do grupo e escreve a mensagem de boas-vindas. Define domínios permitidos, palavras bloqueadas e proteções contra repetições ou excesso de mensagens. Em Horários e moderação, configura os dias, as horas de abertura e fecho e o fuso horário." },
      { title: "Escolhe a ação de cada regra", detail: "Em Ações de moderação e vendas, escolhe Permitir, Avisar, Apagar ou Enviar para revisão. Podes definir ações distintas para imagens, vídeos, ficheiros de áudio, notas de voz, documentos e outros tipos. Personaliza o aviso com {membro}, {motivo} e {grupo}." },
      { title: "Revê as ocorrências", detail: "Consulta o Histórico de avisos e a Fila de revisão. Uma regra de revisão regista a ocorrência para avaliação e mantém a mensagem no grupo. Depois de verificar, seleciona Marcar como revista ou Arquivar." },
      { title: "Ativa vendas e promoções", detail: "Em Vendas neste grupo, permite /loja ou /loja seguido do nome do produto. O catálogo aparece no grupo e o cliente abre a conversa privada para comprar. Usa Agendar promoção para publicar uma oferta do catálogo no grupo.", link: { label: "Ver o guia de campanhas", to: "#catalog-campaigns" } },
      { title: "Recebe comprovativos com o código do pedido", detail: "Como administrador, ativa Comprovativos no grupo para aceitar comprovativos nesse grupo. O cliente envia o comprovativo a partir do número do pedido e inclui um único código AGX no texto ou na legenda do anexo. O responsável financeiro confirma o recebimento no painel.", link: { label: "Ver o guia de comprovativos", to: "#seller-payments" } }
    ],
    note: { title: "Permissões do WhatsApp", detail: "Alterar os acessos, moderar mensagens e gerir participantes exige privilégios no grupo. Confirma a permissão do número ligado e o resultado apresentado pelo WhatsApp." },
    keywords: "anti-link anti-spam antiflood moderação palavra avisos ban fechar abrir administrador promoção campanhas vendas /loja agx revisão imagem áudio vídeo boas-vindas"
  },
  {
    id: "schedule-messages",
    group: "Operação diária",
    title: "Agendar mensagens e Status",
    summary: "Guarda o envio na Agenda e acompanha o estado em vez de depender de uma aba aberta.",
    icon: Clock,
    action: { label: "Abrir Mensagens e publicações", to: "/schedule" },
    steps: [
      { title: "Escolhe o destino", detail: "Abre Mensagens e publicações e seleciona Novo Agendamento. Escolhe um contacto, um grupo autorizado ou o Status do WhatsApp." },
      { title: "Confere conteúdo e data", detail: "Preenche o texto ou escolhe um anexo aceite para o destino. Para Status, usa texto, imagem ou vídeo. Confere a data e a hora no fuso indicado. Quando disponível, usa Repetir publicação para grupos ou Status." },
      { title: "Consulta a Agenda", detail: "Depois de guardar, verifica o envio na lista. O servidor processa a publicação na data marcada. Edita ou cancela enquanto estiver pendente. Se o envio ficar por confirmar, revê a conversa ou o Status antes de voltar a enviar." }
    ],
    note: { title: "Agendar a partir do chat", detail: "Em Mensagens, escreve uma resposta de texto e escolhe Agendar mensagem. Podes manter uma citação de texto da mesma conversa." },
    keywords: "status stories post envio data programar recorrência calendário hora maputo"
  },
  {
    id: "appointments-system",
    group: "Operação diária",
    title: "Marcações e lembretes",
    summary: "Publica horários, permite remarcar ou cancelar e acompanha lembretes de atendimento.",
    icon: CalendarCheck,
    action: { label: "Abrir Marcações e lembretes", to: "/appointments" },
    steps: [
      { title: "Define o que pode ser marcado", detail: "Cria um serviço ativo em Serviços & Preços, com duração e preço. Regista os profissionais e os períodos de atendimento, incluindo dias de descanso ou pausas.", link: { label: "Abrir Serviços & Preços", to: "/appointments?tab=services" } },
      { title: "Agenda o atendimento", detail: "Em Agenda & Horários, cria a marcação com cliente, contacto, serviço, data e hora. Partilha o endereço em Link de Agendamento para o cliente escolher um horário livre.", link: { label: "Abrir Link de Agendamento", to: "/appointments?tab=share" } },
      { title: "Remarca ou cancela pelo link privado", detail: "Depois de marcar pelo link público, o cliente guarda o endereço privado Gerir marcação. Nesse ecrã, usa Remarcar para escolher um novo horário livre ou Cancelar marcação. A equipa vê o novo estado em Agenda & Horários." },
      { title: "Acompanha os lembretes", detail: "Com um número de cliente válido e o WhatsApp ligado, consulta no painel os lembretes de 24 h e 2 h. Também podes enviar um aviso manual. A marcação fica guardada enquanto o aviso aguarda envio.", link: { label: "Consultar lembretes", to: "/appointments?tab=reminders" } }
    ],
    keywords: "clínica salão saúde consultas horários atendimento reservas público link privado remarcar reagendar cancelar lembrete 24h 2h"
  },
  {
    id: "automations-menus",
    group: "Operação diária",
    title: "Automações e respostas rápidas",
    summary: "Prepara respostas frequentes, gatilhos por palavra e menus para o atendimento.",
    icon: Workflow,
    action: { label: "Abrir Automações", to: "/automations" },
    steps: [
      { title: "Escolhe palavras para o gatilho", detail: "Em Automações, prepara uma resposta para quando o cliente escrever uma palavra como catálogo ou horário. Confere se a regra deve corresponder ao texto completo ou apenas a uma parte." },
      { title: "Prepara atalhos e menus", detail: "Usa Respostas Rápidas para guardar mensagens que repetes ao atender. Quando o teu plano incluir Menu Inteligente, podes preparar opções para orientar o cliente." },
      { title: "Testa a regra", detail: "Envia uma mensagem a partir de outro número e confirma na conversa se o gatilho certo disparou. Ajusta as palavras que provocarem respostas fora de contexto." }
    ],
    keywords: "gatilhos filtro atalhos menu automação palavras-chave respostas bot"
  },
  {
    id: "whatsapp-commands",
    group: "Operação diária",
    title: "Comandos pelo WhatsApp",
    summary: "Consulta pedidos, leads e agenda enviando comandos do teu WhatsApp para o número ligado ao AgentX.",
    icon: Terminal,
    action: { label: "Autorizar números no perfil", to: whatsappCommandsSettingsPath },
    steps: [
      { title: "Autoriza o teu número", detail: "Em Configurações → Meu Perfil → Comandos e avisos pelo WhatsApp, preenche Número WhatsApp do administrador com indicativo do país. Usa Números adicionais autorizados para acrescentar outros números, separados por vírgula. Guarda as alterações." },
      { title: "Envia um comando à empresa", detail: "No WhatsApp de um número autorizado, abre uma conversa individual com o número ligado ao AgentX. Com a ligação ativa, envia /agentx para veres os comandos. A resposta chega nessa conversa." },
      { title: "Indica o número do cliente", detail: "Nos comandos de pausa, retoma ou agendamento, substitui o número do exemplo pelo número do cliente com indicativo do país." },
      { title: "Usa a conversa contigo mesmo", detail: "Também podes enviar um comando novo no chat contigo mesmo a partir do próprio número ligado." },
      { title: "Ativa o aviso de nova mensagem", detail: "Em Agente IA ou Mensagens e publicações, abre o cartão Comandos e avisos pelo WhatsApp e ativa Avisar no número ligado quando um cliente escrever. O AgentX envia até um aviso por contacto a cada 30 minutos.", link: { label: "Abrir os avisos em Agente IA", to: "/agent" } }
    ],
    note: { title: "Autorizações no painel e no WhatsApp", detail: "Para enviar comandos pelo WhatsApp, autoriza o número no perfil. Para rever pagamentos no painel, atribui a função de responsável financeiro em Equipa e tarefas." },
    commands: whatsappCommandExamples,
    keywords: "comando dono operador administrador gerente autorização número separado chat privado status agendar-status"
  }
];

function searchable(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt");
}

export function searchGuides(query: string) {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return guides;
  return guides.filter(({ id, title, summary, group, steps, action, note, commands, keywords }) => {
    const text = searchable([
      id, title, summary, group, keywords, action.label, note?.title, note?.detail,
      ...steps.flatMap(({ title: name, detail, link }) => [name, detail, link?.label]),
      ...(commands?.flatMap(({ text: command, detail }) => [command, detail]) ?? [])
    ].join(" "));
    return terms.every((term) => text.includes(term));
  });
}
