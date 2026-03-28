import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, User, Phone, Search, Sparkles, MessageSquare, ChevronLeft, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";
import { useActivation } from "../lib/useActivation";
import { UpgradePrompt } from "../components/UpgradePrompt";

interface Contact {
  id: string;
  name: string;
  phone: string;
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
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activationLoading) return;
    let isMounted = true;

    const init = async () => {
      try {
        const userId = await getUserId();
        if (!userId) return;

        // Initial contacts fetch
        const { data: initialContacts } = await supabase
          .from("contacts")
          .select("*")
          .eq("user_id", userId)
          .order("name", { ascending: true });
        
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

        // Real-time contacts subscription
        const contactsChannel = supabase
          .channel('messages-contacts')
          .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'contacts',
            filter: `user_id=eq.${userId}`
          }, async () => {
            const { data: updatedContacts } = await supabase
              .from("contacts")
              .select("*")
              .eq("user_id", userId);
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
      const userId = await getUserId();
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
  }, [selectedContact]);

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
      .order("name", { ascending: true });
    
    if (updatedContacts) {
      setContacts(updatedContacts);
      toast.success("Contatos atualizados!");
    }
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setShowChatOnMobile(true);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedContact) return;
    if (!isActivated) return;

    setLoading(true);
    try {
      const phone = selectedContact.phone.replace(/\D/g, "");
      const response = await apiFetch("/api/whatsapp/send", {
        method: "POST",
        body: JSON.stringify({
          jid: `${phone}@s.whatsapp.net`,
          text: newMessage,
        }),
      });

      if (!response.success) {
        throw new Error(response.error || "Failed to send via WhatsApp");
      }

      setNewMessage("");
      toast.success("Mensagem enviada!");
    } catch (err: any) {
      console.error("Failed to send message:", err);
      toast.error(err.message || "Erro ao enviar mensagem.");
    } finally {
      setLoading(false);
    }
  };

  const getAiSuggestion = async () => {
    if (!selectedContact || messages.length === 0) return;
    setLoading(true);
    try {
      const response = await apiFetch("/api/ai/suggest", {
        method: "POST",
        body: JSON.stringify({
          messages: messages.slice(-5),
          context: { contactName: selectedContact.name }
        }),
      });
      
      if (response.success && response.data.suggestion) {
        setNewMessage(response.data.suggestion);
      }
    } catch (err) {
      console.error("AI error:", err);
    } finally {
      setLoading(false);
    }
  };

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
              placeholder="Buscar chat..." 
              className="pl-9 h-9 text-xs" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={refreshContacts}>
            <Zap size={16} className="text-emerald-600" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {contacts
            .filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search))
            .map((contact) => (
            <button
              key={contact.id}
              onClick={() => handleSelectContact(contact)}
              className={cn(
                "w-full p-3 flex items-center gap-3 hover:bg-slate-50 transition-all text-left rounded-xl border border-transparent",
                selectedContact?.id === contact.id ? "bg-emerald-50/80 border-emerald-100 shadow-sm" : "hover:border-slate-100"
              )}
            >
              <div className={cn("h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold shrink-0 shadow-sm", getColorClass(contact.name))}>
                {getInitials(contact.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("font-semibold text-sm truncate", selectedContact?.id === contact.id ? "text-emerald-900" : "text-slate-900")}>
                  {contact.name}
                </p>
                <p className="text-xs text-slate-500 truncate font-medium mt-0.5">{contact.phone}</p>
              </div>
            </button>
          ))}
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
              <div className="flex gap-1 sm:gap-2">
                <Button variant="ghost" size="icon" className="h-9 w-9 hidden sm:flex">
                  <Phone size={18} />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                  onClick={getAiSuggestion}
                  disabled={loading || messages.length === 0 || !isActivated}
                >
                  <Sparkles size={18} />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/30">
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
            </div>

            <form onSubmit={handleSend} className="p-3 sm:p-4 bg-white border-t border-slate-100 flex gap-2">
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
