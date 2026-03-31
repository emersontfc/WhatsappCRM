import React, { useState, useEffect } from "react";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { apiFetch } from "../lib/api";
import { toast } from "sonner";

export default function UserModels() {
  const [packs, setPacks] = useState<any[]>([]);

  useEffect(() => {
    fetchPacks();
  }, []);

  const fetchPacks = async () => {
    try {
      const res = await apiFetch("/api/packs/list");
      if (res.success) setPacks(res.data);
    } catch (error: any) {
      console.error("Failed to fetch packs:", error);
      toast.error(error.message || "Erro ao carregar modelos");
    }
  };

  const handleImport = async (packId: string) => {
    try {
      const res = await apiFetch(`/api/packs/import/${packId}`, { method: "POST" });
      if (res.success) {
        toast.success("Pack importado com sucesso!");
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao importar pack");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Modelos Disponíveis</h1>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {packs.map((pack) => (
          <Card key={pack.id} className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">{pack.name}</h2>
            <p className="text-sm text-slate-500">{pack.description}</p>
            <Button onClick={() => handleImport(pack.id)} className="w-full">
              Importar Pack
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
