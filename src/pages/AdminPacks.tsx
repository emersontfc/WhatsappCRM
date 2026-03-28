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
    const res = await apiFetch("/api/packs/list");
    if (res.success) setPacks(res.data);
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
    
    const res = await apiFetch("/api/admin/packs", {
      method: "POST",
      body: JSON.stringify({ name, description, is_public: true }),
    });

    if (res.success) {
      toast.success("Pack criado!");
      setName("");
      setDescription("");
      fetchPacks();
    } else {
      toast.error("Erro ao criar pack");
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
      } else {
        toast.error("Erro ao adicionar itens");
      }
    } catch (e) {
      toast.error("JSON inválido");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Gerenciar Model Packs</h1>
      
      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Novo Pack</h2>
        <Input placeholder="Nome do Pack" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button onClick={handleCreatePack}>Criar Pack</Button>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Importar Pack (JSON)</h2>
        <textarea
          className="w-full p-2 border rounded text-sm font-mono"
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
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-semibold">{pack.name}</h3>
                <p className="text-sm text-slate-500">{pack.description}</p>
              </div>
            </div>
            <textarea
              className="w-full p-2 border rounded text-sm font-mono"
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
