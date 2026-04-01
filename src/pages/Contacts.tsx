import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Tag, Trash2, Phone, User, Users, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId, isAdmin as checkIsAdmin } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardContent } from "../components/ui/Card";
import { useActivation } from "../lib/useActivation";
import { UpgradePrompt } from "../components/UpgradePrompt";

interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  last_contact?: string;
}

export default function Contacts() {
  const navigate = useNavigate();
  const { isActivated, planDetails, loading: activationLoading } = useActivation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", phone: "", tags: "", countryCode: "258" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activationLoading) return;
    const init = async () => {
      const userId = await getUserId();
      if (!userId) return;
      
      // Initial fetch
      const { data: initialContacts, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("user_id", userId)
        .order("name", { ascending: true });

      if (error) {
        console.error("Error fetching initial contacts:", error);
      }
      
      if (initialContacts) {
        const manualContacts = initialContacts
          .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }))
          .filter(c => {
            const tags = c.tags;
            // Show if it's explicitly manual/imported OR if it doesn't have the WhatsApp tag
            return tags.includes("Manual") || tags.includes("Importado") || !tags.includes("WhatsApp");
          });
        setContacts(manualContacts);
      }

      // Real-time subscription
      const subscription = supabase
        .channel('public:contacts')
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'contacts',
          filter: `user_id=eq.${userId}`
        }, async () => {
          const { data: updatedContacts } = await supabase
            .from("contacts")
            .select("*")
            .eq("user_id", userId)
            .order("name", { ascending: true });
          
          if (updatedContacts) {
            const manualContacts = updatedContacts
              .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }))
              .filter(c => {
                const tags = c.tags;
                return tags.includes("Manual") || tags.includes("Importado") || !tags.includes("WhatsApp");
              });
            setContacts(manualContacts);
          }
        })
        .subscribe();

      return () => {
        supabase.removeChannel(subscription);
      };
    };

    const cleanupPromise = init();
    return () => {
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [activationLoading]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name || !newContact.phone) return;

    if (planDetails && contacts.length >= planDetails.max_contacts) {
      toast.error(`Limite de contatos atingido (${planDetails.max_contacts}). Faça upgrade do seu plano.`);
      return;
    }

    try {
      const userId = await getUserId();
      
      // Clean the phone number: remove all non-digits
      let phone = newContact.phone.replace(/\D/g, "");
      const countryCode = newContact.countryCode.replace(/\D/g, "");
      
      // If the number is short (e.g. 9 digits for Mozambique) and doesn't start with country code
      // or if it's just a local number, prepend the country code.
      if (phone.length <= 10 && !phone.startsWith(countryCode)) {
        phone = countryCode + phone;
      }
      
      const userTags = newContact.tags.split(",").map(t => t.trim()).filter(Boolean);
      
      if (!userTags.includes("Manual")) {
        userTags.push("Manual");
      }

      // Check if contact already exists
      const { data: existingContact } = await supabase
        .from("contacts")
        .select("id, tags")
        .eq("user_id", userId)
        .eq("phone", phone)
        .maybeSingle();

      if (existingContact) {
        // Merge tags
        const currentTags = Array.isArray(existingContact.tags) ? existingContact.tags : [];
        const mergedTags = Array.from(new Set([...currentTags, ...userTags]));
        
        const { error } = await supabase
          .from("contacts")
          .update({
            name: newContact.name,
            tags: mergedTags,
          })
          .eq("id", existingContact.id);
        
        if (error) throw error;
      } else {
        const { error } = await supabase.from("contacts").insert({
          user_id: userId,
          name: newContact.name,
          phone: phone,
          tags: userTags,
          created_at: new Date().toISOString(),
        });

        if (error) throw error;
      }

      // Manual refresh as fallback for real-time
      const { data: refreshedContacts, error: refreshError } = await supabase
        .from("contacts")
        .select("*")
        .eq("user_id", userId);
      
      if (refreshError) {
        console.error("Error refreshing contacts:", refreshError);
      }

      console.log("Refreshed contacts count:", refreshedContacts?.length || 0);

      if (refreshedContacts) {
        const manualContacts = refreshedContacts
          .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }))
          .filter(c => {
            const tags = c.tags;
            return tags.includes("Manual") || tags.includes("Importado");
          });
        setContacts(manualContacts);
      }

      setNewContact({ name: "", phone: "", tags: "", countryCode: "258" });
      setIsAdding(false);
      toast.success("Contato salvo!");
    } catch (err) {
      console.error("Error adding contact:", err);
      toast.error("Erro ao adicionar contato.");
    }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split('\n');
        const userId = await getUserId();
        
        let importedCount = 0;
        const contactsToInsert = [];

        // Skip header row if it exists, or just parse all lines
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const parts = line.split(',');
          if (parts.length >= 2) {
            // Assume format: Name, Phone, [Tags...]
            const name = parts[0].trim();
            let phone = parts[1].replace(/\D/g, "");
            
            // Default country code for imports if not present (Mozambique: 9 digits)
            if (phone.length <= 10 && !phone.startsWith("258")) {
              phone = "258" + phone;
            }
            
            if (name && phone) {
              contactsToInsert.push({
                user_id: userId,
                name,
                phone,
                tags: ["Importado"],
                created_at: new Date().toISOString(),
              });
              importedCount++;
            }
          }
        }

        if (contactsToInsert.length > 0) {
          if (planDetails && contacts.length + contactsToInsert.length > planDetails.max_contacts) {
            toast.error(`Limite de contatos atingido (${planDetails.max_contacts}). Você pode importar no máximo ${planDetails.max_contacts - contacts.length} contatos.`);
            return;
          }

          let successCount = 0;
          for (const contact of contactsToInsert) {
            try {
              const { data: existing } = await supabase
                .from("contacts")
                .select("id, tags")
                .eq("user_id", userId)
                .eq("phone", contact.phone)
                .maybeSingle();

              if (existing) {
                const currentTags = Array.isArray(existing.tags) ? existing.tags : [];
                const mergedTags = Array.from(new Set([...currentTags, "Importado"]));
                await supabase
                  .from("contacts")
                  .update({ name: contact.name, tags: mergedTags })
                  .eq("id", existing.id);
              } else {
                await supabase.from("contacts").insert(contact);
              }
              successCount++;
            } catch (err) {
              console.error("Error processing contact in CSV:", err);
            }
          }
          toast.success(`${successCount} contatos processados com sucesso!`);
          
          // Manual refresh as fallback for real-time
          const { data: refreshedContacts } = await supabase
            .from("contacts")
            .select("*")
            .eq("user_id", userId);
          
          if (refreshedContacts) {
            const manualContacts = refreshedContacts
              .map(c => ({ ...c, tags: Array.isArray(c.tags) ? c.tags : [] }))
              .filter(c => {
                const tags = c.tags;
                return tags.includes("Manual") || tags.includes("Importado") || !tags.includes("WhatsApp");
              });
            setContacts(manualContacts);
          }
        } else {
          toast.error("Nenhum contato válido encontrado no CSV. Use o formato: Nome, Telefone");
        }
      } catch (err) {
        console.error("Error importing contacts:", err);
        toast.error("Erro ao importar contatos.");
      }
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleSendMessage = (phone: string) => {
    toast.info(`Iniciando conversa com ${phone}...`);
    navigate(`/messages?phone=${phone}`);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("contacts")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      
      setContacts(prev => prev.filter(c => c.id !== id));
      toast.success("Contato excluído!");
    } catch (err) {
      console.error("Error deleting contact:", err);
      toast.error("Erro ao excluir contato.");
    }
  };

  const filtered = contacts.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  );

  return (
    <div className="space-y-6">
      {planDetails && contacts.length >= planDetails.max_contacts && (
        <UpgradePrompt 
          title="Limite de Contatos Atingido"
          description={`Você atingiu o limite de ${planDetails.max_contacts} contatos do seu plano atual.`}
        />
      )}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <Input 
            placeholder="Buscar contatos..." 
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex w-full sm:w-auto gap-2">
          <input 
            type="file" 
            accept=".csv" 
            className="hidden" 
            ref={fileInputRef}
            onChange={handleImportCSV}
          />
          <Button 
            variant="outline"
            className="flex-1 sm:flex-none gap-2" 
            onClick={() => isActivated ? fileInputRef.current?.click() : toast.error("Ative sua conta para importar contatos.")}
            disabled={!isActivated}
          >
            <Upload size={18} />
            Importar CSV
          </Button>
          <Button 
            className="flex-1 sm:flex-none gap-2" 
            onClick={() => isActivated ? setIsAdding(true) : toast.error("Ative sua conta para adicionar contatos.")}
            disabled={!isActivated}
          >
            <Plus size={18} />
            Novo Contato
          </Button>
        </div>
      </div>

      {isAdding && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/10">
          <CardContent className="p-6">
            <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome</label>
                <Input 
                  placeholder="Nome do cliente" 
                  value={newContact.name}
                  onChange={e => setNewContact({...newContact, name: e.target.value})}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Telefone</label>
                <div className="flex gap-2">
                  <div className="w-20 shrink-0">
                    <Input 
                      placeholder="+258" 
                      value={newContact.countryCode}
                      onChange={e => setNewContact({...newContact, countryCode: e.target.value.replace(/\D/g, "")})}
                      className="text-center"
                    />
                  </div>
                  <Input 
                    placeholder="84 88 5828 8" 
                    value={newContact.phone}
                    onChange={e => setNewContact({...newContact, phone: e.target.value})}
                    required
                  />
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">O código do país será adicionado automaticamente se necessário.</p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tags (separadas por vírgula)</label>
                <Input 
                  placeholder="VIP, Lead, Novo" 
                  value={newContact.tags}
                  onChange={e => setNewContact({...newContact, tags: e.target.value})}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Salvar</Button>
                <Button variant="ghost" type="button" onClick={() => setIsAdding(false)}>Cancelar</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((contact) => (
          <Card key={contact.id} className="hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors group">
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="h-12 w-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400 dark:text-slate-500 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-500/20 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  <User size={24} />
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                    onClick={() => handleSendMessage(contact.phone)}
                  >
                    <Send size={16} />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => handleDelete(contact.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-900 dark:text-white">{contact.name}</h4>
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Phone size={14} />
                  {contact.phone}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {contact.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                    <Tag size={10} />
                    {tag}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && !isAdding && (
        <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
          <Users size={48} className="mx-auto text-slate-300 dark:text-slate-700 mb-4" />
          <p className="text-slate-500 dark:text-slate-400">Nenhum contato encontrado.</p>
        </div>
      )}
    </div>
  );
}
