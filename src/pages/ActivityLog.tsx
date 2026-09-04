import { useState, useEffect } from "react";
import { 
  Activity, 
  Search, 
  Filter, 
  Download,
  AlertCircle,
  CheckCircle2,
  Info,
  ShieldAlert,
  Terminal
} from "lucide-react";
import { supabase, getUserId } from "../supabase";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { cn } from "../lib/utils";

export default function ActivityLog() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchLogs = async () => {
      const userId = await getUserId();
      if (!userId) return;

      const { data, error } = await supabase
        .from("logs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) console.error("Error fetching logs:", error);
      else {
        const normalized = (data || []).map((l: any) => ({
          ...l,
          level: l.type || l.level || 'info',
          details: l.metadata || l.details || {}
        }));
        setLogs(normalized);
      }
      setLoading(false);
    };

    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => 
    log.message?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.level?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getLevelIcon = (level: string) => {
    switch (level) {
      case "error": return <ShieldAlert className="text-red-500" size={18} />;
      case "warn": return <AlertCircle className="text-amber-500" size={18} />;
      case "success": return <CheckCircle2 className="text-emerald-500" size={18} />;
      default: return <Info className="text-blue-500" size={18} />;
    }
  };

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Activity className="text-emerald-600" />
            Logs de Atividade
          </h2>
          <p className="text-slate-500 font-medium">
            Histórico completo de eventos do sistema.
          </p>
        </div>
        <Button variant="outline" className="rounded-xl border-slate-200">
          <Download size={16} className="mr-2" />
          Exportar Logs
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <Input 
            placeholder="Buscar nos logs..." 
            className="pl-10 rounded-xl border-slate-200"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" className="rounded-xl border-slate-200">
          <Filter size={16} className="mr-2" />
          Filtrar por Nível
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
        </div>
      ) : filteredLogs.length > 0 ? (
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="divide-y divide-slate-50 font-mono">
            {filteredLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-50/50 transition-colors flex items-start gap-4">
                <div className="mt-1">{getLevelIcon(log.level)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={log.level === 'error' ? 'error' : log.level === 'warn' ? 'warning' : log.level === 'success' ? 'success' : 'info'} className="text-[10px] uppercase font-black tracking-widest px-2 py-0">
                        {log.level}
                      </Badge>
                      <span className="text-[10px] text-slate-400 font-bold">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed break-words">
                    {log.message}
                  </p>
                  {log.details && Object.keys(log.details).length > 0 && (
                    <div className="mt-2 p-2 bg-slate-900 rounded-lg overflow-x-auto">
                      <pre className="text-[10px] text-emerald-400">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
          <div className="h-16 w-16 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-200">
            <Terminal size={32} />
          </div>
          <div className="space-y-1">
            <p className="text-slate-900 font-bold">Nenhum log encontrado</p>
            <p className="text-slate-500 text-sm">Os eventos do sistema aparecerão aqui.</p>
          </div>
        </div>
      )}
    </div>
  );
}
