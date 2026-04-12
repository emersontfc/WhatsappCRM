import React, { useState, useEffect } from "react";
import { MenuBuilder } from "../components/MenuBuilder";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Plus, Trash2, Play, Pause, Settings2 } from "lucide-react";
import { cn } from "../lib/utils";

export default function MenuBuilderPage() {
  const [menus, setMenus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingMenu, setEditingMenu] = useState<any>(null);

  const fetchMenus = async () => {
    try {
      const data = await apiFetch("/api/menus");
      setMenus(data);
    } catch (error) {
      console.error("Error fetching menus:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMenus();
  }, []);

  const handleSave = async (menuData: any) => {
    try {
      const payload = {
        ...menuData,
        id: editingMenu?.id
      };
      
      await apiFetch("/api/menus", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      
      toast.success(editingMenu ? "Menu atualizado!" : "Menu criado com sucesso!");
      setIsAdding(false);
      setEditingMenu(null);
      fetchMenus();
    } catch (error: any) {
      console.error("Error saving menu:", error);
      const message = error.message || "Erro ao salvar menu.";
      toast.error(message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este menu?")) return;
    try {
      await apiFetch(`/api/menus/${id}`, { method: "DELETE" });
      toast.success("Menu excluído.");
      fetchMenus();
    } catch (error) {
      toast.error("Erro ao excluir menu.");
    }
  };

  const toggleActive = async (menu: any) => {
    try {
      await apiFetch("/api/menus", {
        method: "POST",
        body: JSON.stringify({ ...menu, active: !menu.active })
      });
      fetchMenus();
    } catch (error) {
      toast.error("Erro ao alterar status.");
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">Menu Inteligente</h1>
          <p className="text-slate-500 font-medium">Crie fluxos de atendimento automáticos usando menus numéricos.</p>
        </div>
        {!isAdding && (
          <Button 
            onClick={() => {
              setEditingMenu(null);
              setIsAdding(true);
            }}
            className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl px-6 py-6 h-auto font-bold shadow-lg shadow-emerald-500/20"
          >
            <Plus className="mr-2" /> Novo Menu
          </Button>
        )}
      </div>

      {isAdding ? (
        <div className="space-y-6">
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setIsAdding(false)} className="rounded-xl">Cancelar</Button>
          </div>
          <MenuBuilder onSave={handleSave} initialData={editingMenu} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full py-20 text-center text-slate-400 font-medium">Carregando menus...</div>
          ) : menus.length === 0 ? (
            <div className="col-span-full py-20 bg-white rounded-[2rem] border border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 space-y-4">
              <p>Nenhum menu criado ainda.</p>
              <Button variant="outline" onClick={() => setIsAdding(true)} className="rounded-xl">Criar Primeiro Menu</Button>
            </div>
          ) : (
            menus.map((menu) => (
              <Card key={menu.id} className={cn(
                "group transition-all duration-300 hover:shadow-xl",
                !menu.active && "opacity-60"
              )}>
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-bold truncate pr-4">{menu.name}</CardTitle>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-slate-400 hover:text-emerald-500"
                        onClick={() => {
                          setEditingMenu(menu);
                          setIsAdding(true);
                        }}
                      >
                        <Settings2 size={16} />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-slate-400 hover:text-red-500"
                        onClick={() => handleDelete(menu.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="line-clamp-2">{menu.message}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      {menu.options?.length || 0} Opções
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      className={cn(
                        "rounded-lg font-bold text-[10px] uppercase tracking-widest",
                        menu.active ? "text-amber-500 hover:bg-amber-50" : "text-emerald-500 hover:bg-emerald-50"
                      )}
                      onClick={() => toggleActive(menu)}
                    >
                      {menu.active ? <Pause size={14} className="mr-1" /> : <Play size={14} className="mr-1" />}
                      {menu.active ? "Pausar" : "Ativar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
      
      <Card className="border-slate-100 bg-slate-50/50">
        <CardHeader>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-500">Como funciona?</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-slate prose-sm max-w-none">
          <p>
            Este sistema substitui os botões nativos do WhatsApp (que costumam falhar em muitos aparelhos) por uma interface baseada em números.
            Crie menus interativos modernos e profissionais utilizando os recursos nativos do WhatsApp.
          </p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Mensagem Principal:</strong> O texto que inicia a conversa.</li>
            <li><strong>Opções:</strong> Cada opção recebe um número automático (1️⃣, 2️⃣, 3️⃣...).</li>
            <li><strong>Resposta:</strong> O que o cliente recebe ao digitar o número correspondente.</li>
            <li><strong>Compatibilidade:</strong> Funciona 100% em WhatsApp Web, Android, iOS e até aparelhos antigos.</li>
            <li><strong>Botões (até 3 opções):</strong> O cliente verá botões rápidos diretamente na conversa.</li>
            <li><strong>Listas (+4 opções):</strong> O menu se transforma numa lista suspensa nativa do WhatsApp.</li>
            <li><strong>Resposta:</strong> O que o cliente recebe ao clicar na opção.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
