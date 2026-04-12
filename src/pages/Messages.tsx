import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, User, Phone, Search, Sparkles, MessageSquare, ChevronLeft, Zap, List, X } from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";
import { useActivation } from "../lib/useActivation";
import { UpgradePrompt } from "../components/UpgradePrompt";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { Mic } from "lucide-react";

interface Contact {
  id: string;
  name: string;
  phone: string;
  last_message_at?: string;
  last_message_text?: string;
}

interface QuickReply {
  id: string;
  trigger: string;
  response_text: string;
}

interface Agent {
  id: string;
  provider: string;
  model: string;
  instructions: string;
}

interface Message {
  id: string;
  text: string;
  type: "inbound" | "outbound";
  timestamp: string;
}

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
};

const getColorClass = (name: string) => {
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-purple-100 text-purple-700',
    'bg-rose-100 text-rose-700',
    'bg-indigo-100 text-indigo-700',
    'bg-cyan-100 text-cyan-700',
    'bg-fuchsia-100 text-fuchsia-700',
  ];
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
};

export default function Messages() {
  const [searchParams] = useSearchParams();
  const { isActivated, planDetails, loading: activationLoading } = useActivation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activationLoading) return;
    let isMounted = true;

    const init = async () => {
      try {
        const uId = await getUserId();
        if (!uId || uId === "guest-user") return;
        setUserId(uId);

        // Fetch quick replies
        const response = await apiFetch("/api/packs/my");
        if (isMounted && response.success) {
          setQuickReplies(response.data);
        }

        // Fetch agents
        const { data: agentsData } = await supabase
          .from("agents")
          .select("*")
          .eq("user_id", uId)
          .eq("is_active", true);
        
        if (isMounted && agentsData) {
          setAgents(agentsData);
          if (agentsData.length > 0) {
            setSelectedAgentId(agentsData[0].id);
          }
        }

        // Initial contacts fetch
        const { data: initialContacts, error: contactsError } = await supabase
          .from("contacts")
          .select("*")
          .eq("user_id", uId)
          .order("last_message_at", { ascending: false, nullsFirst: false });
        
        if (contactsError) throw contactsError;
        
        if (isMounted && initialContacts) {
          setContacts(initialContacts);
          
          // Check for phone in query params
          const phoneParam = searchParams.get("phone");
          if (phoneParam) {
            const contact = initialContacts.find(c => c.phone === phoneParam);
            if (contact) {
              setSelectedContact(contact);
              setShowChatOnMobile(true);
            }
          }
        }

        // Fetch contacts from WhatsApp to sync names and chats
        try {
          const chatsResponse = await apiFetch("/api/whatsapp/chats");
          if (isMounted && chatsResponse.success && chatsResponse.chats) {
            // Update local state if different
            setContacts(chatsResponse.chats);
          }
        } catch (err) {
          console.error("Failed to sync chats from WhatsApp:", err);
        }

        // Real-time contacts subscription
        const contactsChannel = supabase
          .channel('messages-contacts')
          .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'contacts',
            filter: `user_id=eq.${uId}`
          }, async () => {
            const { data: updatedContacts } = await supabase
              .from("contacts")
              .select("*")
              .eq("user_id", uId)
              .order("last_message_at", { ascending: false, nullsFirst: false });
            if (isMounted && updatedContacts) setContacts(updatedContacts);
          })
          .subscribe();

        return () => {
          supabase.removeChannel(contactsChannel);
        };
      } catch (err) {
        console.error("Messages init failed:", err);
      }
    };

    init();
    return () => { isMounted = false; };
  }, [activationLoading]);

  useEffect(() => {
    if (!selectedContact) return;
    let isMounted = true;

    const initMessages = async () => {
      if (!userId) return;

      // Initial messages fetch
      const { data: initialMessages } = await supabase
        .from("messages")
        .select("*")
        .eq("user_id", userId)
        .eq("contact_id", selectedContact.id)
        .order("timestamp", { ascending: true });
      
      if (isMounted && initialMessages) {
        setMessages(initialMessages);
      }

      // Real-time messages subscription
      const messagesChannel = supabase
        .channel(`chat-${selectedContact.id}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'messages',
          filter: `user_id=eq.${userId}`
        }, async (payload) => {
          // Only update if it's for the selected contact
          if (isMounted && payload.new && (payload.new as any).contact_id === selectedContact.id) {
            const { data: updatedMessages } = await supabase
              .from("messages")
              .select("*")
              .eq("user_id", userId)
              .eq("contact_id", selectedContact.id)
              .order("timestamp", { ascending: true });
            if (isMounted && updatedMessages) setMessages(updatedMessages);
          }
        })
        .subscribe();

      return () => {
        supabase.removeChannel(messagesChannel);
      };
    };

    initMessages();
    return () => { isMounted = false; };
  }, [selectedContact, userId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const refreshContacts = async () => {
    const userId = await getUserId();
    if (!userId) return;
    
    const { data: updatedContacts } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    
    if (updatedContacts) {
      setContacts(updatedContacts);
      toast.success("Contatos atualizados!");
    }
  };

  const syncChats = async () => {
    setLoading(true);
    try {
      const response = await apiFetch("/api/whatsapp/sync", { method: "POST" });
      if (response.success && response.chats) {
        setContacts(response.chats);
        toast.success("Chats sincronizados!");
      } else {
        toast.error(response.error || "Falha ao sincronizar chats");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro na sincronização");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setShowChatOnMobile(true);
  };

  const handleSend = async (e?: React.FormEvent, mediaUrl?: string, mediaType?: string, textOverride?: string, duration?: number) => {
    if (e) e.preventDefault();
    const textToSend = textOverride !== undefined ? textOverride : newMessage;
    if ((!textToSend.trim() && !mediaUrl) || !selectedContact || !userId) return;
    if (!isActivated) return;

    setLoading(true);
    try {
      const phone = selectedContact.phone.replace(/\D/g, "");
      const response = await apiFetch(`/api/whatsapp/send`, {
        method: "POST",
        body: JSON.stringify({
          jid: `${phone}@s.whatsapp.net`,
          text: textToSend,
          mediaUrl,
          mediaType,
          duration
        }),
      });

      if (!response.success) {
        throw new Error(response.error || "Failed to send via WhatsApp");
      }

      setNewMessage("");
      setIsRecording(false);
      setShowQuickReplies(false);
      toast.success(mediaUrl ? "Áudio enviado!" : "Mensagem enviada!");
    } catch (err: any) {
      console.error("Failed to send message:", err);
      toast.error(err.message || "Erro ao enviar mensagem.");
    } finally {
      setLoading(false);
    }
  };

  const handleQuickReply = (text: string) => {
    handleSend(undefined, undefined, undefined, text);
  };

  const getAiSuggestion = async () => {
    if (!selectedContact || messages.length === 0) return;
    setLoading(true);
    try {
      const lastMessage = messages[messages.length - 1];
      const response = await apiFetch("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: lastMessage.text,
          agentId: selectedAgentId
        }),
      });
      
      if (response.reply) {
        setNewMessage(response.reply);
      }
    } catch (err) {
      console.error("AI error:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredContacts = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search)
  );

  return (
    <div className="flex h-[calc(100vh-10rem)] lg:h-[calc(100vh-12rem)] gap-0 lg:gap-6 relative">
      {/* Contact List */}
      <Card className={cn(
        "w-full lg:w-80 flex flex-col overflow-hidden transition-all duration-300",
        showChatOnMobile ? "hidden lg:flex" : "flex"
      )}>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <Input 
              placeholder="Buscar conversa..." 
              className="pl-9 h-9 text-xs" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button 
            variant="outline" 
            size="icon" 
            className="h-9 w-9 shrink-0" 
            onClick={syncChats}
            disabled={loading}
            title="Sincronizar"
          >
            <Zap size={16} className={cn("text-emerald-600", loading && "animate-pulse text-amber-500")} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1 p-2">
          {filteredContacts.length > 0 ? (
            filteredContacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => handleSelectContact(contact)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group text-left",
                  selectedContact?.id === contact.id
                    ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 shadow-sm"
                    : "hover:bg-slate-50 text-slate-600 hover:text-slate-900"
                )}
              >
                <div className={cn(
                  "h-12 w-12 rounded-full flex items-center justify-center font-semibold text-lg shrink-0",
                  selectedContact?.id === contact.id ? "bg-emerald-200" : getColorClass(contact.name || contact.phone)
                )}>
                  {getInitials(contact.name || contact.phone)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <span className="font-semibold truncate pr-2">
                      {contact.name || contact.phone}
                    </span>
                    {contact.last_message_at && (
                      <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                        {new Date(contact.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate line-clamp-1">
                    {contact.last_message_text || "Inicie uma conversa..."}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
              <div className="h-16 w-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <MessageSquare className="h-8 w-8 text-slate-300" />
              </div>
              <p className="text-slate-900 font-semibold mb-1">Nenhuma conversa encontrada</p>
              <p className="text-slate-500 text-sm max-w-[200px] mb-6">
                {search ? `Nenhum resultado para "${search}"` : "Suas conversas do WhatsApp aparecerão aqui assim que você se conectar."}
              </p>
              {!search && (
                <Button onClick={syncChats} variant="outline" size="sm" className="gap-2">
                  <Zap size={14} />
                  Sincronizar Chats
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Chat Area */}
      <Card className={cn(
        "flex-1 flex flex-col overflow-hidden transition-all duration-300",
        !showChatOnMobile ? "hidden lg:flex" : "flex"
      )}>
        {selectedContact ? (
          <>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="lg:hidden -ml-2" 
                  onClick={() => setShowChatOnMobile(false)}
                >
                  <ChevronLeft size={20} />
                </Button>
                <div className={cn("h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 shadow-sm", getColorClass(selectedContact.name))}>
                  {getInitials(selectedContact.name)}
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{selectedContact.name}</p>
                  <p className="text-xs text-emerald-600 flex items-center gap-1 font-medium mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                    Online
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                {agents.length > 1 && (
                  <select 
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                  >
                    {agents.map(agent => (
                      <option key={agent.id} value={agent.id}>
                        {agent.provider} - {agent.model}
                      </option>
                    ))}
                  </select>
                )}
                <Button variant="ghost" size="icon" className="h-9 w-9 hidden sm:flex">
                  <Phone size={18} />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                  onClick={getAiSuggestion}
                  disabled={loading || messages.length === 0 || !isActivated || !selectedAgentId}
                >
                  <Sparkles size={18} />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/30 relative">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col max-w-[85%] sm:max-w-[70%]",
                    msg.type === "outbound" ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <div
                    className={cn(
                      "px-3 py-1.5 sm:px-4 sm:py-2 rounded-2xl text-sm shadow-sm",
                      msg.type === "outbound"
                        ? "bg-emerald-600 text-white rounded-tr-none"
                        : "bg-white text-slate-900 border border-slate-100 rounded-tl-none"
                    )}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 px-1">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              <div ref={scrollRef} />

              {/* Quick Replies Overlay */}
              {showQuickReplies && quickReplies.length > 0 && (
                <div className="absolute bottom-4 left-4 right-4 bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-20 animate-in slide-in-from-bottom-4">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Respostas Rápidas</h4>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowQuickReplies(false)}>
                      <X size={14} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2">
                    {quickReplies.map(reply => (
                      <button
                        key={reply.id}
                        onClick={() => handleQuickReply(reply.response_text)}
                        className="text-left p-3 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50 transition-all group"
                      >
                        <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1">{reply.trigger}</p>
                        <p className="text-xs text-slate-600 line-clamp-2 group-hover:text-slate-900">{reply.response_text}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 sm:p-4 bg-white border-t border-slate-100">
              {isRecording ? (
                <VoiceRecorder 
                  onSend={(url, duration) => handleSend(undefined, url, "audio", undefined, duration)} 
                  onCancel={() => setIsRecording(false)} 
                />
              ) : (
                <form onSubmit={handleSend} className="flex gap-2">
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="icon" 
                    className={cn(
                      "h-10 w-10 shrink-0 transition-colors",
                      showQuickReplies ? "text-emerald-600 bg-emerald-50" : "text-slate-400 hover:text-emerald-500"
                    )}
                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                    disabled={!isActivated || quickReplies.length === 0}
                  >
                    <List size={20} />
                  </Button>
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="icon" 
                    className="h-10 w-10 shrink-0 text-slate-400 hover:text-emerald-500"
                    onClick={() => setIsRecording(true)}
                    disabled={!isActivated}
                  >
                    <Mic size={20} />
                  </Button>
                  <Input
                    placeholder={isActivated ? "Digite sua mensagem..." : "Ative sua conta"}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="flex-1 h-10 text-sm"
                    disabled={loading || !isActivated}
                  />
                  <Button type="submit" size="icon" className="h-10 w-10 shrink-0" disabled={loading || !newMessage.trim() || !isActivated}>
                    <Send size={18} />
                  </Button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-4 p-8 text-center">
            <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center">
              <MessageSquare size={40} strokeWidth={1.5} />
            </div>
            <p className="text-sm">Selecione um contato para iniciar uma conversa.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
