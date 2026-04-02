import React, { useState, useEffect } from "react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { apiFetch } from "../lib/api";
import { toast } from "sonner";

export default function AdminPacks() {
  const [packs, setPacks] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [jsonInput, setJsonInput] = useState<Record<string, string>>({});
  const [importJson, setImportJson] = useState("");

  useEffect(() => {
    fetchPacks();
  }, []);

  const fetchPacks = async () => {
    try {
      const res = await apiFetch("/api/packs/list");
      if (res.success) setPacks(res.data);
    } catch (error: any) {
      console.error("Failed to fetch packs:", error);
      toast.error(error.message || "Erro ao carregar packs");
    }
  };

  const handleImportPack = async () => {
    try {
      const data = JSON.parse(importJson);
      if (!data.name || !data.items || !Array.isArray(data.items)) {
        return toast.error("JSON deve conter 'name' e 'items' (array)");
      }

      const res = await apiFetch("/api/admin/packs/import", {
        method: "POST",
        body: JSON.stringify(data),
      });

      if (res.success) {
        toast.success("Pack importado com sucesso!");
        setImportJson("");
        fetchPacks();
      } else {
        toast.error(res.error || "Erro ao importar pack");
      }
    } catch (e) {
      toast.error("JSON inválido");
    }
  };

  const handleCreatePack = async () => {
    if (!name) return toast.error("Nome é obrigatório");
    
    try {
      const res = await apiFetch("/api/admin/packs", {
        method: "POST",
        body: JSON.stringify({ name, description, is_public: true }),
      });

      if (res.success) {
        toast.success("Pack criado!");
        setName("");
        setDescription("");
        fetchPacks();
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar pack");
    }
  };

  const handleAddItems = async (packId: string) => {
    try {
      const items = JSON.parse(jsonInput[packId] || "[]");
      const res = await apiFetch(`/api/admin/packs/${packId}/items`, {
        method: "POST",
        body: JSON.stringify(items),
      });

      if (res.success) {
        toast.success("Itens adicionados!");
        setJsonInput(prev => ({ ...prev, [packId]: "" }));
      }
    } catch (error: any) {
      toast.error(error.message || "JSON inválido ou erro ao adicionar itens");
    }
  };

  const handleDeletePack = async (packId: string) => {
    try {
      const res = await apiFetch(`/api/admin/packs/${packId}`, {
        method: "DELETE",
      });

      if (res.success) {
        toast.success("Pack excluído!");
        fetchPacks();
      }
    } catch (error: any) {
      console.error("Erro ao excluir pack:", error);
      toast.error(error.message || "Erro ao excluir pack");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Gerenciar Model Packs</h1>
      
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Modelo JSON</h2>
        <p className="text-sm text-slate-500">Copie este modelo para criar ou importar packs:</p>
        <pre className="bg-slate-100 p-4 rounded text-xs font-mono overflow-x-auto text-slate-800 border border-slate-200">
{`{
  "name": "Nome do Pack",
  "description": "Descrição do Pack",
  "items": [
    {
      "trigger": "gatilho",
      "response": "resposta",
      "match_type": "exact"
    }
  ]
}`}
        </pre>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Novo Pack</h2>
        <Input placeholder="Nome do Pack" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button onClick={handleCreatePack}>Criar Pack</Button>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Importar Pack (JSON)</h2>
        <textarea
          className="w-full p-2 border border-slate-200 rounded text-sm font-mono bg-white text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
          rows={5}
          placeholder='{"name": "...", "description": "...", "items": [{"trigger": "...", "response": "..."}]}'
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
        />
        <Button onClick={handleImportPack} variant="outline" className="w-full">
          Importar Pack Completo
        </Button>
      </Card>

      <div className="grid gap-4">
        {packs.map((pack) => (
          <Card key={pack.id} className="p-4 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-slate-900">{pack.name}</h3>
                <p className="text-sm text-slate-500">{pack.description}</p>
              </div>
              <Button 
                variant="ghost" 
                className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 px-2"
                onClick={() => handleDeletePack(pack.id)}
              >
                Excluir
              </Button>
            </div>
            <textarea
              className="w-full p-2 border border-slate-200 rounded text-sm font-mono bg-white text-slate-900 focus:ring-2 focus:ring-emerald-500 outline-none"
              rows={5}
              placeholder='[{"trigger": "marcar", "response": "...", "match_type": "contains"}]'
              value={jsonInput[pack.id] || ""}
              onChange={(e) => setJsonInput(prev => ({ ...prev, [pack.id]: e.target.value }))}
            />
            <Button onClick={() => handleAddItems(pack.id)} variant="secondary" className="w-full">
              Salvar Itens (JSON)
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
