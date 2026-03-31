import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Trash2, Search, Zap } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { apiFetch } from "../lib/api";
import { useActivation } from "../lib/useActivation";

interface QuickReply {
  id: string;
  trigger: string;
  response_text: string;
  response_type: string;
}

export default function QuickReplies() {
  const navigate = useNavigate();
  const { isActivated } = useActivation();
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchReplies = async () => {
    try {
      const response = await apiFetch("/api/packs/my");
      if (response.success) {
        setReplies(response.data);
      }
    } catch (err) {
      console.error("Error fetching quick replies:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReplies();
  }, []);

  const handleDelete = async (id: string) => {
    try {
      const response = await apiFetch(`/api/packs/${id}`, {
        method: "DELETE",
      });
      if (response.success) {
        toast.success("Resposta rápida excluída!");
        setReplies(prev => prev.filter(r => r.id !== id));
      }
    } catch (err) {
      toast.error("Erro ao excluir resposta rápida.");
    }
  };

  const filtered = replies.filter(r => 
    r.trigger.toLowerCase().includes(search.toLowerCase()) || 
    r.response_text.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <Input 
            placeholder="Buscar respostas rápidas..." 
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button 
          variant="outline" 
          className="gap-2"
          onClick={() => window.location.href = '/user-models'}
        >
          <Zap size={18} className="text-amber-500" />
          Importar Novos Packs
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((reply) => (
          <Card key={reply.id} className="hover:border-emerald-200 transition-colors group">
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-emerald-100 group-hover:text-emerald-600 transition-colors">
                  <MessageSquare size={20} />
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-red-500 hover:bg-red-50"
                  onClick={() => handleDelete(reply.id)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              <div className="space-y-2">
                <div className="inline-flex px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wider">
                  Gatilho: {reply.trigger}
                </div>
                <p className="text-sm text-slate-600 line-clamp-3 font-medium">
                  {reply.response_text}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-200">
          <MessageSquare size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">Nenhuma resposta rápida encontrada.</p>
          <Button 
            variant="ghost" 
            className="mt-2 text-emerald-600 hover:bg-emerald-50"
            onClick={() => navigate("/models")}
          >
            Importar um pack de modelos
          </Button>
        </div>
      )}
    </div>
  );
}
