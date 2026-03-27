import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, User, Phone, Search, Sparkles, MessageSquare, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";

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

export default function Messages() {
  const [searchParams] = useSearchParams();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [isActivated, setIsActivated] = useState(true);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const response = await apiFetch("/api/ai/subscription");
        if (isMounted && response.success && response.data) {
          const sub = response.data;
          if (sub?.role === "admin") {
            setIsActivated(true);
          } else {
            if (sub?.isActivated === true) {
              setIsActivated(true);
            } else if (sub?.expires_at) {
              setIsActivated(new Date(sub.expires_at) > new Date());
            } else {
              setIsActivated(false);
            }
          }
        }

        const userId = await getUserId();
        if (!userId) return;

        // Initial contacts fetch
        const { data: initialContacts } = await supabase
          .from("contacts")
          .select("*")
          .eq("user_id", userId);
        
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
  }, []);

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
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <Input placeholder="Buscar chat..." className="pl-9 h-9 text-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => handleSelectContact(contact)}
              className={cn(
                "w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50",
                selectedContact?.id === contact.id && "bg-emerald-50/50 border-emerald-100"
              )}
            >
              <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                <User size={20} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-900 truncate">{contact.name}</p>
                <p className="text-xs text-slate-500 truncate">{contact.phone}</p>
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
                <div className="h-10 w-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shrink-0">
                  <User size={20} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{selectedContact.name}</p>
                  <p className="text-xs text-emerald-600 flex items-center gap-1">
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
