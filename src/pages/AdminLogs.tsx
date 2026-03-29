import React, { useState, useEffect, useCallback } from "react";
import { 
  Terminal, 
  Search, 
  Filter, 
  RefreshCw, 
  AlertCircle, 
  Info, 
  AlertTriangle, 
  Bug,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  Globe,
  Database,
  Cpu,
  MessageSquare,
  Shield,
  CreditCard,
  ExternalLink
} from "lucide-react";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

interface LogEntry {
  id: string;
  user_id: string | null;
  level: string;
  source: string;
  category: string;
  message: string;
  details: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  users?: {
    email: string;
    name: string;
  };
}

const AdminLogs: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [limit] = useState(50);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  const fetchLogs = useCallback(async (isAuto = false) => {
    if (!isAuto) setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
        search,
        level,
        category,
        source
      });

      const response = await apiFetch(`/api/logs/admin?${params.toString()}`);
      if (response.success) {
        setLogs(response.data);
        setTotal(response.total);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      if (!isAuto) toast.error("Erro ao carregar logs");
    } finally {
      if (!isAuto) setLoading(false);
    }
  }, [page, limit, search, level, category, source]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    let interval: any;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(true);
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "error": return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "warn": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case "debug": return <Bug className="w-4 h-4 text-blue-500" />;
      default: return <Info className="w-4 h-4 text-slate-500" />;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "auth": return <Shield className="w-4 h-4" />;
      case "subscription": return <CreditCard className="w-4 h-4" />;
      case "whatsapp": return <MessageSquare className="w-4 h-4" />;
      case "ai": return <Cpu className="w-4 h-4" />;
      case "database": return <Database className="w-4 h-4" />;
      default: return <Globe className="w-4 h-4" />;
    }
  };

  const formatDetails = (details: any) => {
    if (!details) return null;
    try {
      return JSON.stringify(details, null, 2);
    } catch {
      return String(details);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Terminal className="w-6 h-6 text-emerald-600" />
            Logs do Sistema
          </h1>
          <p className="text-slate-500 text-sm">Monitoramento em tempo real de erros e eventos</p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? "bg-emerald-50 border-emerald-200 text-emerald-700" : ""}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh ? "Auto-refresh Ativo" : "Auto-refresh Inativo"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchLogs()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Buscar na mensagem..." 
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <select 
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="">Todos os Níveis</option>
            <option value="info">Info</option>
            <option value="warn">Aviso</option>
            <option value="error">Erro</option>
            <option value="debug">Debug</option>
          </select>

          <select 
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Todas as Categorias</option>
            <option value="auth">Autenticação</option>
            <option value="subscription">Assinatura</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="ai">IA</option>
            <option value="system">Sistema</option>
            <option value="database">Banco de Dados</option>
          </select>

          <select 
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Todas as Fontes</option>
            <option value="backend">Backend</option>
            <option value="frontend">Frontend</option>
            <option value="worker">Worker</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500 w-10">Nível</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500 w-32">Data/Hora</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500 w-32">Categoria</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500">Mensagem</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500 w-40">Usuário</th>
                <th className="px-4 py-3 text-xs font-bold uppercase text-slate-500 w-24 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Carregando logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    Nenhum log encontrado
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr 
                    key={log.id} 
                    className={`hover:bg-slate-50 transition-colors cursor-pointer ${log.level === 'error' ? 'bg-red-50/30' : ''}`}
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        {getLevelIcon(log.level)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="w-3 h-3" />
                        {new Date(log.created_at).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        {getCategoryIcon(log.category)}
                        <span className="capitalize">{log.category}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-900 line-clamp-1 font-mono">{log.message}</p>
                      <p className="text-[10px] text-slate-400 uppercase">{log.source}</p>
                    </td>
                    <td className="px-4 py-3">
                      {log.users ? (
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-900">{log.users.name}</span>
                          <span className="text-[10px] text-slate-500">{log.users.email}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Sistema</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLog(log);
                      }}>
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Mostrando {logs.length} de {total} logs
          </p>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs font-medium">Página {page + 1}</span>
            <Button 
              variant="outline" 
              size="sm" 
              disabled={(page + 1) * limit >= total}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Log Detail Modal */}
      <AnimatePresence>
        {selectedLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-3">
                  {getLevelIcon(selectedLog.level)}
                  <h2 className="text-lg font-bold text-slate-900">Detalhes do Log</h2>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedLog(null)}>
                  Fechar
                </Button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold uppercase text-slate-500">Mensagem</label>
                      <p className="text-sm text-slate-900 font-mono bg-slate-50 p-3 rounded-lg border border-slate-200 mt-1">
                        {selectedLog.message}
                      </p>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold uppercase text-slate-500">Nível</label>
                        <p className="text-sm font-medium capitalize mt-1">{selectedLog.level}</p>
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase text-slate-500">Data/Hora</label>
                        <p className="text-sm font-medium mt-1">{new Date(selectedLog.created_at).toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold uppercase text-slate-500">Fonte</label>
                        <p className="text-sm font-medium capitalize mt-1">{selectedLog.source}</p>
                      </div>
                      <div>
                        <label className="text-xs font-bold uppercase text-slate-500">Categoria</label>
                        <p className="text-sm font-medium capitalize mt-1">{selectedLog.category}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold uppercase text-slate-500">Usuário</label>
                      <div className="flex items-center gap-3 mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                          <User className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{selectedLog.users?.name || "Sistema"}</p>
                          <p className="text-xs text-slate-500">{selectedLog.users?.email || "N/A"}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase text-slate-500">IP / User Agent</label>
                      <div className="mt-1 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                        <p className="text-xs font-mono text-slate-600">IP: {selectedLog.ip_address || "N/A"}</p>
                        <p className="text-[10px] font-mono text-slate-500 leading-relaxed">
                          UA: {selectedLog.user_agent || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-slate-500">Detalhes Técnicos (JSON)</label>
                  <pre className="mt-1 p-4 bg-slate-900 text-emerald-400 rounded-lg text-xs font-mono overflow-x-auto">
                    {formatDetails(selectedLog.details)}
                  </pre>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 text-right">
                <Button variant="primary" onClick={() => setSelectedLog(null)}>
                  Entendido
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminLogs;
