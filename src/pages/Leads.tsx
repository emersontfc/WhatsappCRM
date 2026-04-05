import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  UserPlus, 
  Search, 
  Phone, 
  MessageSquare, 
  Calendar,
  MoreVertical,
  Filter,
  Download,
  ChevronRight,
  User
} from "lucide-react";
import { supabase, getUserId } from "../supabase";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { cn } from "../lib/utils";

export default function Leads() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchLeads = async () => {
      const userId = await getUserId();
      if (!userId) return;

      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) console.error("Error fetching leads:", error);
      else setLeads(data || []);
      setLoading(false);
    };

    fetchLeads();
  }, []);

  const filteredLeads = leads.filter(lead => 
    lead.phone?.includes(searchTerm) || 
    lead.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    lead.intent?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-10 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <UserPlus className="text-emerald-600" />
            Leads Capturados
          </h2>
          <p className="text-slate-500 font-medium">
            Gerencie os contatos capturados pelo seu assistente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="rounded-xl border-slate-200">
            <Download size={16} className="mr-2" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <Input 
            placeholder="Buscar por nome, telefone ou intenção..." 
            className="pl-10 rounded-xl border-slate-200"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Button variant="outline" className="rounded-xl border-slate-200">
          <Filter size={16} className="mr-2" />
          Filtros
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent"></div>
        </div>
      ) : filteredLeads.length > 0 ? (
        <div className="space-y-4">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-hidden bg-white border border-slate-100 rounded-2xl shadow-sm">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Lead</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Intenção</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Última Mensagem</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Data</th>
                  <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredLeads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                          <User size={20} />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{lead.name || "Sem nome"}</p>
                          <p className="text-xs text-slate-500">{lead.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {lead.intent ? (
                        <Badge variant="info" className="rounded-lg font-bold text-[10px] uppercase tracking-widest">
                          {lead.intent}
                        </Badge>
                      ) : (
                        <span className="text-slate-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-slate-600 line-clamp-1 max-w-[200px]">
                        {lead.last_message}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs text-slate-500">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-400">
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="grid grid-cols-1 gap-4 md:hidden">
            {filteredLeads.map((lead) => (
              <Card key={lead.id} className="p-4 border-slate-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                      <User size={20} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900">{lead.name || "Sem nome"}</p>
                      <p className="text-xs text-slate-500">{lead.phone}</p>
                    </div>
                  </div>
                  {lead.intent && (
                    <Badge variant="info" className="rounded-lg font-bold text-[10px] uppercase tracking-widest">
                      {lead.intent}
                    </Badge>
                  )}
                </div>
                
                <div className="bg-slate-50 p-3 rounded-xl space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Última Mensagem</p>
                  <p className="text-sm text-slate-600 line-clamp-2 leading-relaxed">
                    {lead.last_message}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                  <div className="flex items-center gap-2 text-slate-400">
                    <Calendar size={14} />
                    <span className="text-xs">{new Date(lead.created_at).toLocaleDateString()}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-emerald-600 font-bold text-xs">
                    Ver Detalhes
                    <ChevronRight size={14} className="ml-1" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-64 text-center space-y-4">
          <div className="h-16 w-16 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-200">
            <UserPlus size={32} />
          </div>
          <div className="space-y-1">
            <p className="text-slate-900 font-bold">Nenhum lead encontrado</p>
            <p className="text-slate-500 text-sm">Seus leads aparecerão aqui assim que o bot começar a interagir.</p>
          </div>
        </div>
      )}
    </div>
  );
}
