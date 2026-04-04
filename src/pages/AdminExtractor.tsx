import React, { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { Loader2, Search } from "lucide-react";

export default function AdminExtractor() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleExtract = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await apiFetch("/api/extractor", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      setResult(data);
      toast.success("Extração concluída!");
    } catch (err: any) {
      toast.error(err.message || "Erro na extração");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Extração de Dados Web (Admin)</h1>
      
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Nova Extração</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-4">
          <Input 
            value={url} 
            onChange={(e) => setUrl(e.target.value)} 
            placeholder="Cole a URL aqui..." 
            className="flex-1"
          />
          <Button onClick={handleExtract} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Search />}
            Extrair
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-slate-900 text-slate-50 p-4 rounded-xl overflow-auto max-h-96">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
