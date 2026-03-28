import { useState, useEffect } from "react";
import { Button } from "../components/ui/Button";
import { apiFetch } from "../lib/api";
import { toast } from "sonner";

interface Template {
  id: string;
  name: string;
  description: string;
}

export function TemplateModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const fetchTemplates = async () => {
        try {
          const response = await apiFetch("/api/templates/list");
          if (response.success) setTemplates(response.data);
        } catch (err) {
          console.error("Error fetching templates:", err);
        }
      };
      fetchTemplates();
    }
  }, [isOpen]);

  const applyTemplate = async (templateId: string) => {
    setLoading(true);
    try {
      const response = await apiFetch(`/api/templates/apply/${templateId}`, { method: "POST" });
      if (response.success) {
        toast.success("Template aplicado com sucesso!");
        onClose();
        window.location.reload();
      } else {
        throw new Error(response.error);
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao aplicar template.");
    } finally {
      setLoading(false);
    }
  };

  const skipTemplate = async () => {
    setLoading(true);
    try {
      // Mark as applied in DB so it doesn't show again
      await apiFetch(`/api/templates/skip`, { method: "POST" });
      onClose();
      window.location.reload();
    } catch (err: any) {
      toast.error("Erro ao pular template.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
        <h2 className="text-lg font-bold mb-2">Qual é o seu tipo de negócio?</h2>
        <p className="text-sm text-slate-500 mb-4">Escolha um template para configurar automaticamente suas automações e IA.</p>
        <div className="grid gap-2">
          {templates.map((t) => (
            <Button key={t.id} variant="outline" onClick={() => applyTemplate(t.id)} disabled={loading}>
              {t.name}
            </Button>
          ))}
          <Button variant="ghost" onClick={skipTemplate} disabled={loading}>Pular</Button>
        </div>
      </div>
    </div>
  );
}
