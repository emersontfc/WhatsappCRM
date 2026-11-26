import {
  Bot, CalendarCheck, Clock, ListChecks, Megaphone, MessageCircle, Mic,
  Package, ShieldCheck, Terminal, UserRoundPlus, UsersRound, Workflow,
  type LucideIcon
} from "lucide-react";

export const guideGroups = ["Começar", "Atendimento e vendas", "Operação diária"] as const;

type Guide = {
  id: string;
  group: typeof guideGroups[number];
  title: string;
  summary: string;
  icon: LucideIcon;
  steps: Array<{ title: string; detail: string }>;
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
      { title: "Faz um teste de atendimento", detail: "Depois de a ligação aparecer como ativa, envia uma mensagem a partir de outro número. Abre Mensagens, escolhe a conversa e responde." }
    ],
    note: { title: "Se a ligação cair", detail: "Consulta o estado em Início. O AgentX tenta recuperar de falhas temporárias. Quando for necessário voltar a emparelhar, o painel apresenta um novo QR ou código." },
    keywords: "conectar qr code emparelhamento pareamento login número whatsapp business"
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
      { title: "Assume o atendimento", detail: "Seleciona Assumir Conversa para pausar a IA naquele contacto. Usa Retomar IA quando quiseres voltar a ativá-la." },
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
      { title: "Acompanha o interesse", detail: "Abre Leads para consultar as oportunidades, o contacto associado e a etapa no funil. Atualiza a etapa e regista as informações úteis para o seguimento." },
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
    note: { title: "Quando for preciso intervir", detail: "Abre a conversa em Mensagens e usa Assumir Conversa. O histórico ajuda-te a perceber o que foi dito antes de responder." },
    keywords: "inteligência artificial gemini bot catálogo vendedor teste humano configuração"
  },
  {
    id: "seller-catalog",
    group: "Atendimento e vendas",
    title: "Catálogo, pedidos e entregas",
    summary: "Cria um produto, acompanha o pedido e entrega o ficheiro depois de confirmar o pagamento.",
    icon: Package,
    action: { label: "Abrir Catálogo e pedidos", to: "/orders" },
    steps: [
      { title: "Cadastra o produto", detail: "Em Catálogo e pedidos, escolhe Novo Produto. Preenche o nome, o preço em MT, a categoria e a descrição que o agente pode usar na conversa." },
      { title: "Prepara a entrega digital", detail: "Para um produto digital, anexa o ficheiro a entregar, como um PDF, e acrescenta instruções de entrega quando necessário. Guarda o produto e verifica que aparece no catálogo." },
      { title: "Acompanha o pedido", detail: "Vendedor mostra pedidos recentes e o que está por tratar. Abre o pedido para conferir o produto, o cliente e o estado do pagamento." },
      { title: "Verifica a entrega", detail: "Após a aprovação do pagamento, o AgentX pode enviar o ficheiro digital pelo WhatsApp. Acompanha o estado em Entregas por concluir. Se aparecer Rever entrega, abre a conversa e confirma a receção de todos os itens antes de registar a entrega." }
    ],
    note: { title: "Fotografia e ficheiro de entrega", detail: "A fotografia da campanha é selecionada em Campanhas do catálogo. O ficheiro de entrega é o anexo privado guardado no produto." },
    keywords: "stock inventário encomenda pedido digital livro ebook epub pdf produto digital"
  },
  {
    id: "seller-payments",
    group: "Atendimento e vendas",
    title: "Aprovar comprovativos",
    summary: "Configura M-Pesa, e-Mola ou banco e revê cada pagamento no painel.",
    icon: ShieldCheck,
    action: { label: "Abrir Comprovativos pendentes", to: "/orders?tab=verifications" },
    steps: [
      { title: "Configura os meios de pagamento", detail: "Em Vendedor → Pagamento e avisos, guarda o destinatário e o nome do titular para cada meio que aceitas. Podes indicar um número de WhatsApp para receber avisos." },
      { title: "Recebe o comprovativo", detail: "Pede ao cliente para enviar o comprovativo e indicar o código do pedido, sobretudo se tiver mais de um pedido aberto. O AgentX tenta extrair o valor, a referência e o titular quando estão presentes." },
      { title: "Confirma no prestador", detail: "Abre Comprovativos pendentes e seleciona Rever e aprovar. Confere no prestador a entrada do dinheiro, o valor e o destinatário antes de marcar a confirmação e aprovar no AgentX." },
      { title: "Trata as divergências", detail: "Se o valor, o titular ou o destinatário divergirem, revê o pedido e usa Rejeitar com o motivo correspondente." }
    ],
    note: { title: "Quem pode aprovar", detail: "A aprovação acontece no painel autenticado e depende das permissões da conta. O número configurado para avisos recebe a notificação." },
    keywords: "mpesa m-pesa emola e-mola transferência banco recibo referência agx pagamento invalidação"
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
      { title: "Revê a publicação", detail: "Escolhe um grupo onde a conta ligada pode escrever. Seleciona Rever publicação para conferir a fotografia, o preço e o stock. Depois confirma a publicação imediata ou define uma data." },
      { title: "Gere a fila", detail: "Enquanto a publicação estiver pendente, usa Reagendar ou Cancelar agendamento. Confere o estado antes de enviar outra promoção." },
      { title: "Acompanha o lead", detail: "A publicação inclui um link para conversar em privado. Quando o cliente envia a mensagem por esse link, o AgentX guarda a origem no lead." }
    ],
    keywords: "promoção grupo vendas origem fotografia preço stock whatsapp wa.me campanha"
  },
  {
    id: "groups-schedule",
    group: "Operação diária",
    title: "Gerir grupos",
    summary: "Organiza acessos, mensagens de boas-vindas e regras de moderação por grupo.",
    icon: UsersRound,
    action: { label: "Abrir Grupos", to: "/groups" },
    steps: [
      { title: "Escolhe o grupo", detail: "Com o WhatsApp ligado, abre Grupos e seleciona um dos grupos da conta. Consulta os membros e o estado de escrita." },
      { title: "Configura as regras", detail: "Ativa as proteções contra ligações, spam ou excesso de mensagens. Define domínios permitidos, palavras bloqueadas e o texto de boas-vindas." },
      { title: "Define horários e avisos", detail: "Em Horários e moderação, configura os dias, as horas de abertura e fecho e o fuso horário. Consulta o histórico de avisos para decidir quando é necessário intervir." },
      { title: "Gere participantes", detail: "Usa as ações disponíveis para adicionar ou remover membros, gerir pedidos de entrada e alterar quem pode escrever. Consulta o resultado devolvido pelo WhatsApp." }
    ],
    note: { title: "Permissões do WhatsApp", detail: "Alterar os acessos, moderar mensagens e gerir participantes exige privilégios no grupo. A conta ligada precisa dessas permissões no momento da ação." },
    keywords: "anti-link anti-spam antiflood moderação palavra avisos ban fechar abrir administrador"
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
      { title: "Confere conteúdo e data", detail: "Preenche o texto ou escolhe um anexo aceite para o destino. Confere a data e a hora no fuso indicado. Quando disponível, podes repetir publicações em grupos ou Status." },
      { title: "Consulta a Agenda", detail: "Depois de guardar, verifica que o envio aparece na lista. Um envio pendente pode ser editado ou cancelado. Se o envio ficar por confirmar, revê a conversa ou o Status antes de voltar a enviar." }
    ],
    note: { title: "Agendar a partir do chat", detail: "Em Mensagens, escreve uma resposta de texto e escolhe Agendar mensagem. Podes manter uma citação de texto da mesma conversa." },
    keywords: "status stories post envio data programar recorrência calendário hora maputo"
  },
  {
    id: "appointments-system",
    group: "Operação diária",
    title: "Marcações e lembretes",
    summary: "Organiza a agenda de uma clínica, salão ou outro negócio com atendimento por marcação.",
    icon: CalendarCheck,
    action: { label: "Abrir Marcações e lembretes", to: "/appointments" },
    steps: [
      { title: "Define o que pode ser marcado", detail: "Cria os serviços em Serviços & Preços e regista os profissionais e horários disponíveis para atendimento." },
      { title: "Agenda o atendimento", detail: "Usa Agenda & Horários para criar uma marcação com cliente, contacto, serviço, data e hora. Em Link de Agendamento, copia o endereço depois de ativares um serviço. Partilha-o para deixar o cliente escolher um horário disponível." },
      { title: "Acompanha os lembretes", detail: "Com um número de cliente válido e o WhatsApp ligado, acompanha os lembretes de 24 h e 2 h no painel. Também podes enviar um aviso manual. A marcação fica guardada enquanto o aviso aguarda envio." }
    ],
    keywords: "clínica salão saúde consultas horários atendimento reservas público lembrete 24h 2h"
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
    summary: "Consulta pedidos, leads e agenda no chat do teu próprio número ligado.",
    icon: Terminal,
    action: { label: "Abrir ligação WhatsApp", to: "/dashboard#ligar-whatsapp" },
    steps: [
      { title: "Abre a conversa contigo", detail: "Usa a conversa Enviar mensagem para si mesmo do número que ligaste ao AgentX. Escreve um dos comandos abaixo." },
      { title: "Indica o contacto certo", detail: "Para pausar ou retomar a IA, substitui o número de exemplo pelo número do cliente, incluindo o indicativo do país." }
    ],
    commands: [
      { text: "/agentx mensagens", detail: "Consulta as mensagens por ler." },
      { text: "/agentx leads", detail: "Vê os leads recentes e as etapas." },
      { text: "/agentx agenda", detail: "Consulta os próximos envios programados." },
      { text: "/agentx pedidos", detail: "Vê os últimos pedidos e os seus estados." },
      { text: "/agentx comprovativos", detail: "Consulta os comprovativos pendentes de revisão." },
      { text: "/agentx pausar 258841234567", detail: "Pausa a IA na conversa com esse contacto." },
      { text: "/agentx retomar 258841234567", detail: "Volta a ativar a IA na conversa." },
      { text: "/agentx status Horário de hoje", detail: "Publica o texto no Status. Usa /agentx para consultar a lista completa de comandos." }
    ],
    keywords: "comando dono operador administração chat privado status agendar-status"
  }
];

function searchable(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt");
}

export function searchGuides(query: string) {
  const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return guides;
  return guides.filter(({ title, summary, group, steps, note, commands, keywords }) => {
    const text = searchable([
      title, summary, group, keywords, note?.title, note?.detail,
      ...steps.flatMap(({ title: name, detail }) => [name, detail]),
      ...(commands?.flatMap(({ text: command, detail }) => [command, detail]) ?? [])
    ].join(" "));
    return terms.every((term) => text.includes(term));
  });
}
