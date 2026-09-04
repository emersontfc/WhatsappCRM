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
  Check
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

  // Filtered leads
  const filteredLeads = useMemo(() => {
    return leads.filter(lead => 
      lead.phone?.includes(searchTerm) || 
      lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.intent?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      lead.notes?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [leads, searchTerm]);

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

  // Total pipeline value
  const totalPipelineValue = useMemo(() => {
    return leads.reduce((acc, curr) => acc + (curr.value || 0), 0);
  }, [leads]);

  if (activationLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!isActivated || plan === "Free") {
    return (
      <div className="max-w-4xl mx-auto space-y-8 p-6">
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-12 text-center space-y-4">
            <UserPlus size={48} className="mx-auto text-amber-400" />
            <h3 className="text-xl font-bold text-amber-900">Recurso Indisponível</h3>
            <p className="text-amber-700 max-w-md mx-auto">
              O Pipeline de Vendas e CRM de Leads está disponível nos planos pagos. Faça um upgrade para gerir as suas oportunidades.
            </p>
            <Button onClick={() => navigate("/activate")} className="bg-amber-600 hover:bg-amber-700 text-white rounded-xl">
              Fazer Upgrade
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto w-full">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
        <div className="space-y-1">
          <h2 className="text-xl sm:text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2 sm:gap-3">
            <TrendingUp className="text-emerald-600" />
            Pipeline de Vendas & Leads
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Acompanhe a jornada comercial de cada cliente desde o primeiro contacto até o fecho.
          </p>
        </div>

        {/* Stats & View Mode Switcher */}
        <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3">
          <div className="flex flex-col items-end bg-emerald-50 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl border border-emerald-200 shrink-0">
            <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-bold text-emerald-800">Pipeline Total</span>
            <span className="text-xs sm:text-sm font-black text-emerald-700">
              {totalPipelineValue.toLocaleString()} MZN
            </span>
          </div>

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

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center justify-between bg-white p-2.5 sm:p-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <Input 
            placeholder="Buscar oportunidades..." 
            className="pl-9 rounded-xl border-slate-200 text-xs sm:text-sm h-9 bg-slate-50 focus:bg-white"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 font-medium whitespace-nowrap px-1">
          <span>{filteredLeads.length} oportunidades</span>
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
    </div>
  );
}
