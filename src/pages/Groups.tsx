import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  Shield, 
  UserMinus, 
  UserPlus, 
  Settings, 
  MoreVertical, 
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Info,
  ArrowLeft,
  Trash2,
  Lock,
  Unlock,
  ShieldAlert,
  ShieldCheck,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';

interface Group {
  id: string;
  subject: string;
  participants: any[];
  creation?: number;
  owner?: string;
  desc?: string;
}

interface GroupRule {
  id: string;
  type: 'anti_link' | 'anti_spam' | 'anti_flood' | 'welcome_msg';
  active: boolean;
  config?: any;
}

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [groupRules, setGroupRules] = useState<any>({
    anti_link: false,
    anti_spam: false,
    anti_flood: false,
    welcome_msg: '',
    active: true
  });

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      setLoading(true);
      const data = await apiFetch('/api/whatsapp/groups');
      if (data.success) {
        setGroups(data.groups);
      } else {
        toast.error(data.error || 'Falha ao carregar grupos');
      }
    } catch (err) {
      toast.error('Erro ao conectar ao servidor');
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupDetails = async (jid: string) => {
    try {
      const data = await apiFetch(`/api/whatsapp/groups/${jid}`);
      if (data.success) {
        setSelectedGroup(data.metadata);
        fetchGroupRules(jid);
      }
    } catch (err) {
      toast.error('Erro ao carregar detalhes do grupo');
    }
  };

  const fetchGroupRules = async (jid: string) => {
    try {
      const data = await apiFetch(`/api/whatsapp/groups/${jid}/rules`);
      if (data.success && data.data) {
        setGroupRules(data.data);
      } else {
        setGroupRules({
          anti_link: false,
          anti_spam: false,
          anti_flood: false,
          welcome_msg: '',
          active: true
        });
      }
    } catch (err) {
      console.error('Error fetching rules:', err);
    }
  };

  const saveRules = async (newRules: any) => {
    if (!selectedGroup) return;
    try {
      const data = await apiFetch(`/api/whatsapp/groups/${selectedGroup.id}/rules`, {
        method: 'POST',
        body: JSON.stringify(newRules)
      });
      if (data.success) {
        toast.success('Regras salvas com sucesso');
        setGroupRules(data.data);
      } else {
        toast.error(data.error || 'Falha ao salvar regras');
      }
    } catch (err) {
      toast.error('Erro ao salvar regras');
    }
  };

  const handleParticipantAction = async (participantJid: string, action: 'add' | 'remove' | 'promote' | 'demote') => {
    if (!selectedGroup) return;
    
    const actionLabel = action === 'remove' ? 'remover' : action === 'promote' ? 'promover' : 'despromover';
    
    // Using toast as a simple confirmation for now to avoid iFrame blocks
    toast.info(`Processando: ${actionLabel} participante...`);

    try {
      const data = await apiFetch(`/api/whatsapp/groups/${selectedGroup.id}/participants`, {
        method: 'POST',
        body: JSON.stringify({
          participants: [participantJid],
          action
        })
      });
      if (data.success) {
        toast.success(`Participante ${actionLabel} com sucesso`);
        fetchGroupDetails(selectedGroup.id);
      } else {
        toast.error(data.error || `Falha ao ${actionLabel} participante`);
      }
    } catch (err) {
      toast.error('Erro ao processar solicitação');
    }
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroup) return;
    
    toast.info('Saindo do grupo...');

    try {
      const data = await apiFetch(`/api/whatsapp/groups/${selectedGroup.id}/leave`, {
        method: 'POST'
      });
      if (data.success) {
        toast.success('Você saiu do grupo');
        setSelectedGroup(null);
        fetchGroups();
      } else {
        toast.error(data.error || 'Falha ao sair do grupo');
      }
    } catch (err) {
      toast.error('Erro ao processar solicitação');
    }
  };

  const toggleRule = (field: string) => {
    const newRules = { ...groupRules, [field]: !groupRules[field] };
    setGroupRules(newRules);
    saveRules(newRules);
  };

  const handleWelcomeMsgChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setGroupRules({ ...groupRules, welcome_msg: e.target.value });
  };

  const filteredGroups = groups.filter(g => 
    g.subject.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto dark:bg-slate-950 min-h-screen transition-colors duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Gestão de Grupos</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Gerencie seus grupos de WhatsApp, participantes e regras de moderação.</p>
        </div>
        <button 
          onClick={fetchGroups}
          className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400 font-medium shadow-sm"
        >
          <Users className="w-4 h-4" />
          Atualizar Lista
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Sidebar: Group List */}
        <div className="lg:col-span-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text"
              placeholder="Buscar grupos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all dark:text-white dark:placeholder:text-slate-600"
            />
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
              <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Seus Grupos ({filteredGroups.length})</span>
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center">
                  <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p className="text-sm text-slate-400 dark:text-slate-500">Carregando grupos...</p>
                </div>
              ) : filteredGroups.length === 0 ? (
                <div className="p-8 text-center text-slate-400 dark:text-slate-600">
                  <Users className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">Nenhum grupo encontrado</p>
                </div>
              ) : (
                filteredGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => fetchGroupDetails(group.id)}
                    className={`w-full p-4 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-left border-b border-slate-50 dark:border-slate-800 last:border-0 ${selectedGroup?.id === group.id ? 'bg-emerald-50/50 dark:bg-emerald-500/10 border-l-4 border-l-emerald-500' : ''}`}
                  >
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 shrink-0">
                      <Users className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">{group.subject}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{group.id}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content: Group Details & Rules */}
        <div className="lg:col-span-8">
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
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4">
                    <button 
                      onClick={() => setSelectedGroup(null)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 dark:text-slate-500 transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Users className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{selectedGroup.subject}</h2>
                      <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{selectedGroup.desc || 'Sem descrição'}</p>
                      <div className="flex flex-wrap gap-2 mt-4">
                        <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-full text-xs font-medium flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {selectedGroup.participants?.length || 0} Participantes
                        </span>
                        <span className="px-3 py-1 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-medium flex items-center gap-1">
                          <Shield className="w-3 h-3" />
                          Admin Ativo
                        </span>
                        <button 
                          onClick={handleLeaveGroup}
                          className="px-3 py-1 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-full text-xs font-bold flex items-center gap-1 transition-colors"
                        >
                          <LogOut className="w-3 h-3" />
                          Sair do Grupo
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Participants List */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
                      <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-500" />
                        Participantes
                      </h3>
                    </div>
                    <div className="flex-1 max-h-[400px] overflow-y-auto p-2 space-y-1">
                      {selectedGroup.participants?.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-colors group">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs font-bold">
                              {p.id.substring(0, 2)}
                            </div>
                            <div className="truncate">
                              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{p.id.split('@')[0]}</p>
                              {p.admin && <span className="text-[10px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Admin</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            {p.admin ? (
                              <button
                                onClick={() => handleParticipantAction(p.id, 'demote')}
                                className="p-2 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                                title="Remover Admin"
                              >
                                <Shield className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleParticipantAction(p.id, 'promote')}
                                className="p-2 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                                title="Promover a Admin"
                              >
                                <ShieldCheck className="w-4 h-4" />
                              </button>
                            )}
                            <button 
                              onClick={() => handleParticipantAction(p.id, 'remove')}
                              className="p-2 text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                              title="Remover do grupo"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Moderation Rules */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                      <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-emerald-500" />
                        Regras de Moderação
                      </h3>
                    </div>
                    <div className="p-4 space-y-4">
                      {/* Anti-Link */}
                      <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-2xl hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${groupRules.anti_link ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}>
                            <Lock className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">Anti-Link</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Remove links de não-admins</p>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleRule('anti_link')}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${groupRules.anti_link ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${groupRules.anti_link ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>

                      {/* Anti-Spam */}
                      <div className="flex items-center justify-between p-3 border border-slate-100 dark:border-slate-800 rounded-2xl hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${groupRules.anti_spam ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}>
                            <Shield className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">Anti-Spam</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">Bloqueia mensagens repetitivas</p>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleRule('anti_spam')}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${groupRules.anti_spam ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${groupRules.anti_spam ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>

                      {/* Welcome Message */}
                      <div className="space-y-3 p-3 border border-slate-100 dark:border-slate-800 rounded-2xl hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${groupRules.welcome_msg ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}>
                              <MessageSquare className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900 dark:text-white">Boas-vindas</p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">Saudação automática para novos membros</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <textarea
                            value={groupRules.welcome_msg}
                            onChange={handleWelcomeMsgChange}
                            placeholder="Olá {user}, bem-vindo ao grupo!"
                            className="w-full p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500/20 outline-none min-h-[80px] resize-none dark:text-white dark:placeholder:text-slate-600"
                          />
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">Use {"{user}"} para mencionar o membro</span>
                            <button 
                              onClick={() => saveRules(groupRules)}
                              className="px-3 py-1 bg-emerald-500 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-600 transition-colors"
                            >
                              Salvar Mensagem
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-2xl">
                        <div className="flex gap-3">
                          <Info className="w-5 h-5 text-amber-500 shrink-0" />
                          <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                            <strong>Nota:</strong> Para as regras funcionarem, o bot precisa ser <strong>Administrador</strong> do grupo. Algumas regras podem levar até 30s para serem aplicadas.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[40px] border-dashed">
                <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                  <Users className="w-10 h-10 text-slate-200 dark:text-slate-700" />
                </div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">Selecione um grupo</h2>
                <p className="text-slate-500 dark:text-slate-400 max-w-xs mx-auto mt-2">Escolha um grupo na lista ao lado para gerenciar participantes e configurar regras de moderação.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
