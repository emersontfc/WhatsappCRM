import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, 
  Search, 
  Shield, 
  UserMinus, 
  UserPlus, 
  MessageSquare,
  Info,
  ArrowLeft,
  Lock,
  ShieldAlert,
  ShieldCheck,
  LogOut,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { GroupControls, type EditableGroup, type GroupPermissions } from '../components/GroupControls';
import { GroupModerationPanel, moderationActionLabels, moderationOutcomeLabels, moderationRuleLabels } from '../components/GroupModerationPanel';
import { GroupPolicyPanel } from '../components/GroupPolicyPanel';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

interface GroupSummary {
  id: string;
  subject: string;
  size?: number;
}

interface Member {
  id: string;
  lid?: string;
  name?: string;
  notify?: string;
  phoneNumber?: string;
  admin?: "admin" | "superadmin" | null;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
}

interface Group extends EditableGroup { participants: Member[]; permissions: GroupPermissions }
type MemberAction = "add" | "remove" | "promote" | "demote";
type GroupEvent = { id: number; rule: string; action?: string | null; outcome: string; review_status?: string | null; created_at: string };

const memberActions = { add: "Adicionar membro", remove: "Remover do grupo", promote: "Promover a administrador", demote: "Remover função de administrador" };
const memberLabel = (member: Member) => member.name || member.notify || (member.phoneNumber ?? member.id).split("@")[0];
const defaultRules = { anti_link: false, anti_spam: false, anti_flood: false, welcome_msg: "", active: true };
const normalizedMemberId = (value: string) => value.toLowerCase().replace(/:\d+@/, "@").replace(/@c\.us$/, "@s.whatsapp.net");
const reviewStates: Record<string, string> = { pending: "Aguarda revisão", reviewed: "Revista", dismissed: "Arquivada" };

export default function Groups() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<"offline" | "unavailable" | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [groupRules, setGroupRules] = useState(defaultRules);
  const [groupEvents, setGroupEvents] = useState<GroupEvent[]>([]);
  const [rulesReady, setRulesReady] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [eventsUnavailable, setEventsUnavailable] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [newMember, setNewMember] = useState("");
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberAction, setMemberAction] = useState<{ member: Member; action: MemberAction } | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const detailRequest = useRef(0);
  const detailTarget = useRef<string | null>(null);
  const groupPanel = useRef<HTMLDivElement>(null);
  const groupId = selectedGroup?.id;
  const groupIdRef = useRef(groupId);
  groupIdRef.current = groupId;

  useEffect(() => {
    setMemberSearch("");
    setNewMember("");
    setMemberAction(null);
    setLeaveConfirm(false);
    if (!groupId) return;
    if (window.matchMedia("(max-width: 1023px)").matches) groupPanel.current?.scrollIntoView({ block: "start" });
    let active = true;
    setRulesReady(false);
    setGroupEvents([]);
    setEventsUnavailable(false);
    const root = `/api/whatsapp/groups/${groupId}`;
    void apiFetch(root + "/rules").then(({ data }) => {
      if (!active) return;
      setGroupRules({ ...defaultRules, ...data, active: data?.active ?? true, welcome_msg: data?.welcome_msg ?? "" });
      setRulesReady(true);
    }).catch(() => { if (active) toast.error("Não foi possível carregar as regras."); });
    const refresh = () => {
      if (document.hidden) return;
      void apiFetch(root + "/events").then(({ data }) => {
        if (!active) return;
        setGroupEvents(data);
        setEventsUnavailable(false);
      }).catch(() => { if (active) setEventsUnavailable(true); });
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [groupId]);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/whatsapp/groups');
      if (!data.success || !Array.isArray(data.groups)) throw new Error(data.error || 'Lista de grupos indisponível.');
      setGroups(data.groups);
      setListError(null);
    } catch (error) {
      setListError(error instanceof Error && error.message.includes('WhatsApp não conectado') ? "offline" : "unavailable");
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupDetails = async (jid: string, refreshing = false) => {
    if (refreshing && detailTarget.current !== jid) return;
    detailTarget.current = jid;
    const request = ++detailRequest.current;
    try {
      const data = await apiFetch(`/api/whatsapp/groups/${encodeURIComponent(jid)}`);
      if (request !== detailRequest.current) return;
      if (!data.success || !data.metadata || !data.permissions) throw new Error(data.error || 'Detalhes do grupo indisponíveis.');
      setSelectedGroup({ ...data.metadata, permissions: data.permissions });
      setGroups((previous) => previous.map((item) => item.id === jid
        ? { ...item, subject: data.metadata.subject, size: data.metadata.participants.length } : item));
    } catch (error) {
      if (request === detailRequest.current) {
        detailTarget.current = groupIdRef.current ?? null;
        toast.error(error instanceof Error ? error.message : 'Erro ao carregar detalhes do grupo.');
      }
    }
  };

  const closeGroup = () => {
    ++detailRequest.current;
    detailTarget.current = null;
    setSelectedGroup(null);
  };

  const saveRules = async (newRules: Partial<typeof defaultRules>) => {
    if (!groupId || !rulesReady || savingRules) return;
    setSavingRules(true);
    try {
      const data = await apiFetch(`/api/whatsapp/groups/${groupId}/rules`, {
        method: "POST",
        body: JSON.stringify(newRules)
      });
      if (data.success && groupIdRef.current === groupId) {
        setGroupRules((current) => ({ ...current, ...newRules }));
        toast.success("Regras guardadas.");
      }
    } catch {
      toast.error("Erro ao guardar regras.");
    } finally {
      setSavingRules(false);
    }
  };

  const handleParticipantAction = async (participant: string, action: MemberAction) => {
    if (!selectedGroup?.permissions.manage || memberBusy) return;
    const jid = selectedGroup.id;
    setMemberBusy(true);
    try {
      const data = await apiFetch(`/api/whatsapp/groups/${encodeURIComponent(jid)}/participants`, {
        method: 'POST', body: JSON.stringify({ participants: [participant], action })
      });
      if (data.success !== true || !["confirmed", "unchanged"].includes(data.status)) {
        throw new Error(data.error || 'O WhatsApp não confirmou a operação.');
      }
      if (groupIdRef.current === jid) {
        setNewMember("");
        setMemberAction(null);
        await fetchGroupDetails(jid, true);
      }
      if (data.status === "unchanged") {
        toast.info(action === "add" ? "Este número já é membro do grupo." : "O membro já tem a função selecionada.");
      } else {
        const results = { add: "Membro adicionado.", remove: "Membro removido do grupo.",
          promote: "Membro promovido a administrador.", demote: "Função de administrador removida." };
        toast.success(results[action]);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao atualizar o membro.');
      await fetchGroupDetails(jid, true);
    } finally {
      setMemberBusy(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroup || memberBusy) return;
    const jid = selectedGroup.id;
    setMemberBusy(true);
    try {
      const data = await apiFetch(`/api/whatsapp/groups/${encodeURIComponent(jid)}/leave`, { method: 'POST' });
      if (!data.success) throw new Error(data.error || 'O WhatsApp não confirmou a saída.');
      if (groupIdRef.current === jid) closeGroup();
      toast.success('A conta ligada saiu do grupo.');
      await fetchGroups();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao sair do grupo.');
    } finally {
      setMemberBusy(false);
    }
  };

  const toggleRule = (field: "active" | "anti_link" | "anti_spam" | "anti_flood") => {
    void saveRules({ [field]: !groupRules[field] });
  };

  const handleWelcomeMsgChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setGroupRules({ ...groupRules, welcome_msg: e.target.value });
  };

  const filteredGroups = (groups || []).filter(g => 
    g.subject && g.subject.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const members = selectedGroup?.participants.filter((member) =>
    `${memberLabel(member)} ${member.phoneNumber ?? ""} ${member.id}`.toLowerCase().includes(memberSearch.trim().toLowerCase())) ?? [];

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto min-screen transition-colors duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Gestão de Grupos</h1>
          <p className="text-slate-500 mt-1">Gerencie seus grupos de WhatsApp, participantes e regras de moderação.</p>
        </div>
        <button 
          onClick={fetchGroups}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-slate-600 font-medium shadow-sm"
        >
          <Users className="w-4 h-4" />
          Atualizar Lista
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar: Group List */}
        <div className={`lg:col-span-4 space-y-4 ${selectedGroup ? "hidden lg:block" : ""}`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text"
              placeholder="Buscar grupos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Seus Grupos ({filteredGroups.length})</span>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {!loading && listError && <div role="status" className="border-b border-amber-100 bg-amber-50 p-3 text-sm text-amber-900">
                {listError === "offline" ? <Link to="/dashboard#ligar-whatsapp" className="font-semibold underline">Liga o WhatsApp para ver os grupos</Link>
                  : "Não foi possível atualizar os grupos. Tenta atualizar a lista."}
              </div>}
              {loading ? (
                <div className="p-8 text-center">
                  <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p className="text-sm text-slate-400">Carregando grupos...</p>
                </div>
              ) : filteredGroups.length === 0 && !listError ? (
                <div className="p-8 text-center text-slate-400">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Nenhum grupo encontrado</p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => fetchGroupDetails(group.id)}
                    className={`w-full p-4 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0 ${selectedGroup?.id === group.id ? 'bg-emerald-50/50 border-l-4 border-l-emerald-500' : ''}`}
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                      <Users className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 truncate">{group.subject}</h3>
                      {group.size !== undefined && <p className="text-xs text-slate-500">{group.size} membros</p>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content: Group Details & Rules */}
        <div className="lg:col-span-8" ref={groupPanel}>
          <AnimatePresence mode="wait">
            {selectedGroup ? (
              <motion.div
                key={selectedGroup.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Group Header */}
                <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4">
                    <button 
                      onClick={closeGroup}
                      aria-label="Fechar detalhes do grupo"
                      className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                      <Users className="w-8 h-8" />
                    </div>
                    <div className="min-w-0 pr-8">
                      <h2 className="break-words text-xl font-bold text-slate-900 sm:text-2xl">{selectedGroup.subject}</h2>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-500">{selectedGroup.desc || 'Sem descrição'}</p>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-xs font-medium flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {selectedGroup.participants?.length || 0} Participantes
                        </span>
                        <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          {selectedGroup.permissions.manage ? "Administrador" : "Membro"}
                        </span>
                        <button 
                          onClick={() => setLeaveConfirm(true)}
                          className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-full text-xs font-bold flex items-center gap-1 transition-colors"
                        >
                          <LogOut className="w-3 h-3" />
                          Sair do Grupo
                        </button>
                      </div>
                    </div>
                  </div>
                  {leaveConfirm && <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm" role="group" aria-label="Confirmar saída">
                    <p>A conta ligada vai sair de <strong>{selectedGroup.subject}</strong>.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setLeaveConfirm(false)}>Cancelar</Button>
                      <Button size="sm" variant="danger" disabled={memberBusy} onClick={() => void handleLeaveGroup()}>Confirmar saída</Button>
                    </div>
                  </div>}
                </div>

                <GroupControls key={selectedGroup.id} group={selectedGroup} permissions={selectedGroup.permissions}
                  refresh={() => fetchGroupDetails(selectedGroup.id, true)}
                  onPostingModeChange={(announce) => setSelectedGroup((current) => {
                    if (!current || current.id !== selectedGroup.id) return current;
                    return { ...current, announce, permissions: { ...current.permissions, post: !announce || current.permissions.manage } };
                  })} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Participants List */}
                  <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                      <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-500" />
                        Participantes
                      </h3>
                    </div>
                    <div className="space-y-2 p-3">
                      <Input aria-label="Procurar membros" placeholder="Procurar por nome ou número" value={memberSearch}
                        onChange={(event) => setMemberSearch(event.target.value)} />
                      {selectedGroup.permissions.manage && <form className="flex flex-wrap gap-2" onSubmit={(event) => {
                        event.preventDefault();
                        void handleParticipantAction(newMember, "add");
                      }}>
                        <Input className="min-w-32 flex-1" aria-label="Número de WhatsApp do novo membro" type="tel" maxLength={32}
                          placeholder="Número com indicativo" value={newMember} onChange={(event) => setNewMember(event.target.value)} />
                        <Button type="submit" variant="outline" className="gap-1" disabled={memberBusy || !newMember.trim()}>
                          <UserPlus size={15} /> Adicionar
                        </Button>
                      </form>}
                      {memberAction && <div role="group" aria-label="Confirmar alteração de membro" className="rounded-lg bg-amber-50 p-2 text-sm">
                        <p>{memberActions[memberAction.action]} ({memberLabel(memberAction.member)})?</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => setMemberAction(null)}>Cancelar</Button>
                          <Button size="sm" disabled={memberBusy} variant={memberAction.action === "remove" ? "danger" : "primary"}
                            onClick={() => void handleParticipantAction(memberAction.member.id, memberAction.action)}>Confirmar</Button>
                        </div>
                      </div>}
                    </div>
                    <div className="flex-1 max-h-[400px] overflow-y-auto p-2 space-y-1">
                      {members.length === 0 && <p className="p-3 text-sm text-slate-500">Nenhum membro encontrado.</p>}
                      {members.map((p) => {
                        const owner = p.admin === "superadmin" || p.isSuperAdmin;
                        const admin = owner || p.admin === "admin" || p.isAdmin;
                        const ownAccount = p.id === selectedGroup.permissions.selfId;
                        return (
                        <div key={p.id} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-colors group">
                          <div className="flex items-center gap-3 min-w-0">
                            <div aria-hidden="true" className="h-8 w-8 shrink-0 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-bold">
                              {memberLabel(p).substring(0, 2).toUpperCase()}
                            </div>
                            <div className="truncate">
                              <p className="text-sm font-medium text-slate-900 truncate">{memberLabel(p)}</p>
                              {(admin || ownAccount) && <span className="text-xs text-emerald-700">{[owner ? "Criador" : admin ? "Administrador" : null, ownAccount ? "Conta ligada" : null].filter(Boolean).join(" · ")}</span>}
                            </div>
                          </div>
                          {selectedGroup.permissions.manage && !owner && !ownAccount && <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" disabled={memberBusy} title={memberActions[admin ? "demote" : "promote"]}
                              aria-label={`${memberActions[admin ? "demote" : "promote"]}: ${memberLabel(p)}`}
                              onClick={() => setMemberAction({ member: p, action: admin ? "demote" : "promote" })}>
                              {admin ? <Shield size={16} /> : <ShieldCheck size={16} />}
                            </Button>
                            <Button size="icon" variant="ghost" disabled={memberBusy} title={memberActions.remove}
                              aria-label={`${memberActions.remove}: ${memberLabel(p)}`}
                              onClick={() => setMemberAction({ member: p, action: "remove" })}><UserMinus size={16} /></Button>
                          </div>}
                        </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Moderation Rules */}
                  <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                      <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-emerald-500" />
                        Regras de Moderação
                      </h3>
                    </div>
                    <div className="p-4 space-y-4">
                      <label className="flex gap-2 text-sm">
                        <input type="checkbox" checked={groupRules.active} disabled={!rulesReady || savingRules}
                          onChange={() => toggleRule("active")} />
                        Ativar as regras e boas-vindas deste grupo
                      </label>
                      <p className="text-sm text-slate-600">Para remover mensagens, a conta ligada precisa de ser administradora do grupo.</p>
                      {/* Anti-Link */}
                      <div className="flex items-center justify-between p-3 border border-slate-100 rounded-2xl hover:border-emerald-200 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${groupRules.anti_link ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                            <Lock className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">Anti-Link</p>
                            <p className="text-xs text-slate-600">Deteta links fora dos domínios permitidos</p>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleRule('anti_link')}
                          disabled={!rulesReady || savingRules}
                          aria-pressed={groupRules.anti_link}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${groupRules.anti_link ? 'bg-emerald-500' : 'bg-slate-200'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${groupRules.anti_link ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>

                      {/* Anti-Spam */}
                      <div className="flex items-center justify-between p-3 border border-slate-100 rounded-2xl hover:border-emerald-200 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${groupRules.anti_spam ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                            <Shield className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">Anti-Spam</p>
                            <p className="text-xs text-slate-600">Deteta a terceira repetição de um membro em 30 segundos</p>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleRule('anti_spam')}
                          disabled={!rulesReady || savingRules}
                          aria-pressed={groupRules.anti_spam}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${groupRules.anti_spam ? 'bg-emerald-500' : 'bg-slate-200'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${groupRules.anti_spam ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>

                      {/* Anti-Flood */}
                      <div className="flex items-center justify-between p-3 border border-slate-100 rounded-2xl hover:border-emerald-200 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${groupRules.anti_flood ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                            <Zap className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">Anti-Flood</p>
                            <p className="text-xs text-slate-600">Deteta a partir da sexta mensagem do membro em 10 segundos</p>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleRule('anti_flood')}
                          disabled={!rulesReady || savingRules}
                          aria-pressed={groupRules.anti_flood}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${groupRules.anti_flood ? 'bg-emerald-500' : 'bg-slate-200'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${groupRules.anti_flood ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>

                      {/* Welcome Message */}
                      <div className="space-y-3 p-3 border border-slate-100 rounded-2xl hover:border-emerald-200 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${groupRules.welcome_msg ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                              <MessageSquare className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">Boas-vindas</p>
                              <p className="text-[10px] text-slate-500">Saudação automática para novos membros</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <textarea
                            value={groupRules.welcome_msg}
                            disabled={!rulesReady || savingRules}
                            maxLength={800}
                            onChange={handleWelcomeMsgChange}
                            placeholder="Olá {user}, bem-vindo ao grupo!"
                            className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none min-h-[80px] resize-none"
                          />
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-400 italic">Use {"{user}"} para mencionar o membro</span>
                            <button 
                              onClick={() => void saveRules({ welcome_msg: groupRules.welcome_msg })}
                              disabled={!rulesReady || savingRules}
                              className="px-3 py-1 bg-emerald-500 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-600 transition-colors"
                            >
                              Salvar Mensagem
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                        <div className="flex gap-3">
                          <Info className="w-5 h-5 text-amber-500 shrink-0" />
                          <p className="text-xs text-amber-700 leading-relaxed">
                            Escolhe abaixo o que fazer quando cada regra é detetada. A conta ligada precisa da permissão do WhatsApp para apagar mensagens.
                          </p>
                        </div>
                      </div>
                      <GroupPolicyPanel key={selectedGroup.id} jid={selectedGroup.id} canManage={selectedGroup.permissions.manage} />
                      <section className="border-t pt-3">
                        <h4 className="font-semibold">Atividade recente</h4>
                        {eventsUnavailable && <p className="text-sm">Histórico indisponível.</p>}
                        {!eventsUnavailable && groupEvents.length === 0 && <p className="text-sm">Ainda sem ações registadas.</p>}
                        <ul className="mt-2 grid gap-2 text-sm">
                          {groupEvents.map((event) => <li key={event.id} className="rounded-lg bg-slate-50 p-2">
                            {[moderationRuleLabels[event.rule] ?? "Ocorrência do grupo", event.action && moderationActionLabels[event.action],
                              event.review_status ? reviewStates[event.review_status] : moderationOutcomeLabels[event.outcome] ?? "Estado por confirmar",
                              new Date(event.created_at).toLocaleString("pt-MZ")].filter(Boolean).join(" · ")}
                          </li>)}
                        </ul>
                      </section>
                    </div>
                  </div>
                </div>
                <GroupModerationPanel key={selectedGroup.id} jid={selectedGroup.id} groupName={selectedGroup.subject}
                  canManage={selectedGroup.permissions.manage} canPost={selectedGroup.permissions.post}
                  memberLabel={(jid) => {
                    const target = normalizedMemberId(jid);
                    const member = selectedGroup.participants.find((person) => [person.id, person.lid, person.phoneNumber]
                      .some((identity) => identity && normalizedMemberId(identity) === target));
                    return member?.name || member?.notify;
                  }} />
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white border border-slate-200 rounded-[40px] border-dashed">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <Users className="w-10 h-10 text-slate-200" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Selecione um grupo</h2>
                <p className="text-slate-500 max-w-xs mx-auto mt-2">Escolha um grupo na lista ao lado para gerenciar participantes e configurar regras de moderação.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
