import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { 
  Plus, 
  Search, 
  Tag, 
  Trash2, 
  Phone, 
  User, 
  Users, 
  Send, 
  Upload, 
  X, 
  Check, 
  MessageSquare, 
  TrendingUp, 
  Bot, 
  BotOff,
  RefreshCw,
  BookOpen
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId } from "../supabase";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent } from "../components/ui/Card";
import { useActivation } from "../lib/useActivation";
import { UpgradePrompt } from "../components/UpgradePrompt";
import { Contact, Lead, LEAD_STAGES, LeadStage } from "../types";

type FilterTab = "todos" | "whatsapp" | "manuais" | "com_lead";

export function formatPhoneNumber(phone: string): string {
  if (!phone) return "";
  const clean = phone.replace(/\D/g, "");
  if (clean.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(clean.slice(0, 2))) {
    return `+258 ${clean.slice(0, 2)} ${clean.slice(2, 5)} ${clean.slice(5)}`;
  }
  if (clean.length === 12 && clean.startsWith("258")) {
    return `+258 ${clean.slice(3, 5)} ${clean.slice(5, 8)} ${clean.slice(8)}`;
  }
  if (clean.length === 11 && clean.startsWith("55")) {
    return `+55 ${clean.slice(2, 4)} ${clean.slice(4, 9)}-${clean.slice(9)}`;
  }
  if (clean.length === 13 && clean.startsWith("55")) {
    return `+55 ${clean.slice(2, 4)} ${clean.slice(4, 9)}-${clean.slice(9)}`;
  }
  if (clean.length === 11 && clean.startsWith("27")) {
    return `+27 ${clean.slice(2, 4)} ${clean.slice(4, 7)} ${clean.slice(7)}`;
  }
  return phone.startsWith("+") ? phone : (clean.length > 5 ? `+${clean}` : phone);
}

export function getContactDisplay(contact: { name?: string | null; phone: string }) {
  const cleanPhone = (contact.phone || "").replace(/\D/g, "");
  const formattedPhone = formatPhoneNumber(contact.phone);
  
  const rawName = (contact.name || "").trim();
  const isNumericOnly = !rawName || /^[\d\s+()\-#]+$/.test(rawName);
  const isSameAsPhone = rawName.replace(/\D/g, "") === cleanPhone && rawName.replace(/\D/g, "").length > 5;
  const isBogusName = rawName === "</>" || rawName === "Sem Nome" || isNumericOnly || isSameAsPhone;

  if (!isBogusName) {
    const words = rawName.split(/\s+/).filter(Boolean);
    const letters = words.map(w => w.replace(/[^\p{L}]/gu, "")).filter(Boolean);
    let initials = "";
    if (letters.length >= 2) {
      initials = (letters[0][0] + letters[1][0]).toUpperCase();
    } else if (letters.length === 1 && letters[0].length >= 2) {
      initials = letters[0].slice(0, 2).toUpperCase();
    } else if (letters.length === 1) {
      initials = letters[0][0].toUpperCase();
    }

    return {
      title: rawName,
      subtitle: formattedPhone,
      initials: initials || null,
      isRealName: true,
    };
  }

  return {
    title: formattedPhone || "Contacto WhatsApp",
    subtitle: null,
    initials: null,
    isRealName: false,
  };
}

export default function Contacts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isActivated, planDetails, loading: activationLoading } = useActivation();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [leadsMap, setLeadsMap] = useState<Record<string, Lead>>({}); // key by phone and contact_id
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("todos");

  // Drawer / Selection state
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [editingNotes, setEditingNotes] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Add Contact modal / form
  const [isAdding, setIsAdding] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", phone: "", tags: "", countryCode: "258" });
  const [syncingWhatsApp, setSyncingWhatsApp] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSyncCurrentWhatsApp = async () => {
    setSyncingWhatsApp(true);
    try {
      const data = await apiFetch("/api/whatsapp/sync-contacts", {
        method: "POST",
      });
      if (!data || !data.success) {
        throw new Error(data?.error || "Falha ao sincronizar contactos");
      }

      await fetchContactsAndLeads();
      toast.success(
        `WhatsApp sincronizado! ${data.savedCount} gravados na agenda e ${data.activeChatsCount} conversas ativas.` +
        (data.cleanedCount > 0 ? ` (${data.cleanedCount} contactos de sessões anteriores limpos)` : "")
      );
    } catch (err: any) {
      console.error("Error syncing contacts:", err);
      toast.error(err.message || "Erro ao sincronizar contactos do WhatsApp.");
    } finally {
      setSyncingWhatsApp(false);
    }
  };

  // Fetch contacts and leads
  const fetchContactsAndLeads = async () => {
    const userId = await getUserId();
    if (!userId) return;

    // 1. Fetch contacts
    const { data: contactsData, error: contactsError } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId)
      .order("name", { ascending: true });

    if (contactsError) {
      console.error("Error fetching contacts:", contactsError);
    } else if (contactsData) {
      const normalizedContacts: Contact[] = contactsData.map(c => ({
        ...c,
        tags: Array.isArray(c.tags) ? c.tags : []
      }));
      setContacts(normalizedContacts);
    }

    // 2. Fetch leads to cross-reference
    const { data: leadsData, error: leadsError } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId);

    if (leadsError) {
      console.error("Error fetching leads:", leadsError);
    } else if (leadsData) {
      const map: Record<string, Lead> = {};
      leadsData.forEach((lead: Lead) => {
        if (lead.contact_id) map[lead.contact_id] = lead;
        if (lead.phone) map[lead.phone] = lead;
      });
      setLeadsMap(map);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (activationLoading) return;
    fetchContactsAndLeads();

    // Real-time subscription for contacts
    let subscription: any;
    getUserId().then(userId => {
      if (!userId) return;
      subscription = supabase
        .channel('public:contacts_crm')
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'contacts',
          filter: `user_id=eq.${userId}`
        }, () => {
          fetchContactsAndLeads();
        })
        .subscribe();
    });

    return () => {
      if (subscription) supabase.removeChannel(subscription);
    };
  }, [activationLoading]);

  // Handle URL deep linking: ?phone=... or ?id=...
  useEffect(() => {
    const phoneParam = searchParams.get("phone");
    const idParam = searchParams.get("id") || searchParams.get("contactId");

    if (contacts.length > 0 && (phoneParam || idParam)) {
      const target = contacts.find(c => 
        (idParam && c.id === idParam) || 
        (phoneParam && c.phone === phoneParam.replace(/\D/g, ""))
      );
      if (target) {
        setSelectedContact(target);
        setEditingNotes(target.notes || "");
      }
    }
  }, [searchParams, contacts]);

  const openContactDrawer = (contact: Contact) => {
    setSelectedContact(contact);
    setEditingNotes(contact.notes || "");
    setSearchParams({ phone: contact.phone });
  };

  const closeContactDrawer = () => {
    setSelectedContact(null);
    setSearchParams({});
  };

  const handleToggleAi = async (contact: Contact) => {
    const newPaused = !contact.ai_paused;
    const now = new Date().toISOString();

    // Optimistic UI update
    setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, ai_paused: newPaused, ai_paused_at: newPaused ? now : undefined } : c));
    if (selectedContact && selectedContact.id === contact.id) {
      setSelectedContact(prev => prev ? { ...prev, ai_paused: newPaused, ai_paused_at: newPaused ? now : undefined } : null);
    }

    try {
      await supabase.from("contacts").update({
        ai_paused: newPaused,
        ai_paused_at: newPaused ? now : null
      }).eq("id", contact.id);

      await fetch(`/api/whatsapp/chats/${contact.id}/toggle-ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: newPaused })
      }).catch(() => {});

      toast.success(newPaused ? "Modo Humano ativado (IA pausada)" : "IA Ativada para este contacto");
    } catch (err) {
      console.error("Error toggling AI:", err);
      toast.error("Erro ao alternar modo da IA.");
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedContact) return;
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ notes: editingNotes })
        .eq("id", selectedContact.id);

      if (error) throw error;

      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, notes: editingNotes } : c));
      setSelectedContact(prev => prev ? { ...prev, notes: editingNotes } : null);
      toast.success("Notas guardadas!");
    } catch (err) {
      console.error("Error saving notes:", err);
      toast.error("Erro ao guardar notas.");
    } finally {
      setSavingNotes(false);
    }
  };

  const handleAddTag = async () => {
    if (!selectedContact || !newTagInput.trim()) return;
    const currentTags = Array.isArray(selectedContact.tags) ? selectedContact.tags : [];
    if (currentTags.includes(newTagInput.trim())) {
      setNewTagInput("");
      return;
    }

    const updatedTags = [...currentTags, newTagInput.trim()];
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ tags: updatedTags })
        .eq("id", selectedContact.id);

      if (error) throw error;

      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, tags: updatedTags } : c));
      setSelectedContact(prev => prev ? { ...prev, tags: updatedTags } : null);
      setNewTagInput("");
      toast.success("Tag adicionada!");
    } catch (err) {
      console.error("Error adding tag:", err);
      toast.error("Erro ao adicionar tag.");
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedContact) return;
    const currentTags = Array.isArray(selectedContact.tags) ? selectedContact.tags : [];
    const updatedTags = currentTags.filter(t => t !== tagToRemove);

    try {
      const { error } = await supabase
        .from("contacts")
        .update({ tags: updatedTags })
        .eq("id", selectedContact.id);

      if (error) throw error;

      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, tags: updatedTags } : c));
      setSelectedContact(prev => prev ? { ...prev, tags: updatedTags } : null);
      toast.success("Tag removida.");
    } catch (err) {
      console.error("Error removing tag:", err);
      toast.error("Erro ao remover tag.");
    }
  };

  const handleCreateOrUpdateLeadStage = async (newStage: LeadStage) => {
    if (!selectedContact) return;
    const userId = await getUserId();
    if (!userId) return;

    try {
      const existingLead = leadsMap[selectedContact.id] || leadsMap[selectedContact.phone];
      if (existingLead) {
        const { error } = await supabase
          .from("leads")
          .update({ stage: newStage, updated_at: new Date().toISOString() })
          .eq("id", existingLead.id);
        if (error) throw error;
        setLeadsMap(prev => ({ ...prev, [selectedContact.id]: { ...existingLead, stage: newStage }, [selectedContact.phone]: { ...existingLead, stage: newStage } }));
        toast.success(`Etapa alterada para "${LEAD_STAGES.find(s => s.id === newStage)?.label}"`);
      } else {
        const { data: newL, error } = await supabase
          .from("leads")
          .insert({
            user_id: userId,
            contact_id: selectedContact.id,
            phone: selectedContact.phone,
            name: selectedContact.name,
            stage: newStage,
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        if (error) throw error;
        if (newL) {
          setLeadsMap(prev => ({ ...prev, [selectedContact.id]: newL, [selectedContact.phone]: newL }));
          toast.success("Lead criada no Pipeline!");
        }
      }
    } catch (err) {
      console.error("Error updating lead stage:", err);
      toast.error("Erro ao atualizar pipeline do lead.");
    }
  };

  const handleQuickCreateLead = async (contact: Contact, e: React.MouseEvent) => {
    e.stopPropagation();
    const userId = await getUserId();
    if (!userId) {
      toast.error("Sessão expirada. Faça login novamente.");
      return;
    }

    try {
      const display = getContactDisplay(contact);
      const leadName = display.isRealName ? contact.name : (contact.name || display.title);

      const { data: newL, error } = await supabase
        .from("leads")
        .insert({
          user_id: userId,
          contact_id: contact.id,
          phone: contact.phone,
          name: leadName,
          stage: "novo",
          status: "new",
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;
      if (newL) {
        setLeadsMap(prev => ({
          ...prev,
          [contact.id]: newL,
          [contact.phone]: newL
        }));
        toast.success(`🎯 Lead criado no Funil para ${leadName}!`);
      }
    } catch (err: any) {
      console.error("Error creating quick lead:", err);
      toast.error(err.message || "Erro ao criar lead.");
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name || !newContact.phone) return;

    if (planDetails && contacts.length >= planDetails.max_contacts) {
      toast.error(`Limite de contatos atingido (${planDetails.max_contacts}). Faça upgrade do seu plano.`);
      return;
    }

    try {
      const userId = await getUserId();
      let phone = newContact.phone.replace(/\D/g, "");
      const countryCode = newContact.countryCode.replace(/\D/g, "");

      if (phone.length <= 10 && !phone.startsWith(countryCode)) {
        phone = countryCode + phone;
      }

      const userTags = newContact.tags.split(",").map(t => t.trim()).filter(Boolean);
      if (!userTags.includes("Manual")) {
        userTags.push("Manual");
      }

      const { data: existingContact } = await supabase
        .from("contacts")
        .select("id, tags")
        .eq("user_id", userId)
        .eq("phone", phone)
        .maybeSingle();

      if (existingContact) {
        const currentTags = Array.isArray(existingContact.tags) ? existingContact.tags : [];
        const mergedTags = Array.from(new Set([...currentTags, ...userTags]));
        await supabase
          .from("contacts")
          .update({ name: newContact.name, tags: mergedTags })
          .eq("id", existingContact.id);
      } else {
        await supabase.from("contacts").insert({
          user_id: userId,
          name: newContact.name,
          phone: phone,
          tags: userTags,
          created_at: new Date().toISOString(),
        });
      }

      await fetchContactsAndLeads();
      setNewContact({ name: "", phone: "", tags: "", countryCode: "258" });
      setIsAdding(false);
      toast.success("Contacto adicionado com sucesso!");
    } catch (err) {
      console.error("Error adding contact:", err);
      toast.error("Erro ao adicionar contato.");
    }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split('\n');
        const userId = await getUserId();
        
        const contactsToInsert = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(',');
          if (parts.length >= 2) {
            const name = parts[0].trim();
            let phone = parts[1].replace(/\D/g, "");
            if (phone.length <= 10 && !phone.startsWith("258")) {
              phone = "258" + phone;
            }
            if (name && phone) {
              contactsToInsert.push({
                user_id: userId,
                name,
                phone,
                tags: ["Importado"],
                created_at: new Date().toISOString(),
              });
            }
          }
        }

        if (contactsToInsert.length > 0) {
          let successCount = 0;
          for (const contact of contactsToInsert) {
            try {
              const { data: existing } = await supabase
                .from("contacts")
                .select("id, tags")
                .eq("user_id", userId)
                .eq("phone", contact.phone)
                .maybeSingle();

              if (existing) {
                const currentTags = Array.isArray(existing.tags) ? existing.tags : [];
                const mergedTags = Array.from(new Set([...currentTags, "Importado"]));
                await supabase
                  .from("contacts")
                  .update({ name: contact.name, tags: mergedTags })
                  .eq("id", existing.id);
              } else {
                await supabase.from("contacts").insert(contact);
              }
              successCount++;
            } catch (err) {
              console.error("Error processing contact in CSV:", err);
            }
          }
          toast.success(`${successCount} contactos processados com sucesso!`);
          await fetchContactsAndLeads();
        } else {
          toast.error("Nenhum contacto válido encontrado no CSV. Use o formato: Nome, Telefone");
        }
      } catch (err) {
        console.error("Error importing contacts:", err);
        toast.error("Erro ao importar contactos.");
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm("Tem a certeza que deseja excluir este contacto?")) return;

    try {
      const { error } = await supabase.from("contacts").delete().eq("id", id);
      if (error) throw error;
      setContacts(prev => prev.filter(c => c.id !== id));
      if (selectedContact?.id === id) closeContactDrawer();
      toast.success("Contacto excluído!");
    } catch (err) {
      console.error("Error deleting contact:", err);
      toast.error("Erro ao excluir contacto.");
    }
  };

  // Filtered contacts calculation
  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
      const cleanP = (c.phone || "").replace(/\D/g, "");
      // Exclude WhatsApp groups and non-contacts (groups belong strictly in /groups)
      if (cleanP.startsWith("120363") || c.phone.includes("@g.us") || c.phone.includes("@broadcast") || cleanP.length < 7 || cleanP.length > 13) return false;

      // 1. Search filter
      const matchesSearch = 
        c.name.toLowerCase().includes(search.toLowerCase()) || 
        c.phone.includes(search);
      if (!matchesSearch) return false;

      const tags = Array.isArray(c.tags) ? c.tags : [];
      const hasLead = Boolean(leadsMap[c.id] || leadsMap[c.phone]);

      // 2. Tab filter
      if (activeTab === "whatsapp") {
        return tags.includes("WhatsApp") || !tags.includes("Manual");
      }
      if (activeTab === "manuais") {
        return tags.includes("Manual") || tags.includes("Importado");
      }
      if (activeTab === "com_lead") {
        return hasLead;
      }
      return true; // 'todos'
    });
  }, [contacts, search, activeTab, leadsMap]);

  // Tab counts
  const tabCounts = useMemo(() => {
    let wa = 0, man = 0, leadCount = 0, validTotal = 0;
    contacts.forEach(c => {
      const cleanP = (c.phone || "").replace(/\D/g, "");
      if (cleanP.startsWith("120363") || c.phone.includes("@g.us") || c.phone.includes("@broadcast") || cleanP.length < 7 || cleanP.length > 13) return;
      validTotal++;
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (tags.includes("WhatsApp") || !tags.includes("Manual")) wa++;
      if (tags.includes("Manual") || tags.includes("Importado")) man++;
      if (leadsMap[c.id] || leadsMap[c.phone]) leadCount++;
    });
    return { todos: validTotal, whatsapp: wa, manuais: man, com_lead: leadCount };
  }, [contacts, leadsMap]);

  const selectedLead = selectedContact ? (leadsMap[selectedContact.id] || leadsMap[selectedContact.phone]) : null;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto w-full">
      {planDetails && contacts.length >= planDetails.max_contacts && (
        <UpgradePrompt 
          title="Limite de Contatos Atingido"
          description={`Você atingiu o limite de ${planDetails.max_contacts} contatos do seu plano atual.`}
        />
      )}

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 sm:gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Users className="text-emerald-600" />
            Base de Clientes
          </h2>
          <p className="text-sm text-slate-500 font-medium mt-1">
            Gestão unificada de clientes WhatsApp, contactos manuais e leads.
          </p>
        </div>

        <div className="flex w-full md:w-auto gap-2 flex-wrap sm:flex-nowrap">
          <input 
            type="file" 
            accept=".csv" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleImportCSV}
          />
          <Button 
            variant="outline"
            className="flex-1 md:flex-none gap-2 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50" 
            onClick={handleSyncCurrentWhatsApp}
            disabled={syncingWhatsApp}
            title="Sincroniza apenas contactos gravados na agenda e conversas ativas da conexão atual"
          >
            <RefreshCw size={16} className={syncingWhatsApp ? "animate-spin text-emerald-600" : "text-emerald-600"} />
            {syncingWhatsApp ? "A sincronizar..." : "Sincronizar WhatsApp"}
          </Button>
          <Button 
            variant="outline"
            className="flex-1 md:flex-none gap-2 rounded-xl" 
            onClick={() => isActivated ? fileInputRef.current?.click() : toast.error("Ative a sua conta para importar contactos.")}
            disabled={!isActivated}
          >
            <Upload size={16} />
            Importar CSV
          </Button>
          <Button 
            className="flex-1 md:flex-none gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm" 
            onClick={() => isActivated ? setIsAdding(true) : toast.error("Ative a sua conta para adicionar contactos.")}
            disabled={!isActivated}
          >
            <Plus size={16} />
            Novo Contacto
          </Button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between bg-white p-3 rounded-2xl border border-slate-200/80 shadow-sm">
        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            onClick={() => setActiveTab("todos")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === "todos" 
                ? "bg-slate-900 text-white shadow-sm" 
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Todos
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === "todos" ? "bg-slate-700 text-white" : "bg-slate-200 text-slate-700"}`}>
              {tabCounts.todos}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("whatsapp")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === "whatsapp" 
                ? "bg-emerald-600 text-white shadow-sm" 
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            WhatsApp
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === "whatsapp" ? "bg-emerald-700 text-white" : "bg-emerald-100 text-emerald-800"}`}>
              {tabCounts.whatsapp}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("com_lead")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === "com_lead" 
                ? "bg-purple-600 text-white shadow-sm" 
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Com Lead
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === "com_lead" ? "bg-purple-700 text-white" : "bg-purple-100 text-purple-800"}`}>
              {tabCounts.com_lead}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("manuais")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-xl transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === "manuais" 
                ? "bg-blue-600 text-white shadow-sm" 
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            Manuais / CSV
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === "manuais" ? "bg-blue-700 text-white" : "bg-blue-100 text-blue-800"}`}>
              {tabCounts.manuais}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input 
            placeholder="Buscar por nome ou número..." 
            className="pl-9 rounded-xl border-slate-200 text-sm h-9 bg-slate-50/50 focus:bg-white transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Add Contact Card */}
      {isAdding && (
        <Card className="border-emerald-200 bg-emerald-50/40 rounded-2xl shadow-sm">
          <CardContent className="p-6">
            <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Plus size={18} className="text-emerald-600" />
              Registar Novo Contacto
            </h3>
            <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">Nome</label>
                <Input 
                  placeholder="Nome do cliente" 
                  value={newContact.name}
                  onChange={e => setNewContact({...newContact, name: e.target.value})}
                  className="rounded-xl bg-white"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">Telefone WhatsApp</label>
                <div className="flex gap-2">
                  <div className="w-20 shrink-0">
                    <Input 
                      placeholder="+258" 
                      value={newContact.countryCode}
                      onChange={e => setNewContact({...newContact, countryCode: e.target.value.replace(/\D/g, "")})}
                      className="text-center rounded-xl bg-white"
                    />
                  </div>
                  <Input 
                    placeholder="84 88 5828 8" 
                    value={newContact.phone}
                    onChange={e => setNewContact({...newContact, phone: e.target.value})}
                    className="rounded-xl bg-white"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">Tags (vírgula)</label>
                <Input 
                  placeholder="Interessado, VIP, Proposta" 
                  value={newContact.tags}
                  onChange={e => setNewContact({...newContact, tags: e.target.value})}
                  className="rounded-xl bg-white"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl">
                  Guardar
                </Button>
                <Button variant="ghost" type="button" onClick={() => setIsAdding(false)} className="rounded-xl">
                  Cancelar
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Contact Cards Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
        </div>
      ) : filteredContacts.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContacts.map((contact) => {
            const lead = leadsMap[contact.id] || leadsMap[contact.phone];
            const stageConfig = lead ? LEAD_STAGES.find(s => s.id === lead.stage) : null;
            const display = getContactDisplay(contact);

            return (
              <Card 
                key={contact.id} 
                onClick={() => openContactDrawer(contact)}
                className="hover:border-emerald-300 hover:shadow-md transition-all cursor-pointer group rounded-2xl border-slate-200/80 bg-white"
              >
                <CardContent className="p-5 flex flex-col justify-between h-full">
                  <div>
                    {/* Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-11 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-600 font-bold group-hover:bg-emerald-100 group-hover:text-emerald-700 transition-colors">
                          {display.initials ? (
                            display.initials
                          ) : (
                            <User size={20} className="text-slate-400 group-hover:text-emerald-600" />
                          )}
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-900 group-hover:text-emerald-600 transition-colors line-clamp-1">
                            {display.title}
                          </h4>
                          {display.subtitle && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-500">
                              <Phone size={12} className="text-slate-400" />
                              {display.subtitle}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Unread badge or actions */}
                      <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                        {contact.unread_count && contact.unread_count > 0 ? (
                          <span className="h-5 px-1.5 bg-emerald-600 text-white rounded-full text-[10px] font-black flex items-center justify-center">
                            {contact.unread_count}
                          </span>
                        ) : null}

                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                          title="Abrir Conversa"
                          onClick={() => navigate(`/messages?phone=${contact.phone}`)}
                        >
                          <Send size={15} />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                          title="Excluir Contacto"
                          onClick={(e) => handleDelete(contact.id, e)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </div>

                    {/* Mode & Stage Badges */}
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      {display.isRealName && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/80 text-[10px] font-bold" title="Contacto gravado na agenda do telefone">
                          <BookOpen size={11} />
                          Agenda
                        </span>
                      )}
                      {contact.last_message_at && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[10px] font-bold" title="Possui mensagens ativas no WhatsApp">
                          <MessageSquare size={11} />
                          Conversa Ativa
                        </span>
                      )}
                      {contact.ai_paused ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200/80 text-[10px] font-bold">
                          <BotOff size={11} />
                          Modo Humano
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/80 text-[10px] font-bold">
                          <Bot size={11} />
                          IA Ativa
                        </span>
                      )}

                      {stageConfig && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ${stageConfig.bgLight} ${stageConfig.color} border ${stageConfig.borderColor} text-[10px] font-bold`}>
                          <TrendingUp size={11} />
                          {stageConfig.label}
                        </span>
                      )}
                    </div>

                    {/* Lead Conversion / Status Quick Action */}
                    <div className="mb-3" onClick={e => e.stopPropagation()}>
                      {lead ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/leads?phone=${contact.phone}`);
                          }}
                          className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200/80 text-xs font-bold transition-all group/leadbtn"
                        >
                          <span className="flex items-center gap-1.5">
                            <TrendingUp size={13} className="text-purple-600" />
                            Lead ({stageConfig?.label || 'No Funil'})
                          </span>
                          <span className="text-[10px] text-purple-600 font-semibold group-hover/leadbtn:underline">
                            Ver Funil →
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={(e) => handleQuickCreateLead(contact, e)}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200/80 hover:border-emerald-300 text-xs font-bold transition-all shadow-xs group/btn"
                        >
                          <Plus size={13} className="text-emerald-600 group-hover/btn:scale-110 transition-transform" />
                          <span>Adicionar como Lead</span>
                        </button>
                      )}
                    </div>

                    {/* Notes preview if any */}
                    {contact.notes && (
                      <p className="text-xs text-slate-500 line-clamp-2 bg-slate-50 p-2 rounded-xl border border-slate-100 mb-3 italic">
                        "{contact.notes}"
                      </p>
                    )}
                  </div>

                  {/* Tags footer */}
                  <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                    {(contact.tags || []).slice(0, 4).map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">
                        <Tag size={9} />
                        {tag}
                      </span>
                    ))}
                    {(contact.tags || []).length > 4 && (
                      <span className="text-[10px] text-slate-400 font-bold">
                        +{(contact.tags || []).length - 4}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 bg-white rounded-3xl border border-dashed border-slate-200">
          <Users size={48} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-bold text-slate-700">Nenhum contacto encontrado</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {search ? "Tente alterar os termos de busca ou mudar a aba de filtro." : "Os seus contactos do WhatsApp e novos registos aparecerão aqui."}
          </p>
        </div>
      )}

      {/* Slide-Over Drawer: Contact Profile */}
      {selectedContact && (
        <div 
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
          onClick={closeContactDrawer}
        >
          <div 
            className="w-full sm:max-w-md bg-white h-full shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer Header */}
            {(() => {
              const drawerDisplay = getContactDisplay(selectedContact);
              return (
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 sticky top-0 z-10">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-2xl bg-emerald-100 text-emerald-700 font-black text-lg flex items-center justify-center">
                      {drawerDisplay.initials ? drawerDisplay.initials : <User size={22} />}
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-lg leading-tight">
                        {drawerDisplay.title}
                      </h3>
                      {drawerDisplay.subtitle && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                          <Phone size={12} className="text-slate-400" />
                          {drawerDisplay.subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={closeContactDrawer}
                    className="h-8 w-8 rounded-full hover:bg-slate-200/60 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              );
            })()}

            {/* Drawer Body */}
            <div className="p-5 space-y-6 flex-1">
              {/* Primary Action Buttons */}
              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  onClick={() => navigate(`/messages?phone=${selectedContact.phone}`)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-2 font-bold shadow-sm h-11"
                >
                  <MessageSquare size={16} />
                  Abrir Conversa
                </Button>

                {selectedLead ? (
                  <Button
                    variant="outline"
                    onClick={() => navigate(`/leads?phone=${selectedContact.phone}`)}
                    className="border-purple-200 hover:bg-purple-50 text-purple-700 rounded-xl gap-2 font-bold h-11"
                  >
                    <TrendingUp size={16} />
                    Ver no Pipeline
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => handleCreateOrUpdateLeadStage('novo')}
                    className="border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl gap-2 font-semibold h-11"
                  >
                    <Plus size={16} />
                    Criar Oportunidade
                  </Button>
                )}
              </div>

              {/* Bot Control Card */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Controlo de IA</span>
                    <p className="text-xs text-slate-600">
                      {selectedContact.ai_paused 
                        ? "Modo Humano ativo. O bot não responde a este cliente." 
                        : "IA Ativa. O agente responde às mensagens deste cliente."}
                    </p>
                  </div>
                </div>

                <Button
                  variant={selectedContact.ai_paused ? "outline" : "default"}
                  onClick={() => handleToggleAi(selectedContact)}
                  className={`w-full rounded-xl gap-2 font-bold text-xs h-9 ${
                    selectedContact.ai_paused 
                      ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" 
                      : "bg-amber-500 hover:bg-amber-600 text-white shadow-sm"
                  }`}
                >
                  {selectedContact.ai_paused ? (
                    <>
                      <Bot size={14} />
                      Retomar Atendimento por IA
                    </>
                  ) : (
                    <>
                      <BotOff size={14} />
                      Assumir Atendimento (Pausar IA)
                    </>
                  )}
                </Button>
              </div>

              {/* CRM / Pipeline Stage */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                  <span>Etapa no Pipeline Comercial</span>
                  {selectedLead && (
                    <span className="text-slate-400 font-normal lowercase">
                      {selectedLead.value ? `${selectedLead.value} MZN` : "sem valor"}
                    </span>
                  )}
                </label>

                <div className="grid grid-cols-1 gap-1.5">
                  {LEAD_STAGES.map(stage => {
                    const isCurrent = selectedLead?.stage === stage.id;
                    return (
                      <button
                        key={stage.id}
                        onClick={() => handleCreateOrUpdateLeadStage(stage.id)}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between border ${
                          isCurrent 
                            ? `${stage.bgLight} ${stage.color} ${stage.borderColor} shadow-xs` 
                            : "bg-white text-slate-600 border-slate-200/70 hover:bg-slate-50"
                        }`}
                      >
                        <span>{stage.label}</span>
                        {isCurrent && <Check size={14} className={stage.color} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tags Management */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Tags do Cliente</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(selectedContact.tags || []).map(tag => (
                    <span 
                      key={tag} 
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium"
                    >
                      {tag}
                      <button 
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-red-500 text-slate-400"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>

                <div className="flex gap-2">
                  <Input 
                    placeholder="Adicionar nova tag..."
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); }}}
                    className="text-xs rounded-xl h-9"
                  />
                  <Button 
                    type="button" 
                    size="sm"
                    variant="outline" 
                    onClick={handleAddTag}
                    className="rounded-xl px-3 h-9"
                  >
                    <Plus size={14} />
                  </Button>
                </div>
              </div>

              {/* Internal Notes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Notas Internas
                  </label>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 h-7 text-xs font-bold px-2"
                  >
                    {savingNotes ? "A guardar..." : "Guardar Nota"}
                  </Button>
                </div>
                <textarea 
                  rows={4}
                  value={editingNotes}
                  onChange={e => setEditingNotes(e.target.value)}
                  placeholder="Escreva notas sobre negociações, preferências, produtos de interesse..."
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none outline-none text-slate-700 leading-relaxed"
                />
              </div>

              {/* Danger Zone */}
              <div className="pt-4 border-t border-slate-100">
                <Button
                  variant="ghost"
                  onClick={(e) => handleDelete(selectedContact.id, e)}
                  className="w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700 rounded-xl text-xs font-bold h-9"
                >
                  <Trash2 size={14} className="mr-2" />
                  Excluir este contacto
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
