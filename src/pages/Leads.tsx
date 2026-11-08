import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { 
  UserPlus, 
  Search, 
  Phone, 
  MessageSquare, 
  ChevronRight,
  ChevronLeft,
  User,
  DollarSign,
  TrendingUp,
  LayoutGrid,
  List,
  Sparkles,
  X,
  Check,
  Download,
  Plus,
  CheckCircle2,
  Target,
  BarChart2,
  Briefcase
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId } from "../supabase";
import { Card, CardContent } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { useActivation } from "../lib/useActivation";
import { cn } from "../lib/utils";
import { Lead, LeadStage, LEAD_STAGES, Contact } from "../types";

export default function Leads() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isActivated, plan, loading: activationLoading } = useActivation();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [contactsMap, setContactsMap] = useState<Record<string, Contact>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [activeMobileStage, setActiveMobileStage] = useState<LeadStage>("novo");

  // Selected lead modal state
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [editingNotes, setEditingNotes] = useState<string>("");
  const [savingLead, setSavingLead] = useState(false);

  // New Lead Modal State
  const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadPhone, setNewLeadPhone] = useState("");
  const [newLeadStage, setNewLeadStage] = useState<LeadStage>("novo");
  const [newLeadValue, setNewLeadValue] = useState("");
  const [newLeadNotes, setNewLeadNotes] = useState("");
  const [creatingLead, setCreatingLead] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("all");

  // Fetch leads and contacts
  const fetchLeadsAndContacts = async () => {
    const userId = await getUserId();
    if (!userId) return;

    // 1. Fetch leads
    const { data: leadsData, error: leadsError } = await supabase
      .from("leads")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (leadsError) {
      console.error("Error fetching leads:", leadsError);
    } else if (leadsData) {
      // Normalize stage fallback
      const normalized: Lead[] = leadsData.map(l => {
        let stage: LeadStage = "novo";
        if (l.stage && LEAD_STAGES.some(s => s.id === l.stage)) {
          stage = l.stage as LeadStage;
        } else if (l.status === "closed") {
          stage = "venda_fechada";
        } else if (l.status === "lost") {
          stage = "perdido";
        } else if (l.status === "qualified") {
          stage = "proposta_enviada";
        }
        return { ...l, stage };
      });
      setLeads(normalized);
    }

    // 2. Fetch contacts to enrich leads with tags & details
    const { data: contactsData } = await supabase
      .from("contacts")
      .select("*")
      .eq("user_id", userId);

    if (contactsData) {
      const cMap: Record<string, Contact> = {};
      contactsData.forEach((c: Contact) => {
        if (c.id) cMap[c.id] = c;
        if (c.phone) cMap[c.phone] = c;
      });
      setContactsMap(cMap);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchLeadsAndContacts();

    let subscription: any;
    getUserId().then(userId => {
      if (!userId) return;
      subscription = supabase
        .channel('public:leads_kanban')
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'leads',
          filter: `user_id=eq.${userId}`
        }, () => {
          fetchLeadsAndContacts();
        })
        .subscribe();
    });

    return () => {
      if (subscription) supabase.removeChannel(subscription);
    };
  }, []);

  // Handle URL deep-linking: ?phone=... or ?id=...
  useEffect(() => {
    const phoneParam = searchParams.get("phone");
    const idParam = searchParams.get("id");

    if (leads.length > 0 && (phoneParam || idParam)) {
      const cleanPhone = phoneParam?.replace(/\D/g, "");
      const found = leads.find(l => (idParam && l.id === idParam) || (cleanPhone && l.phone === cleanPhone));
      if (found) {
        setSelectedLead(found);
        setEditingValue(found.value !== undefined && found.value !== null ? String(found.value) : "");
        setEditingNotes(found.notes || "");
      }
    }
  }, [searchParams, leads]);

  const openLeadModal = (lead: Lead) => {
    setSelectedLead(lead);
    setEditingValue(lead.value !== undefined && lead.value !== null ? String(lead.value) : "");
    setEditingNotes(lead.notes || "");
    setSearchParams({ phone: lead.phone });
  };

  const closeLeadModal = () => {
    setSelectedLead(null);
    setSearchParams({});
  };

  // Change lead stage
  const handleStageChange = async (leadId: string, newStage: LeadStage, e?: React.MouseEvent) => {
    e?.stopPropagation();

    // Optimistic UI update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage } : l));
    if (selectedLead && selectedLead.id === leadId) {
      setSelectedLead(prev => prev ? { ...prev, stage: newStage } : null);
    }

    try {
      const { error } = await supabase
        .from("leads")
        .update({ 
          stage: newStage, 
          status: newStage === "venda_fechada" ? "closed" : newStage === "perdido" ? "lost" : "active",
          updated_at: new Date().toISOString() 
        })
        .eq("id", leadId);

      if (error) throw error;
      const stageLabel = LEAD_STAGES.find(s => s.id === newStage)?.label;
      toast.success(`Etapa alterada para: ${stageLabel}`);
    } catch (err) {
      console.error("Error updating lead stage:", err);
      toast.error("Erro ao mover lead.");
      fetchLeadsAndContacts(); // revert
    }
  };

  // Save Lead details from modal
  const handleSaveLeadDetails = async () => {
    if (!selectedLead) return;
    setSavingLead(true);

    const numericValue = editingValue ? parseFloat(editingValue) : null;

    try {
      const { error } = await supabase
        .from("leads")
        .update({
          value: numericValue,
          notes: editingNotes,
          updated_at: new Date().toISOString()
        })
        .eq("id", selectedLead.id);

      if (error) throw error;

      setLeads(prev => prev.map(l => l.id === selectedLead.id ? { ...l, value: numericValue || undefined, notes: editingNotes } : l));
      setSelectedLead(prev => prev ? { ...prev, value: numericValue || undefined, notes: editingNotes } : null);
      toast.success("Detalhes da oportunidade guardados!");
    } catch (err) {
      console.error("Error saving lead details:", err);
      toast.error("Erro ao guardar detalhes.");
    } finally {
      setSavingLead(false);
    }
  };

  // Create new manual lead
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const userId = await getUserId();
    if (!userId) return;

    let cleanPhone = newLeadPhone.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 8) {
      toast.error("Por favor, digite um número de telefone válido (mínimo 8 dígitos).");
      return;
    }
    if (cleanPhone.length === 9 && ["82", "83", "84", "85", "86", "87"].includes(cleanPhone.slice(0, 2))) {
      cleanPhone = `258${cleanPhone}`;
    }

    setCreatingLead(true);
    try {
      // 1. Get or create contact
      let contactId: string | null = null;
      const { data: existingContact } = await supabase
        .from("contacts")
        .select("id")
        .eq("user_id", userId)
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact, error: cErr } = await supabase
          .from("contacts")
          .insert({
            user_id: userId,
            name: newLeadName.trim() || cleanPhone,
            phone: cleanPhone,
            tags: ["Lead Manual"]
          })
          .select("id")
          .single();
        if (!cErr && newContact) contactId = newContact.id;
      }

      // 2. Insert or update lead
      const numericVal = newLeadValue ? parseFloat(newLeadValue) : null;
      const { error: lErr } = await supabase
        .from("leads")
        .upsert({
          user_id: userId,
          contact_id: contactId,
          phone: cleanPhone,
          name: newLeadName.trim() || null,
          stage: newLeadStage,
          value: numericVal,
          notes: newLeadNotes.trim() || null,
          status: newLeadStage === "venda_fechada" ? "closed" : newLeadStage === "perdido" ? "lost" : "active",
          source: "manual",
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id,phone" });

      if (lErr) throw lErr;

      toast.success("Oportunidade cadastrada com sucesso!");
      setIsNewLeadModalOpen(false);
      setNewLeadName("");
      setNewLeadPhone("");
      setNewLeadValue("");
      setNewLeadNotes("");
      setNewLeadStage("novo");
      await fetchLeadsAndContacts();
    } catch (err: any) {
      console.error("Error creating manual lead:", err);
      toast.error(err.message || "Erro ao cadastrar lead.");
    } finally {
      setCreatingLead(false);
    }
  };

  // Export leads to CSV
  const handleExportCSV = () => {
    if (filteredLeads.length === 0) {
      toast.error("Nenhuma oportunidade para exportar.");
      return;
    }
    const headers = ["Nome", "Telefone", "Etapa", "Valor (MZN)", "Origem", "Última Mensagem", "Notas", "Data de Criação"];
    const rows = filteredLeads.map(l => [
      `"${(l.name || 'Sem Nome').replace(/"/g, '""')}"`,
      `"${l.phone || ''}"`,
      `"${LEAD_STAGES.find(s => s.id === l.stage)?.label || l.stage}"`,
      `"${l.value || 0}"`,
      `"${l.source || 'whatsapp'}"`,
      `"${(l.last_message || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      `"${(l.notes || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
      `"${new Date(l.created_at).toLocaleDateString('pt-MZ')}"`
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `leads_agentx_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Planilha de Leads exportada com sucesso!");
  };

  // Filtered leads
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      const matchesSearch = 
        lead.phone?.includes(searchTerm) || 
        lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.intent?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.notes?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStage = stageFilter === "all" || lead.stage === stageFilter;
      return matchesSearch && matchesStage;
    });
  }, [leads, searchTerm, stageFilter]);

  // Group leads by stage for Kanban
  const kanbanColumns = useMemo(() => {
    return LEAD_STAGES.map(stage => {
      const stageLeads = filteredLeads.filter(l => l.stage === stage.id);
      const totalVal = stageLeads.reduce((acc, curr) => acc + (curr.value || 0), 0);
      return {
        ...stage,
        leads: stageLeads,
        totalValue: totalVal
      };
    });
  }, [filteredLeads]);

  // Total metrics
  const metrics = useMemo(() => {
    const total = leads.length;
    const wonLeads = leads.filter(l => l.stage === "venda_fechada");
    const wonCount = wonLeads.length;
    const wonValue = wonLeads.reduce((acc, curr) => acc + (curr.value || 0), 0);
    const inProgress = leads.filter(l => l.stage !== "venda_fechada" && l.stage !== "perdido");
    const pipelineValue = inProgress.reduce((acc, curr) => acc + (curr.value || 0), 0);
    const conversionRate = total > 0 ? Math.round((wonCount / total) * 100) : 0;
    return { total, wonCount, wonValue, pipelineValue, conversionRate };
  }, [leads]);

  if (activationLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }
  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto w-full pb-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 rounded-xl text-emerald-600">
              <TrendingUp className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            Pipeline de Vendas & Leads
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Gerencie o funil comercial, acompanhe o valor negociado e converta conversas em vendas fechadas.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            onClick={() => setIsNewLeadModalOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold h-9 sm:h-10 px-3.5 sm:px-4 shadow-sm flex items-center gap-1.5"
          >
            <Plus size={16} />
            <span>Novo Lead</span>
          </Button>

          <Button
            variant="outline"
            onClick={handleExportCSV}
            className="border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs sm:text-sm font-bold h-9 sm:h-10 px-3 sm:px-3.5 flex items-center gap-1.5"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Button>

          <div className="flex bg-slate-100 p-1 rounded-xl shrink-0">
            <button
              onClick={() => setViewMode("kanban")}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                viewMode === "kanban" 
                  ? "bg-white text-slate-900 shadow-sm" 
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <LayoutGrid size={15} />
              <span className="hidden sm:inline">Kanban</span>
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                viewMode === "table" 
                  ? "bg-white text-slate-900 shadow-sm" 
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              <List size={15} />
              <span className="hidden sm:inline">Tabela</span>
            </button>
          </div>
        </div>
      </div>

      {/* Commercial Metrics Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Pipeline Value */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">Pipeline Aberto</span>
            <span className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <DollarSign size={14} />
            </span>
          </div>
          <div className="mt-2">
            <span className="text-lg sm:text-2xl font-black text-slate-900">
              {metrics.pipelineValue.toLocaleString()} <span className="text-xs font-bold text-slate-400">MZN</span>
            </span>
            <p className="text-[10px] text-slate-400 mt-0.5">Em negociação ativa</p>
          </div>
        </div>

        {/* Won Value */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/40 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-800">Vendas Ganhas</span>
            <span className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
              <CheckCircle2 size={14} />
            </span>
          </div>
          <div className="mt-2">
            <span className="text-lg sm:text-2xl font-black text-emerald-700">
              {metrics.wonValue.toLocaleString()} <span className="text-xs font-bold text-emerald-500">MZN</span>
            </span>
            <p className="text-[10px] text-emerald-600 font-medium mt-0.5">{metrics.wonCount} negócio(s) fechado(s)</p>
          </div>
        </div>

        {/* Total Leads Count */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">Total Oportunidades</span>
            <span className="p-1.5 bg-purple-50 text-purple-600 rounded-lg">
              <UserPlus size={14} />
            </span>
          </div>
          <div className="mt-2">
            <span className="text-lg sm:text-2xl font-black text-slate-900">
              {metrics.total}
            </span>
            <p className="text-[10px] text-slate-400 mt-0.5">Leads na base comercial</p>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500">Taxa de Conversão</span>
            <span className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <Target size={14} />
            </span>
          </div>
          <div className="mt-2">
            <span className="text-lg sm:text-2xl font-black text-slate-900">
              {metrics.conversionRate}%
            </span>
            <p className="text-[10px] text-slate-400 mt-0.5">Leads convertidos em ganho</p>
          </div>
        </div>
      </div>

      {/* Filter & Search Controls */}
      <div className="bg-white p-3 sm:p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <Input 
              placeholder="Buscar por nome, telefone, intenção ou notas..." 
              className="pl-9 rounded-xl border-slate-200 text-xs sm:text-sm h-9 bg-slate-50 focus:bg-white"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium whitespace-nowrap px-1">
            <span>{filteredLeads.length} oportunidade(s) filtrada(s)</span>
          </div>
        </div>

        {/* Stage Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
          <button
            onClick={() => setStageFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0",
              stageFilter === "all"
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            Todas ({leads.length})
          </button>
          {LEAD_STAGES.map(stage => {
            const count = leads.filter(l => l.stage === stage.id).length;
            const isSelected = stageFilter === stage.id;
            return (
              <button
                key={stage.id}
                onClick={() => setStageFilter(isSelected ? "all" : stage.id)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 flex items-center gap-1.5",
                  isSelected
                    ? "bg-slate-900 text-white shadow-sm"
                    : `${stage.bgLight} ${stage.color} hover:opacity-80`
                )}
              >
                <span>{stage.label}</span>
                <span className="opacity-75 text-[10px]">({count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
        </div>
      ) : viewMode === "kanban" ? (
        /* KANBAN BOARD VIEW */
        <div className="space-y-3">
          {/* Mobile Stage Selector Tabs (< md) */}
          <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {kanbanColumns.map((col) => {
              const isCurrent = activeMobileStage === col.id;
              return (
                <button
                  key={col.id}
                  onClick={() => setActiveMobileStage(col.id as LeadStage)}
                  className={cn(
                    "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 shrink-0",
                    isCurrent
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200"
                  )}
                >
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    col.id === 'novo' ? 'bg-blue-500' :
                    col.id === 'em_atendimento' ? 'bg-amber-500' :
                    col.id === 'proposta_enviada' ? 'bg-purple-500' :
                    col.id === 'venda_fechada' ? 'bg-emerald-500' : 'bg-rose-500'
                  )} />
                  {col.label}
                  <span className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px]",
                    isCurrent ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"
                  )}>
                    {col.leads.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Kanban Columns Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start pb-4">
            {kanbanColumns.map((col) => {
              const isHiddenOnMobile = activeMobileStage !== col.id;
              return (
                <div 
                  key={col.id} 
                  className={cn(
                    "bg-slate-100/70 border border-slate-200/80 rounded-2xl p-3 flex flex-col min-h-[480px] max-h-[80vh]",
                    isHiddenOnMobile ? "hidden md:flex" : "flex"
                  )}
                >
              {/* Column Header */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    col.id === 'novo' ? 'bg-blue-500' :
                    col.id === 'em_atendimento' ? 'bg-amber-500' :
                    col.id === 'proposta_enviada' ? 'bg-purple-500' :
                    col.id === 'venda_fechada' ? 'bg-emerald-500' : 'bg-rose-500'
                  }`} />
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-800">
                    {col.label}
                  </h3>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200">
                  {col.leads.length}
                </span>
              </div>

              {col.totalValue > 0 && (
                <div className="text-[10px] text-slate-500 font-semibold mb-2 px-1">
                  Total: <span className="text-slate-800 font-bold">{col.totalValue.toLocaleString()} MZN</span>
                </div>
              )}

              {/* Column Cards */}
              <div className="space-y-2.5 overflow-y-auto flex-1 pr-0.5">
                {col.leads.map((lead) => {
                  const contact = contactsMap[lead.contact_id || ""] || contactsMap[lead.phone];
                  const currentIdx = LEAD_STAGES.findIndex(s => s.id === lead.stage);

                  return (
                    <div
                      key={lead.id}
                      onClick={() => openLeadModal(lead)}
                      className="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer group space-y-2.5"
                    >
                      {/* Top: Name & Deal Value */}
                      <div className="flex justify-between items-start">
                        <div className="space-y-0.5">
                          <h4 className="font-bold text-slate-900 text-xs group-hover:text-emerald-700 transition-colors line-clamp-1">
                            {lead.name || contact?.name || "Sem Nome"}
                          </h4>
                          <div className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Phone size={10} />
                            {lead.phone}
                          </div>
                        </div>

                        {lead.value ? (
                          <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200 whitespace-nowrap">
                            {lead.value.toLocaleString()} MZN
                          </span>
                        ) : null}
                      </div>

                      {/* Intent or Last Message */}
                      {lead.intent && (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 text-[10px] font-bold">
                          <Sparkles size={10} />
                          {lead.intent}
                        </div>
                      )}

                      {lead.last_message && (
                        <p className="text-[11px] text-slate-500 line-clamp-2 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                          {lead.last_message}
                        </p>
                      )}

                      {/* Footer Actions: Chat & Stage Mover */}
                      <div 
                        className="flex items-center justify-between pt-2 border-t border-slate-100" 
                        onClick={e => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/messages?phone=${lead.phone}`)}
                          className="h-7 px-2 text-[10px] font-bold text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg gap-1"
                        >
                          <MessageSquare size={12} />
                          Conversar
                        </Button>

                        {/* Quick stage transition buttons */}
                        <div className="flex items-center gap-1">
                          {currentIdx > 0 && (
                            <button
                              onClick={(e) => handleStageChange(lead.id, LEAD_STAGES[currentIdx - 1].id, e)}
                              title={`Mover para: ${LEAD_STAGES[currentIdx - 1].label}`}
                              className="h-6 w-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                            >
                              <ChevronLeft size={13} />
                            </button>
                          )}
                          {currentIdx < LEAD_STAGES.length - 1 && (
                            <button
                              onClick={(e) => handleStageChange(lead.id, LEAD_STAGES[currentIdx + 1].id, e)}
                              title={`Avançar para: ${LEAD_STAGES[currentIdx + 1].label}`}
                              className="h-6 w-6 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"
                            >
                              <ChevronRight size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {col.leads.length === 0 && (
                  <div className="h-28 rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-xs">
                    Vazio
                  </div>
                )}
              </div>
            </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="overflow-hidden bg-white border border-slate-200 rounded-2xl shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500">Lead / Contacto</th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500">Etapa Comercial</th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500">Valor Estimado</th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500">Intenção IA</th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500">Última Mensagem</th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-500 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredLeads.map((lead) => {
                const stageConfig = LEAD_STAGES.find(s => s.id === lead.stage);
                return (
                  <tr 
                    key={lead.id} 
                    onClick={() => openLeadModal(lead)}
                    className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold text-xs">
                          {lead.name ? lead.name.slice(0, 2).toUpperCase() : <User size={14} />}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{lead.name || "Sem nome"}</p>
                          <p className="text-[11px] text-slate-400">{lead.phone}</p>
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                      <select
                        value={lead.stage}
                        onChange={(e) => handleStageChange(lead.id, e.target.value as LeadStage)}
                        className={`text-xs font-bold rounded-lg px-2.5 py-1 border ${stageConfig?.bgLight} ${stageConfig?.color} ${stageConfig?.borderColor} outline-none cursor-pointer`}
                      >
                        {LEAD_STAGES.map(s => (
                          <option key={s.id} value={s.id} className="text-slate-800 bg-white">
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-5 py-3.5 font-bold text-emerald-700">
                      {lead.value ? `${lead.value.toLocaleString()} MZN` : <span className="text-slate-300 font-normal">-</span>}
                    </td>

                    <td className="px-5 py-3.5">
                      {lead.intent ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-bold text-[10px]">
                          <Sparkles size={10} />
                          {lead.intent}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-slate-500 max-w-xs truncate">
                      {lead.last_message || "-"}
                    </td>

                    <td className="px-5 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/messages?phone=${lead.phone}`)}
                        className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 rounded-xl h-7 px-2.5 text-xs font-bold gap-1"
                      >
                        <MessageSquare size={12} />
                        Conversar
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide-Over or Modal: Lead Detail */}
      {selectedLead && (
        <div 
          onClick={closeLeadModal}
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        >
          <div 
            className="w-full sm:max-w-md bg-white h-full shadow-2xl flex flex-col overflow-y-auto animate-in slide-in-from-right duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-2xl bg-purple-100 text-purple-700 font-black text-base flex items-center justify-center">
                  <TrendingUp size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base leading-tight">
                    {selectedLead.name || "Oportunidade Comercial"}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
                    <Phone size={12} className="text-slate-400" />
                    {selectedLead.phone}
                  </div>
                </div>
              </div>
              <button 
                onClick={closeLeadModal}
                className="h-8 w-8 rounded-full hover:bg-slate-200/60 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-6 flex-1">
              {/* Primary Action Buttons */}
              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  onClick={() => navigate(`/messages?phone=${selectedLead.phone}`)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-2 font-bold shadow-sm h-11"
                >
                  <MessageSquare size={16} />
                  Conversar (Chat)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate(`/contacts?phone=${selectedLead.phone}`)}
                  className="border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl gap-2 font-semibold h-11"
                >
                  <User size={16} />
                  Ver Contacto
                </Button>
              </div>

              {/* Stage Selector */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Etapa no Pipeline
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {LEAD_STAGES.map(stage => {
                    const isCurrent = selectedLead.stage === stage.id;
                    return (
                      <button
                        key={stage.id}
                        onClick={() => handleStageChange(selectedLead.id, stage.id)}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between border ${
                          isCurrent 
                            ? `${stage.bgLight} ${stage.color} ${stage.borderColor} shadow-sm` 
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

              {/* Deal Value Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <DollarSign size={13} className="text-emerald-600" />
                  Valor da Oportunidade (MZN)
                </label>
                <Input 
                  type="number"
                  placeholder="Ex: 15000"
                  value={editingValue}
                  onChange={e => setEditingValue(e.target.value)}
                  className="rounded-xl text-sm"
                />
              </div>

              {/* AI Intent & Context */}
              {selectedLead.intent && (
                <div className="p-3.5 rounded-xl bg-purple-50/70 border border-purple-200 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 flex items-center gap-1">
                    <Sparkles size={11} />
                    Intenção Identificada pela IA
                  </span>
                  <p className="text-xs font-medium text-purple-900">
                    {selectedLead.intent}
                  </p>
                </div>
              )}

              {/* Last Message */}
              {selectedLead.last_message && (
                <div className="space-y-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Última Mensagem Registada
                  </span>
                  <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 italic">
                    "{selectedLead.last_message}"
                  </p>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Notas da Negociação
                </label>
                <textarea 
                  rows={4}
                  value={editingNotes}
                  onChange={e => setEditingNotes(e.target.value)}
                  placeholder="Detalhes da proposta, condições negociadas, prazos..."
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none outline-none text-slate-700 leading-relaxed"
                />
              </div>

              {/* Save Button */}
              <Button
                onClick={handleSaveLeadDetails}
                disabled={savingLead}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs h-10 shadow-sm"
              >
                {savingLead ? "A guardar alterações..." : "Guardar Alterações do Lead"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo Lead Manual */}
      {isNewLeadModalOpen && (
        <div 
          onClick={() => setIsNewLeadModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200"
        >
          <div 
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Cadastrar Nova Oportunidade</h3>
                  <p className="text-xs text-slate-500">Adicione um novo lead ao seu funil comercial</p>
                </div>
              </div>
              <button 
                onClick={() => setIsNewLeadModalOpen(false)}
                className="h-8 w-8 rounded-full hover:bg-slate-200/60 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateLead} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Nome do Lead / Cliente
                </label>
                <Input
                  required
                  placeholder="Ex: Carlos Machel ou Empresa XYZ"
                  value={newLeadName}
                  onChange={e => setNewLeadName(e.target.value)}
                  className="rounded-xl text-xs sm:text-sm h-10 border-slate-200"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Telefone / WhatsApp
                </label>
                <Input
                  required
                  placeholder="Ex: 841234567 ou 258841234567"
                  value={newLeadPhone}
                  onChange={e => setNewLeadPhone(e.target.value)}
                  className="rounded-xl text-xs sm:text-sm h-10 border-slate-200"
                />
                <span className="text-[10px] text-slate-400">Pode digitar com ou sem o prefixo 258</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Etapa Inicial
                  </label>
                  <select
                    value={newLeadStage}
                    onChange={e => setNewLeadStage(e.target.value as LeadStage)}
                    className="w-full text-xs h-10 px-3 rounded-xl border border-slate-200 bg-white font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    {LEAD_STAGES.map(s => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Valor Estimado (MZN)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Ex: 5000"
                    value={newLeadValue}
                    onChange={e => setNewLeadValue(e.target.value)}
                    className="rounded-xl text-xs sm:text-sm h-10 border-slate-200"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Observações & Detalhes da Oportunidade
                </label>
                <textarea
                  rows={3}
                  placeholder="Interesse em produto X, orçamento enviado, origem anúncio Meta..."
                  value={newLeadNotes}
                  onChange={e => setNewLeadNotes(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none outline-none text-slate-700"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsNewLeadModalOpen(false)}
                  className="rounded-xl text-xs h-10 px-4"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={creatingLead}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold h-10 px-5 shadow-sm"
                >
                  {creatingLead ? "A cadastrar..." : "Cadastrar Lead"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
