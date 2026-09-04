import React, { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { 
  Send, 
  User, 
  Phone, 
  Search, 
  Sparkles, 
  MessageSquare, 
  ChevronLeft, 
  Zap, 
  List, 
  X, 
  Mic, 
  Bot, 
  UserCheck, 
  PanelRightClose, 
  PanelRightOpen, 
  Tag, 
  Plus,
  ExternalLink,
  FileText,
  TrendingUp,
  Save,
  Clock,
  CheckCheck
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";
import { useActivation } from "../lib/useActivation";
import { VoiceRecorder } from "../components/VoiceRecorder";
import { Contact, Message, Lead, LeadStage, LEAD_STAGES } from "../types";
import { getContactDisplay, formatPhoneNumber } from "./Contacts";

interface QuickReply {
  id: string;
  trigger: string;
  response_text: string;
  shortcut?: string;
}

interface Agent {
  id: string;
  provider: string;
  model: string;
  instructions: string;
}

type ConversationFilter = "all" | "unread" | "ai" | "human" | "leads";

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
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isActivated, loading: activationLoading } = useActivation();
  
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ConversationFilter>("all");
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const [showCrmPanel, setShowCrmPanel] = useState(true);
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  
  // CRM Panel State for current contact
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [contactNotes, setContactNotes] = useState("");
  const [contactTags, setContactTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [contactNameInput, setContactNameInput] = useState("");
  const [savingCrm, setSavingCrm] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial Load
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

        // Initial contacts fetch (all contacts without exclusion)
        const { data: initialContacts, error: contactsError } = await supabase
          .from("contacts")
          .select("*")
          .eq("user_id", uId)
          .order("last_message_at", { ascending: false, nullsFirst: false });
        
        if (contactsError) throw contactsError;
        
        if (isMounted && initialContacts) {
          setContacts(initialContacts);
          
          // Deep link support: check for phone or contactId in query params
          const phoneParam = searchParams.get("phone");
          const contactIdParam = searchParams.get("contactId");
          
          let targetContact: Contact | undefined;
          if (contactIdParam) {
            targetContact = initialContacts.find(c => c.id === contactIdParam);
          } else if (phoneParam) {
            targetContact = initialContacts.find(c => c.phone.includes(phoneParam) || phoneParam.includes(c.phone));
          }

          if (targetContact) {
            setSelectedContact(targetContact);
            setShowChatOnMobile(true);
            markConversationAsRead(targetContact.id);
          }
        }

        // Real-time contacts subscription
        const contactsChannel = supabase
          .channel('messages-contacts-sync')
          .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'contacts',
            filter: `user_id=eq.${uId}`
          }, async (payload) => {
            if (!isMounted) return;
            if (payload.new) {
              const updated = payload.new as Contact;
              setContacts(prev => {
                const idx = prev.findIndex(c => c.id === updated.id);
                if (idx >= 0) {
                  const copy = [...prev];
                  copy[idx] = { ...copy[idx], ...updated };
                  return copy.sort((a, b) => new Date(b.last_message_at || 0).getTime() - new Date(a.last_message_at || 0).getTime());
                }
                return [updated, ...prev];
              });
              if (selectedContact && selectedContact.id === updated.id) {
                setSelectedContact(prev => prev ? { ...prev, ...updated } : prev);
              }
            }
          })
          .subscribe();

        // 🔄 Polling fallback for contacts list every 3.5 seconds
        const contactsPoll = setInterval(async () => {
          if (!isMounted) return;
          try {
            const { data: refreshed } = await supabase
              .from("contacts")
              .select("*")
              .eq("user_id", uId)
              .order("last_message_at", { ascending: false, nullsFirst: false });
            if (isMounted && refreshed) {
              setContacts(prev => {
                if (refreshed.length !== prev.length || 
                    refreshed[0]?.last_message_at !== prev[0]?.last_message_at ||
                    refreshed[0]?.id !== prev[0]?.id ||
                    refreshed[0]?.unread_count !== prev[0]?.unread_count) {
                  return refreshed;
                }
                return prev;
              });
            }
          } catch (e) {}
        }, 3500);

        return () => {
          supabase.removeChannel(contactsChannel);
          clearInterval(contactsPoll);
        };
      } catch (err) {
        console.error("Messages init failed:", err);
      }
    };

    init();
    return () => { isMounted = false; };
  }, [activationLoading]);

  // Load Messages & Lead when selected contact changes
  useEffect(() => {
    if (!selectedContact || !userId) return;
    let isMounted = true;

    setContactNotes(selectedContact.notes || "");
    setContactTags(Array.isArray(selectedContact.tags) ? selectedContact.tags : []);
    setContactNameInput(selectedContact.name || "");
    setIsEditingName(false);

    const loadContactData = async () => {
      // 1. Initial messages fetch
      const { data: initialMessages } = await supabase
        .from("messages")
        .select("*")
        .eq("user_id", userId)
        .eq("contact_id", selectedContact.id)
        .order("timestamp", { ascending: true });
      
      if (isMounted && initialMessages) {
        setMessages(initialMessages);
      }

      // 2. Fetch Lead for this contact
      setLeadLoading(true);
      try {
        const { data: leadData } = await supabase
          .from("leads")
          .select("*")
          .eq("user_id", userId)
          .or(`contact_id.eq.${selectedContact.id},phone.eq.${selectedContact.phone}`)
          .maybeSingle();
        
        if (isMounted) {
          setCurrentLead(leadData || null);
        }
      } catch (e) {
        console.error("Error loading lead for contact:", e);
      } finally {
        if (isMounted) setLeadLoading(false);
      }

      // 3. Mark conversation as read
      markConversationAsRead(selectedContact.id);

      // 4. Real-time messages subscription with instant direct state append
      const messagesChannel = supabase
        .channel(`chat-${selectedContact.id}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'messages',
          filter: `user_id=eq.${userId}`
        }, (payload) => {
          if (!isMounted || !payload.new) return;
          const incoming = payload.new as any;
          if (incoming.contact_id === selectedContact.id) {
            setMessages(prev => {
              if (prev.some(m => m.id === incoming.id || (incoming.msg_id && m.msg_id === incoming.msg_id))) {
                return prev;
              }
              // Replace any matching optimistic temp message
              const clean = prev.filter(m => !(m.id.startsWith("temp-") && m.text === incoming.text && m.type === incoming.type));
              return [...clean, incoming];
            });
          }
        })
        .subscribe();

      // 🔄 Fast polling fallback for open conversation every 2.5 seconds
      const chatPoll = setInterval(async () => {
        if (!isMounted || !selectedContact?.id || !userId) return;
        try {
          const { data: latestMessages } = await supabase
            .from("messages")
            .select("*")
            .eq("user_id", userId)
            .eq("contact_id", selectedContact.id)
            .order("timestamp", { ascending: true });
          
          if (isMounted && latestMessages && latestMessages.length > 0) {
            setMessages(prev => {
              if (latestMessages.length !== prev.length || 
                  latestMessages[latestMessages.length - 1]?.id !== prev[prev.length - 1]?.id) {
                const pendingTemps = prev.filter(p => p.id.startsWith("temp-") && !latestMessages.some(l => l.text === p.text));
                return [...latestMessages, ...pendingTemps];
              }
              return prev;
            });
          }
        } catch (e) {}
      }, 2500);

      return () => {
        supabase.removeChannel(messagesChannel);
        clearInterval(chatPoll);
      };
    };

    loadContactData();
    return () => { isMounted = false; };
  }, [selectedContact?.id, userId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const markConversationAsRead = async (contactId: string) => {
    try {
      await apiFetch(`/api/whatsapp/chats/${contactId}/read`, { method: "POST" });
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, unread_count: 0 } : c));
    } catch (e) {
      // Non-blocking
    }
  };

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setShowChatOnMobile(true);
    setSearchParams({ phone: contact.phone });
  };

  const toggleAiMode = async () => {
    if (!selectedContact) return;
    const nextState = !selectedContact.ai_paused;
    try {
      const res = await apiFetch(`/api/whatsapp/chats/${selectedContact.id}/toggle-ai`, {
        method: "POST",
        body: JSON.stringify({ paused: nextState })
      });

      if (res.success) {
        setSelectedContact(prev => prev ? { ...prev, ai_paused: nextState } : null);
        setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, ai_paused: nextState } : c));
        toast.success(nextState ? "Atendimento Humano assumido (IA pausada nesta conversa)" : "IA reativada para esta conversa!");
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao alterar modo da IA");
    }
  };

  const handleSend = async (e?: React.FormEvent, mediaUrl?: string, mediaType?: string, textOverride?: string, duration?: number) => {
    if (e) e.preventDefault();
    const textToSend = (textOverride !== undefined ? textOverride : newMessage).trim();
    if ((!textToSend && !mediaUrl) || !selectedContact || !userId) return;
    if (!isActivated) {
      toast.error("Ative seu plano para enviar mensagens.");
      return;
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: any = {
      id: tempId,
      user_id: userId,
      contact_id: selectedContact.id,
      text: textToSend || (mediaType === "audio" ? "🎵 Áudio" : "Mídia"),
      type: "outbound",
      timestamp: new Date().toISOString(),
      media_url: mediaUrl,
      media_type: mediaType,
      is_automated: false,
      is_sending: true,
    };

    // 🚀 1. Instant optimistic update in conversation
    setMessages(prev => [...prev, optimisticMsg]);
    if (textOverride === undefined) setNewMessage("");
    setIsRecording(false);
    setShowQuickReplies(false);

    // 🚀 2. Instant optimistic update to sidebar contacts list
    setContacts(prev => {
      const updated = prev.map(c => {
        if (c.id === selectedContact.id) {
          return {
            ...c,
            last_message_at: optimisticMsg.timestamp,
            last_message_text: optimisticMsg.text,
          };
        }
        return c;
      });
      const active = updated.find(c => c.id === selectedContact.id);
      const rest = updated.filter(c => c.id !== selectedContact.id);
      return active ? [active, ...rest] : updated;
    });

    // 🚀 3. Send over network in background
    try {
      let clean = selectedContact.phone.replace(/\D/g, "");
      if (clean.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(clean.slice(0, 2))) {
        clean = `258${clean}`;
      }
      const targetJid = clean.startsWith("120363") ? `${clean}@g.us` : `${clean}@s.whatsapp.net`;

      const response = await apiFetch(`/api/whatsapp/send`, {
        method: "POST",
        body: JSON.stringify({
          jid: targetJid,
          to: clean,
          text: textToSend,
          mediaUrl,
          mediaType,
          duration
        }),
      });

      if (!response.success) {
        throw new Error(response.error || "Falha ao enviar mensagem");
      }

      // Mark optimistic message as sent or replace with backend saved message
      if (response.message) {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...response.message, is_sending: false } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, is_sending: false } : m));
      }
    } catch (err: any) {
      console.error("Failed to send message:", err);
      // Remove failed optimistic message and restore input text
      setMessages(prev => prev.filter(m => m.id !== tempId));
      if (!mediaUrl && textToSend && textOverride === undefined) {
        setNewMessage(textToSend);
      }
      toast.error(err.message || "Erro ao enviar mensagem.");
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
        toast.info("Sugestão de resposta gerada pela IA!");
      }
    } catch (err) {
      console.error("AI error:", err);
    } finally {
      setLoading(false);
    }
  };

  // CRM Panel Handlers
  const handleSaveContactName = async () => {
    if (!selectedContact || !contactNameInput.trim()) return;
    setSavingCrm(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ name: contactNameInput.trim() })
        .eq("id", selectedContact.id);
      
      if (error) throw error;
      
      setSelectedContact(prev => prev ? { ...prev, name: contactNameInput.trim() } : null);
      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, name: contactNameInput.trim() } : c));
      setIsEditingName(false);
      toast.success("Nome atualizado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar nome");
    } finally {
      setSavingCrm(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedContact) return;
    setSavingCrm(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ notes: contactNotes })
        .eq("id", selectedContact.id);
      
      if (error) throw error;
      setSelectedContact(prev => prev ? { ...prev, notes: contactNotes } : null);
      toast.success("Notas guardadas com sucesso!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao guardar notas");
    } finally {
      setSavingCrm(false);
    }
  };

  const handleAddTag = async () => {
    if (!selectedContact || !newTagInput.trim()) return;
    const cleanTag = newTagInput.trim();
    if (contactTags.includes(cleanTag)) {
      setNewTagInput("");
      return;
    }
    const updated = [...contactTags, cleanTag];
    setSavingCrm(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ tags: updated })
        .eq("id", selectedContact.id);
      
      if (error) throw error;
      setContactTags(updated);
      setSelectedContact(prev => prev ? { ...prev, tags: updated } : null);
      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, tags: updated } : c));
      setNewTagInput("");
      toast.success(`Etiqueta "${cleanTag}" adicionada!`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar tag");
    } finally {
      setSavingCrm(false);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedContact) return;
    const updated = contactTags.filter(t => t !== tagToRemove);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ tags: updated })
        .eq("id", selectedContact.id);
      
      if (error) throw error;
      setContactTags(updated);
      setSelectedContact(prev => prev ? { ...prev, tags: updated } : null);
      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, tags: updated } : c));
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover tag");
    }
  };

  const handleUpdateLeadStage = async (newStage: LeadStage) => {
    if (!selectedContact || !userId) return;
    try {
      if (currentLead) {
        const { data, error } = await supabase
          .from("leads")
          .update({ stage: newStage, updated_at: new Date().toISOString() })
          .eq("id", currentLead.id)
          .select()
          .single();
        
        if (error) throw error;
        setCurrentLead(data);
      } else {
        // Create lead
        const { data, error } = await supabase
          .from("leads")
          .insert({
            user_id: userId,
            contact_id: selectedContact.id,
            phone: selectedContact.phone,
            name: selectedContact.name,
            stage: newStage,
            status: newStage === 'venda_fechada' ? 'qualified' : 'new',
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (error) throw error;
        setCurrentLead(data);
      }
      toast.success("Estágio comercial atualizado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar estágio do lead");
    }
  };

  const handleUpdateLeadValue = async (val: number) => {
    if (!currentLead) return;
    try {
      const { data, error } = await supabase
        .from("leads")
        .update({ value: val, updated_at: new Date().toISOString() })
        .eq("id", currentLead.id)
        .select()
        .single();
      
      if (error) throw error;
      setCurrentLead(data);
      toast.success("Valor do negócio atualizado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar valor");
    }
  };

  // Filter Contacts for left column (Direct 1-on-1 Messages only - groups belong strictly in /groups)
  const filteredContacts = contacts.filter((c) => {
    const cleanPhone = (c.phone || "").replace(/\D/g, "");
    if (cleanPhone.startsWith("120363") || c.phone.includes("@g.us") || c.phone.includes("@broadcast") || cleanPhone.length > 13) {
      return false;
    }

    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search);
    if (!matchesSearch) return false;

    if (activeFilter === "unread") return (c.unread_count || 0) > 0;
    if (activeFilter === "ai") return !c.ai_paused;
    if (activeFilter === "human") return !!c.ai_paused;
    if (activeFilter === "leads") {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      return tags.includes("Lead") || tags.includes("Cliente") || tags.includes("Oportunidade");
    }
    return true;
  });

  return (
    <div className="flex flex-1 h-full min-h-0 gap-2 sm:gap-4 relative overflow-hidden">
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* COLUNA 1 (ESQUERDA): LISTA DE CONVERSAS & FILTROS                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Card className={cn(
        "w-full lg:w-80 shrink-0 flex flex-col overflow-hidden transition-all duration-300 border-slate-100 shadow-sm bg-white h-full",
        showChatOnMobile ? "hidden lg:flex" : "flex"
      )}>
        {/* Search Header */}
        <div className="p-3 border-b border-slate-100 space-y-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <Input 
              placeholder="Buscar conversa..." 
              className="pl-9 h-9 text-xs rounded-xl bg-slate-50 border-slate-100 focus:bg-white transition-all" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar text-[11px]">
            <button
              onClick={() => setActiveFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap",
                activeFilter === "all" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              Todas ({contacts.filter(c => {
                const p = (c.phone || "").replace(/\D/g, "");
                return !p.startsWith("120363") && !c.phone.includes("@g.us") && !c.phone.includes("@broadcast") && p.length <= 13;
              }).length})
            </button>
            <button
              onClick={() => setActiveFilter("unread")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap flex items-center gap-1",
                activeFilter === "unread" ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              Não lidas
              {contacts.filter(c => (c.unread_count || 0) > 0).length > 0 && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
            <button
              onClick={() => setActiveFilter("human")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap",
                activeFilter === "human" ? "bg-amber-500 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              Humano
            </button>
            <button
              onClick={() => setActiveFilter("ai")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap",
                activeFilter === "ai" ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              IA Ativa
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1 p-2 custom-scrollbar">
          {filteredContacts.length > 0 ? (
            filteredContacts.map((contact) => {
              const isSelected = selectedContact?.id === contact.id;
              const hasUnread = (contact.unread_count || 0) > 0;
              const isHuman = !!contact.ai_paused;
              const display = getContactDisplay(contact);

              return (
                <button
                  key={contact.id}
                  onClick={() => handleSelectContact(contact)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 group text-left relative",
                    isSelected
                      ? "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-300 shadow-sm"
                      : "hover:bg-slate-50 text-slate-700"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "h-11 w-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 shadow-sm transition-all",
                    isSelected ? "bg-emerald-600 text-white" : getColorClass(display.title)
                  )}>
                    {display.initials ? (
                      display.initials
                    ) : (
                      <User size={18} className={isSelected ? "text-white" : "text-slate-500"} />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-bold text-xs truncate pr-1">
                        {display.title}
                      </span>
                      {contact.last_message_at && (
                        <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                          {new Date(contact.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    <div className="flex justify-between items-center gap-1">
                      <p className="text-[11px] text-slate-500 truncate line-clamp-1 flex-1">
                        {contact.last_message_text || (display.subtitle ? display.subtitle : "Toque para conversar...")}
                      </p>
                      
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Status Humano vs IA */}
                        {isHuman ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-amber-100 text-amber-800 uppercase tracking-wider" title="Atendimento Humano">
                            Humano
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-800 uppercase tracking-wider" title="IA Ativa">
                            IA
                          </span>
                        )}

                        {/* Unread Counter Badge */}
                        {hasUnread && (
                          <span className="min-w-[18px] h-[18px] px-1 bg-emerald-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow-sm animate-pulse">
                            {contact.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
              <div className="h-12 w-12 bg-slate-50 rounded-2xl flex items-center justify-center mb-3 text-slate-300">
                <MessageSquare size={24} />
              </div>
              <p className="text-slate-900 font-bold text-xs mb-1">Nenhuma conversa encontrada</p>
              <p className="text-slate-400 text-[11px]">
                {search ? "Tente outro termo de busca." : "As mensagens recebidas no WhatsApp aparecerão aqui."}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* COLUNA 2 (CENTRAL): CONVERSA SELECIONADA                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Card className={cn(
        "flex-1 flex flex-col overflow-hidden transition-all duration-300 border-slate-100 shadow-sm bg-white relative h-full",
        !showChatOnMobile ? "hidden lg:flex" : "flex"
      )}>
        {selectedContact ? (
          <>
            {/* Header com Modo Humano / IA */}
            <div className="p-2 sm:p-4 border-b border-slate-100 flex items-center justify-between bg-white z-10 shrink-0 gap-1.5 sm:gap-2">
              <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="lg:hidden -ml-1 h-8 w-8 rounded-xl shrink-0" 
                  onClick={() => setShowChatOnMobile(false)}
                >
                  <ChevronLeft size={18} />
                </Button>
                
                {(() => {
                  const activeDisplay = getContactDisplay(selectedContact);
                  return (
                    <>
                      <div className={cn(
                        "h-8 w-8 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 shadow-sm",
                        getColorClass(activeDisplay.title)
                      )}>
                        {activeDisplay.initials ? (
                          activeDisplay.initials
                        ) : (
                          <User size={18} className="text-slate-500" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1 sm:gap-2">
                          <p className="font-bold text-xs sm:text-sm truncate text-slate-900">
                            {activeDisplay.title}
                          </p>
                          {selectedContact.ai_paused ? (
                            <Badge variant="warning" className="text-[8px] sm:text-[9px] uppercase font-black tracking-widest px-1.5 sm:px-2 py-0.5 shrink-0">
                              <UserCheck size={10} className="mr-0.5 sm:mr-1 inline" />
                              <span className="hidden sm:inline">Humano</span>
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-[8px] sm:text-[9px] uppercase font-black tracking-widest px-1.5 sm:px-2 py-0.5 shrink-0">
                              <Bot size={10} className="mr-0.5 sm:mr-1 inline" />
                              <span className="hidden sm:inline">IA Ativa</span>
                            </Badge>
                          )}
                        </div>
                        {activeDisplay.subtitle && (
                          <p className="text-[10px] sm:text-xs text-slate-400 font-mono mt-0.5 truncate">
                            {activeDisplay.subtitle}
                          </p>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Ações no Header */}
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/* Botão [Assumir Conversa] / [Retomar IA] */}
                <Button
                  size="sm"
                  variant={selectedContact.ai_paused ? "outline" : "default"}
                  onClick={toggleAiMode}
                  className={cn(
                    "text-xs font-bold rounded-xl transition-all shadow-sm h-8 sm:h-9 px-2 sm:px-3",
                    selectedContact.ai_paused
                      ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      : "bg-amber-500 hover:bg-amber-600 text-white"
                  )}
                  title={selectedContact.ai_paused ? "Reativar resposta da IA nesta conversa" : "Pausar IA e falar manualmente"}
                >
                  {selectedContact.ai_paused ? (
                    <>
                      <Bot size={14} className="sm:mr-1.5" />
                      <span className="hidden sm:inline">Retomar IA</span>
                      <span className="sm:hidden text-[10px]">IA</span>
                    </>
                  ) : (
                    <>
                      <UserCheck size={14} className="sm:mr-1.5" />
                      <span className="hidden sm:inline">Assumir Conversa</span>
                      <span className="sm:hidden text-[10px]">Humano</span>
                    </>
                  )}
                </Button>

                {/* Sugestão de IA */}
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 sm:h-9 sm:w-9 text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-xl shrink-0"
                  onClick={getAiSuggestion}
                  disabled={loading || messages.length === 0 || !isActivated}
                  title="Sugerir resposta profissional com IA"
                >
                  <Sparkles size={16} />
                </Button>

                {/* Toggle Painel CRM Direito */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowCrmPanel(!showCrmPanel)}
                  className={cn(
                    "h-8 w-8 sm:h-9 sm:w-9 rounded-xl transition-colors shrink-0",
                    showCrmPanel ? "bg-emerald-50 text-emerald-600" : "text-slate-400 hover:text-slate-600"
                  )}
                  title={showCrmPanel ? "Ocultar Painel CRM" : "Exibir Painel CRM"}
                >
                  <TrendingUp size={16} />
                </Button>
              </div>
            </div>

            {/* Mensagens Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/40 relative custom-scrollbar">
              {messages.length > 0 ? (
                messages.map((msg) => {
                  const isOut = msg.type === "outbound";
                  return (
                    <div
                      key={msg.id}
                      className={cn(
                        "flex flex-col max-w-[85%] sm:max-w-[70%]",
                        isOut ? "ml-auto items-end" : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "px-4 py-2.5 rounded-2xl text-xs sm:text-sm shadow-sm leading-relaxed",
                          isOut
                            ? "bg-emerald-600 text-white rounded-tr-none"
                            : "bg-white text-slate-900 border border-slate-100 rounded-tl-none"
                        )}
                      >
                        {/* Media display if present */}
                        {msg.media_url && (
                          <div className="mb-2 rounded-xl overflow-hidden bg-black/10">
                            {msg.media_type === "image" ? (
                              <img src={msg.media_url} alt="Anexo" className="max-h-60 w-auto object-cover rounded-xl" />
                            ) : msg.media_type === "audio" ? (
                              <audio controls src={msg.media_url} className="w-full max-w-[240px] my-1" />
                            ) : (
                              <div className="p-2 flex items-center gap-2 text-xs font-medium">
                                <FileText size={16} /> Anexo recebido
                              </div>
                            )}
                          </div>
                        )}
                        <span className="whitespace-pre-wrap">{msg.text}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1 font-mono">
                        {msg.is_automated && <span className="text-emerald-600 font-bold uppercase mr-1">[Auto]</span>}
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isOut && (
                          (msg as any).is_sending ? (
                            <Clock size={11} className="text-slate-400 animate-pulse ml-0.5" />
                          ) : (
                            <CheckCheck size={13} className="text-emerald-500 ml-0.5" />
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
                  <MessageSquare size={32} className="mb-2 opacity-50 text-slate-300" />
                  <p className="text-xs font-semibold">Nenhuma mensagem registrada ainda.</p>
                  <p className="text-[11px] text-slate-400">Envie uma mensagem abaixo para iniciar.</p>
                </div>
              )}
              <div ref={scrollRef} />

              {/* Quick Replies Drawer */}
              {showQuickReplies && quickReplies.length > 0 && (
                <div className="absolute bottom-4 left-4 right-4 bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-20 animate-in slide-in-from-bottom-4">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Respostas Rápidas</h4>
                    <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={() => setShowQuickReplies(false)}>
                      <X size={14} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {quickReplies.map(reply => (
                      <button
                        key={reply.id}
                        onClick={() => handleQuickReply(reply.response_text)}
                        className="text-left p-2.5 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/50 transition-all text-xs group"
                      >
                        <span className="font-bold text-slate-800 group-hover:text-emerald-700 block truncate">
                          /{reply.shortcut}
                        </span>
                        <span className="text-slate-500 text-[11px] line-clamp-1 block">
                          {reply.response_text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="p-2 sm:p-3 bg-white border-t border-slate-100 shrink-0">
              {isRecording ? (
                <VoiceRecorder 
                  onSend={(url, duration) => handleSend(undefined, url, "audio", undefined, duration)} 
                  onCancel={() => setIsRecording(false)} 
                />
              ) : (
                <form onSubmit={handleSend} className="flex gap-1.5 sm:gap-2 items-center">
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="icon" 
                    className={cn(
                      "h-8 w-8 sm:h-10 sm:w-10 shrink-0 rounded-xl transition-colors",
                      showQuickReplies ? "text-emerald-600 bg-emerald-50" : "text-slate-400 hover:text-emerald-600"
                    )}
                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                    disabled={!isActivated || quickReplies.length === 0}
                    title="Respostas Rápidas"
                  >
                    <List size={18} />
                  </Button>
                  <Button 
                    type="button"
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 text-slate-400 hover:text-emerald-600 rounded-xl"
                    onClick={() => setIsRecording(true)}
                    disabled={!isActivated}
                    title="Gravar Áudio de Voz"
                  >
                    <Mic size={18} />
                  </Button>
                  <Input
                    placeholder={selectedContact.ai_paused ? "Modo Humano ativo..." : "Digite uma mensagem..."}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="flex-1 h-9 sm:h-10 text-xs sm:text-sm rounded-xl border-slate-200 focus:ring-emerald-500/20"
                    disabled={loading || !isActivated}
                  />
                  <Button 
                    type="submit" 
                    size="icon" 
                    className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md shadow-emerald-600/20" 
                    disabled={loading || !newMessage.trim() || !isActivated}
                  >
                    <Send size={16} />
                  </Button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-4 p-8 text-center">
            <div className="h-16 w-16 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300">
              <MessageSquare size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-800">Selecione uma conversa</p>
              <p className="text-xs text-slate-400 max-w-[240px]">
                Escolha um contato na lista à esquerda para visualizar as mensagens e o painel CRM.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PAINEL LATERAL DE CRM (DESKTOP: COLUNA 3; MOBILE/TABLET: DRAWER)    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {selectedContact && showCrmPanel && (
        <>
          {/* Desktop: Coluna 3 fixada (>= xl) */}
          <Card className="w-80 shrink-0 hidden xl:flex flex-col overflow-hidden border-slate-100 shadow-sm bg-white animate-in slide-in-from-right-4 duration-300 h-full">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <User size={16} className="text-emerald-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Perfil CRM</h3>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-7 w-7 text-slate-400 hover:bg-slate-50 rounded-lg"
                onClick={() => setShowCrmPanel(false)}
              >
                <X size={14} />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar text-xs">
              {/* 1. DADOS DO CONTACTO */}
              <div className="space-y-3 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contacto</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                    onClick={() => setIsEditingName(!isEditingName)}
                  >
                    {isEditingName ? "Cancelar" : "Editar"}
                  </Button>
                </div>

                {isEditingName ? (
                  <div className="flex gap-1.5">
                    <Input 
                      value={contactNameInput} 
                      onChange={e => setContactNameInput(e.target.value)}
                      className="h-7 text-xs bg-white"
                    />
                    <Button size="sm" className="h-7 text-xs px-2 bg-emerald-600" onClick={handleSaveContactName} disabled={savingCrm}>
                      <Save size={12} />
                    </Button>
                  </div>
                ) : (
                  <p className="font-bold text-sm text-slate-900">{selectedContact.name || "Sem nome"}</p>
                )}

                <p className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                  <Phone size={12} className="text-slate-400" /> {selectedContact.phone}
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-[11px] font-bold h-8 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center gap-1.5"
                  onClick={() => navigate(`/contacts?phone=${selectedContact.phone}`)}
                >
                  <ExternalLink size={12} /> Ver no Módulo Contatos
                </Button>
              </div>

              {/* 2. OPORTUNIDADE / PIPELINE (LEAD) */}
              <div className="space-y-3 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <TrendingUp size={12} className="text-emerald-600" /> Lead / Oportunidade
                  </span>
                  {currentLead && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                      onClick={() => navigate(`/leads?phone=${selectedContact.phone}`)}
                    >
                      Ver Pipeline
                    </Button>
                  )}
                </div>

                {/* Seletor de Fase do Funil */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Estágio da Venda</label>
                  <select
                    value={currentLead?.stage || 'novo'}
                    onChange={(e) => handleUpdateLeadStage(e.target.value as LeadStage)}
                    className="w-full h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    {LEAD_STAGES.map(stage => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Valor do Negócio */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor Estimado (MT)</label>
                  <Input 
                    type="number" 
                    placeholder="0.00" 
                    className="h-8 text-xs bg-white font-mono"
                    defaultValue={currentLead?.value || 0}
                    onBlur={(e) => handleUpdateLeadValue(Number(e.target.value))}
                  />
                </div>

                {/* Intenção detectada pela IA */}
                {currentLead?.intent && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Intenção IA</span>
                    <div>
                      <Badge variant="info" className="text-[10px] font-bold uppercase px-2 py-0.5">
                        {currentLead.intent}
                      </Badge>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. ETIQUETAS (TAGS) */}
              <div className="space-y-2.5 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <Tag size={12} className="text-emerald-600" /> Etiquetas
                </span>

                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {contactTags.length > 0 ? (
                    contactTags.map(tag => (
                      <span 
                        key={tag} 
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-bold group"
                      >
                        {tag}
                        <button 
                          onClick={() => handleRemoveTag(tag)} 
                          className="text-slate-400 hover:text-red-500 ml-0.5"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">Sem etiquetas</p>
                  )}
                </div>

                <div className="flex gap-1.5 pt-1">
                  <Input 
                    placeholder="Nova tag..." 
                    value={newTagInput} 
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                    className="h-7 text-xs bg-white"
                  />
                  <Button size="sm" className="h-7 px-2.5 text-xs bg-slate-900 hover:bg-slate-800" onClick={handleAddTag} disabled={savingCrm}>
                    <Plus size={12} />
                  </Button>
                </div>
              </div>

              {/* 4. NOTAS INTERNAS */}
              <div className="space-y-2 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <FileText size={12} className="text-emerald-600" /> Notas Internas
                  </span>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                    onClick={handleSaveNotes}
                    disabled={savingCrm}
                  >
                    <Save size={11} className="mr-1" /> Salvar
                  </Button>
                </div>
                <textarea
                  value={contactNotes}
                  onChange={e => setContactNotes(e.target.value)}
                  placeholder="Ex: Cliente tem interesse no plano Pro. Ligar na sexta-feira..."
                  className="w-full h-24 p-2.5 bg-white border border-slate-200 rounded-xl text-xs resize-none outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800"
                />
              </div>
            </div>
          </Card>

          {/* Mobile e Tablet: Slide-Over Drawer (< xl) */}
          <div 
            className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs xl:hidden animate-in fade-in duration-200"
            onClick={() => setShowCrmPanel(false)}
          >
            <div 
              className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/60">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-emerald-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Perfil CRM do Contacto</h3>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-slate-400 hover:bg-slate-100 rounded-xl"
                  onClick={() => setShowCrmPanel(false)}
                >
                  <X size={16} />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar text-xs">
                {/* 1. DADOS DO CONTACTO */}
                <div className="space-y-3 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contacto</span>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                      onClick={() => setIsEditingName(!isEditingName)}
                    >
                      {isEditingName ? "Cancelar" : "Editar"}
                    </Button>
                  </div>

                  {isEditingName ? (
                    <div className="flex gap-1.5">
                      <Input 
                        value={contactNameInput} 
                        onChange={e => setContactNameInput(e.target.value)}
                        className="h-8 text-xs bg-white"
                      />
                      <Button size="sm" className="h-8 text-xs px-2.5 bg-emerald-600" onClick={handleSaveContactName} disabled={savingCrm}>
                        <Save size={12} />
                      </Button>
                    </div>
                  ) : (
                    <p className="font-bold text-sm text-slate-900">{selectedContact.name || "Sem nome"}</p>
                  )}

                  <p className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                    <Phone size={12} className="text-slate-400" /> {selectedContact.phone}
                  </p>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-[11px] font-bold h-8 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center gap-1.5"
                    onClick={() => {
                      setShowCrmPanel(false);
                      navigate(`/contacts?phone=${selectedContact.phone}`);
                    }}
                  >
                    <ExternalLink size={12} /> Ver no Módulo Contatos
                  </Button>
                </div>

                {/* 2. OPORTUNIDADE / PIPELINE (LEAD) */}
                <div className="space-y-3 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      <TrendingUp size={12} className="text-emerald-600" /> Lead / Oportunidade
                    </span>
                    {currentLead && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                        onClick={() => {
                          setShowCrmPanel(false);
                          navigate(`/leads?phone=${selectedContact.phone}`);
                        }}
                      >
                        Ver Pipeline
                      </Button>
                    )}
                  </div>

                  {/* Seletor de Fase do Funil */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Estágio da Venda</label>
                    <select
                      value={currentLead?.stage || 'novo'}
                      onChange={(e) => handleUpdateLeadStage(e.target.value as LeadStage)}
                      className="w-full h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      {LEAD_STAGES.map(stage => (
                        <option key={stage.id} value={stage.id}>
                          {stage.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Valor do Negócio */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor Estimado (MT)</label>
                    <Input 
                      type="number" 
                      placeholder="0.00" 
                      className="h-8 text-xs bg-white font-mono"
                      defaultValue={currentLead?.value || 0}
                      onBlur={(e) => handleUpdateLeadValue(Number(e.target.value))}
                    />
                  </div>

                  {/* Intenção detectada pela IA */}
                  {currentLead?.intent && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Intenção IA</span>
                      <div>
                        <Badge variant="info" className="text-[10px] font-bold uppercase px-2 py-0.5">
                          {currentLead.intent}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. ETIQUETAS (TAGS) */}
                <div className="space-y-2.5 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <Tag size={12} className="text-emerald-600" /> Etiquetas
                  </span>

                  <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                    {contactTags.length > 0 ? (
                      contactTags.map(tag => (
                        <span 
                          key={tag} 
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-bold group"
                        >
                          {tag}
                          <button 
                            onClick={() => handleRemoveTag(tag)} 
                            className="text-slate-400 hover:text-red-500 ml-0.5"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">Sem etiquetas</p>
                    )}
                  </div>

                  <div className="flex gap-1.5 pt-1">
                    <Input 
                      placeholder="Nova tag..." 
                      value={newTagInput} 
                      onChange={e => setNewTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                      className="h-8 text-xs bg-white"
                    />
                    <Button size="sm" className="h-8 px-2.5 text-xs bg-slate-900 hover:bg-slate-800" onClick={handleAddTag} disabled={savingCrm}>
                      <Plus size={12} />
                    </Button>
                  </div>
                </div>

                {/* 4. NOTAS INTERNAS */}
                <div className="space-y-2 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      <FileText size={12} className="text-emerald-600" /> Notas Internas
                    </span>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                      onClick={handleSaveNotes}
                      disabled={savingCrm}
                    >
                      <Save size={11} className="mr-1" /> Salvar
                    </Button>
                  </div>
                  <textarea
                    value={contactNotes}
                    onChange={e => setContactNotes(e.target.value)}
                    placeholder="Ex: Cliente tem interesse no plano Pro. Ligar na sexta-feira..."
                    className="w-full h-24 p-2.5 bg-white border border-slate-200 rounded-xl text-xs resize-none outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800"
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
