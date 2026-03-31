import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Key, Plus, Trash2, ShieldCheck, Zap } from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId, getUser } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { cn } from "../lib/utils";
import { apiFetch } from "../lib/api";

interface LicenseKey {
  id: string;
  code: string;
  duration_days: number;
  plan: string;
  is_used: boolean;
  used_by?: string;
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  plan: string;
  expires_at: string | null;
  created_at: string;
}

export default function Settings() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [keys, setKeys] = useState<LicenseKey[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeTab, setActiveTab] = useState<"profile" | "keys" | "users" | "plans" | "settings">("profile");
  const [newKey, setNewKey] = useState({ duration: "30", plan: "Premium" });
  const [plans, setPlans] = useState<any[]>([]);
  const [globalSettings, setGlobalSettings] = useState<any>({
    maintenance_mode: false,
    welcome_message: "",
    support_contact: ""
  });

  const fetchPlans = async () => {
    try {
      const response = await apiFetch("/api/admin/plans");
      if (response.success) {
        setPlans(response.data);
      }
    } catch (err) {
      console.error("Error fetching plans:", err);
    }
  };

  const updatePlan = async (id: string, updates: any) => {
    try {
      const response = await apiFetch(`/api/admin/plans/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      if (response.success) {
        toast.success("Plano atualizado com sucesso!");
        fetchPlans();
      } else {
        toast.error(response.error || "Erro ao atualizar plano");
      }
    } catch (err) {
      toast.error("Erro ao atualizar plano");
    }
  };
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const fetchKeys = async () => {
    try {
      const response = await apiFetch("/api/admin/keys");
      if (response.success) {
        setKeys(response.data);
      }
    } catch (err) {
      console.error("Error fetching keys:", err);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await apiFetch("/api/admin/users");
      if (response.success) {
        setUsers(response.data);
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    }
  };

  const fetchGlobalSettings = async () => {
    try {
      const response = await apiFetch("/api/admin/settings");
      if (response.success && response.data) {
        setGlobalSettings(response.data);
      }
    } catch (err) {
      console.error("Error fetching global settings:", err);
    }
  };

  const updateGlobalSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await apiFetch("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify(globalSettings),
      });
      if (response.success) {
        toast.success("Configurações globais atualizadas!");
      } else {
        toast.error(response.error || "Erro ao atualizar configurações");
      }
    } catch (err) {
      toast.error("Erro ao atualizar configurações");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      setPageLoading(true);
      // Check if user is admin via backend
      const checkAdmin = async () => {
        try {
          const response = await apiFetch("/api/ai/subscription");
          if (response.success && response.data) {
            setProfile(response.data);
            if (response.data.role === "admin") {
              setIsAdmin(true);
              await Promise.all([
                fetchKeys(),
                fetchUsers(),
                fetchPlans(),
                fetchGlobalSettings()
              ]);
            } else {
              setIsAdmin(false);
            }
          }
        } catch (err) {
          console.error("Error checking admin status:", err);
          setIsAdmin(false);
        } finally {
          setPageLoading(false);
        }
      };
      await checkAdmin();
    };

    init();
  }, []);

  useEffect(() => {
    // Real-time subscription for keys (only if admin)
    let keysSubscription: any;
    let usersSubscription: any;

    if (isAdmin) {
      keysSubscription = supabase
        .channel('public:license_keys')
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'license_keys'
        }, async () => {
          await fetchKeys();
        })
        .subscribe();

      usersSubscription = supabase
        .channel('public:users')
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'users'
        }, async () => {
          await fetchUsers();
        })
        .subscribe();
    }

    return () => {
      if (keysSubscription) supabase.removeChannel(keysSubscription);
      if (usersSubscription) supabase.removeChannel(usersSubscription);
    };
  }, [isAdmin]);

  const generateKey = async () => {
    setLoading(true);
    try {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase() + "-" + 
                   Math.random().toString(36).substring(2, 10).toUpperCase();
      
      const response = await apiFetch("/api/admin/keys", {
        method: "POST",
        body: JSON.stringify({
          code,
          duration_days: parseInt(newKey.duration),
          plan: newKey.plan
        }),
      });

      // apiFetch already throws on !response.ok, but we check success just in case
      if (!response.success) {
        throw new Error(response.error || "Erro desconhecido ao gerar senha.");
      }
      
      await fetchKeys();
      toast.success("Senha gerada com sucesso!");
    } catch (err: any) {
      console.error("Error generating key:", err);
      toast.error(err.message || "Erro ao gerar senha.");
    } finally {
      setLoading(false);
    }
  };

  const deleteKey = async (id: string) => {
    try {
      const response = await apiFetch(`/api/admin/keys/${id}`, {
        method: "DELETE"
      });
      
      if (!response.success) {
        throw new Error(response.error || "Erro ao apagar senha.");
      }
      
      setKeys(prev => prev.filter(k => k.id !== id));
      toast.success("Senha apagada com sucesso!");
    } catch (err: any) {
      console.error("Error deleting key:", err);
      toast.error(err.message || "Erro ao apagar senha.");
    }
  };

  const deleteUser = async (id: string) => {
    try {
      const response = await apiFetch(`/api/admin/users/${id}`, {
        method: "DELETE"
      });
      
      if (!response.success) {
        throw new Error(response.error || "Erro ao apagar usuário.");
      }
      
      setUsers(prev => prev.filter(u => u.id !== id));
      toast.success("Usuário apagado com sucesso!");
    } catch (err: any) {
      console.error("Error deleting user:", err);
      toast.error(err.message || "Erro ao apagar usuário.");
    }
  };

  const updateUserRole = async (id: string, role: string) => {
    try {
      const response = await apiFetch(`/api/admin/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      
      if (!response.success) {
        throw new Error(response.error || "Erro ao atualizar cargo.");
      }
      
      setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u));
      toast.success("Cargo atualizado com sucesso!");
    } catch (err: any) {
      console.error("Error updating user role:", err);
      toast.error(err.message || "Erro ao atualizar cargo.");
    }
  };

  const updateUserSubscription = async (id: string, plan: string, expires_at: string | null) => {
    try {
      const response = await apiFetch(`/api/admin/users/${id}/subscription`, {
        method: "PATCH",
        body: JSON.stringify({ plan, expires_at }),
      });
      
      if (!response.success) {
        throw new Error(response.error || "Erro ao atualizar subscrição.");
      }
      
      setUsers(prev => prev.map(u => u.id === id ? { ...u, plan, expires_at } : u));
      toast.success("Subscrição atualizada com sucesso!");
    } catch (err: any) {
      console.error("Error updating user subscription:", err);
      toast.error(err.message || "Erro ao atualizar subscrição.");
    }
  };

  const updateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setLoading(true);
    try {
      // Update via backend to avoid RLS issues
      const response = await apiFetch("/api/ai/profile", {
        method: "POST",
        body: JSON.stringify({ name: profile.name })
      });
      
      if (!response.success) throw new Error(response.error || "Erro ao atualizar perfil.");
      
      // Also update auth metadata for consistency
      await supabase.auth.updateUser({
        data: { full_name: profile.name }
      });
      
      toast.success("Perfil atualizado com sucesso!");
    } catch (err: any) {
      console.error("Error updating profile:", err);
      toast.error(err.message || "Erro ao atualizar perfil.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {pageLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 p-1 bg-slate-100 rounded-lg w-full md:w-fit">
            <Button 
              variant={activeTab === "profile" ? "primary" : "ghost"} 
              onClick={() => setActiveTab("profile")}
              className="h-8 text-xs flex-1 md:flex-none"
            >
              Meu Perfil
            </Button>
            {isAdmin && (
              <>
                <Button 
                  variant={activeTab === "keys" ? "primary" : "ghost"} 
                  onClick={() => setActiveTab("keys")}
                  className="h-8 text-xs flex-1 md:flex-none"
                >
                  Senhas
                </Button>
                <Button 
                  variant={activeTab === "users" ? "primary" : "ghost"} 
                  onClick={() => setActiveTab("users")}
                  className="h-8 text-xs flex-1 md:flex-none"
                >
                  Usuários
                </Button>
                <Button 
                  variant={activeTab === "plans" ? "primary" : "ghost"} 
                  onClick={() => setActiveTab("plans")}
                  className="h-8 text-xs flex-1 md:flex-none"
                >
                  Planos
                </Button>
                <Button 
                  variant={activeTab === "settings" ? "primary" : "ghost"} 
                  onClick={() => setActiveTab("settings")}
                  className="h-8 text-xs flex-1 md:flex-none"
                >
                  Config. Globais
                </Button>
              </>
            )}
          </div>

          {activeTab === "profile" ? (
            profile ? (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>Configurações de Perfil</CardTitle>
                    <CardDescription>Gerencie suas informações pessoais.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={updateProfile} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Nome Completo</label>
                        <Input 
                          value={profile.name || ""}
                          onChange={e => setProfile({...profile, name: e.target.value})}
                          placeholder="Seu Nome"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">E-mail</label>
                        <Input 
                          value={profile.email || ""}
                          disabled
                          className="bg-slate-50"
                        />
                        <p className="text-[10px] text-slate-500">O e-mail não pode ser alterado.</p>
                      </div>
                      <Button type="submit" disabled={loading}>
                        {loading ? "Salvando..." : "Salvar Alterações"}
                      </Button>
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Zap className="text-amber-500" />
                      Minha Subscrição
                    </CardTitle>
                    <CardDescription>Detalhes do seu plano atual.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-1">
                      <p className="text-xs font-bold uppercase text-slate-500">Plano Atual</p>
                      <div className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase",
                        profile.plan === "Premium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
                      )}>
                        {profile.plan || "Gratuito"}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-bold uppercase text-slate-500">Status</p>
                      <p className="text-sm font-medium">
                        {profile.plan === "Free" ? (
                          <span className="text-slate-600">Ativo (Plano Gratuito)</span>
                        ) : (
                          <span className="text-emerald-600">Ativo</span>
                        )}
                      </p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-bold uppercase text-slate-500">Data de Expiração</p>
                      <p className="text-sm font-medium text-slate-900">
                        {profile.plan === "Free" ? "Perpétuo" : (profile.expires_at ? new Date(profile.expires_at).toLocaleDateString() : "N/A")}
                      </p>
                      {profile.plan !== "Free" && profile.expires_at && (
                        <p className="text-[10px] text-slate-500">
                          {Math.max(0, Math.ceil((new Date(profile.expires_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))} dias restantes
                        </p>
                      )}
                    </div>

                    {profile.plan !== "Premium" && profile.role !== "admin" && (
                      <Button 
                        variant="outline" 
                        className="w-full border-amber-200 text-amber-700 hover:bg-amber-50"
                        onClick={() => navigate("/activate")}
                      >
                        Fazer Upgrade de Plano
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-slate-500">Não foi possível carregar o perfil. Tente recarregar a página.</p>
                <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
                  Recarregar
                </Button>
              </div>
            )
          ) : activeTab === "keys" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="text-emerald-600" />
                Gerador de Senhas de Acesso
              </CardTitle>
              <CardDescription>
                Crie novas senhas de ativação para vender aos usuários.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 items-end">
                <div className="space-y-2 flex-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Duração da Subscrição (Dias)</label>
                  <Input 
                    type="number" 
                    value={newKey.duration}
                    onChange={e => setNewKey({...newKey, duration: e.target.value})}
                  />
                </div>
                <div className="space-y-2 flex-1">
                  <label className="text-xs font-bold uppercase text-slate-500">Plano</label>
                  <select 
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    value={newKey.plan}
                    onChange={e => setNewKey({...newKey, plan: e.target.value})}
                  >
                    <option>Starter</option>
                    <option>Pro</option>
                    <option>Premium</option>
                  </select>
                </div>
                <Button onClick={generateKey} disabled={loading} className="gap-2">
                  <Plus size={18} />
                  Gerar Senha
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Senhas Geradas</CardTitle>
              <CardDescription>Lista de todas as senhas no sistema.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                    <tr>
                      <th className="px-6 py-3">Senha</th>
                      <th className="px-6 py-3">Plano</th>
                      <th className="px-6 py-3">Duração</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {keys.map((key) => (
                      <tr key={key.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4 font-mono font-bold text-emerald-600">{key.code}</td>
                        <td className="px-6 py-4">{key.plan}</td>
                        <td className="px-6 py-4">{key.duration_days} dias</td>
                        <td className="px-6 py-4">
                          {key.is_used ? (
                            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold uppercase">Usado</span>
                          ) : (
                            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-bold uppercase">Disponível</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <button 
                            className="text-red-500 hover:text-red-600 hover:bg-red-50 p-2 rounded-md"
                            onClick={(e) => { e.stopPropagation(); deleteKey(key.id); }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Usuários Cadastrados</CardTitle>
            <CardDescription>Gerencie os usuários do sistema e seus planos.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                  <tr>
                    <th className="px-6 py-3">Nome / Email</th>
                    <th className="px-6 py-3">Plano</th>
                    <th className="px-6 py-3">Expira em</th>
                    <th className="px-6 py-3">Cargo</th>
                    <th className="px-6 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => {
                    const daysLeft = user.expires_at 
                      ? Math.max(0, Math.ceil((new Date(user.expires_at).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
                      : 0;
                    
                    return (
                      <tr key={user.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900">{user.name}</span>
                            <span className="text-xs text-slate-500">{user.email}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <select 
                            className="bg-transparent border-none text-xs font-bold uppercase focus:ring-0 cursor-pointer text-slate-700"
                            value={user.plan || "Free"}
                            onChange={(e) => updateUserSubscription(user.id, e.target.value, user.expires_at)}
                          >
                            {plans.map(plan => (
                              <option key={plan.id} value={plan.name}>{plan.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            {user.plan === "Free" ? (
                              <span className="text-xs font-bold text-slate-500">Perpétuo</span>
                            ) : (
                              <>
                                <Input 
                                  type="date"
                                  className="h-7 text-[10px] w-32 p-1"
                                  value={user.expires_at ? new Date(user.expires_at).toISOString().split('T')[0] : ""}
                                  onChange={(e) => {
                                    const date = e.target.value ? new Date(e.target.value).toISOString() : null;
                                    updateUserSubscription(user.id, user.plan, date);
                                  }}
                                />
                                {user.expires_at && (
                                  <span className={cn(
                                    "text-[10px] font-bold",
                                    daysLeft > 0 ? "text-emerald-600" : "text-red-600"
                                  )}>
                                    {daysLeft > 0 ? `${daysLeft} dias restantes` : "Expirado"}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <select 
                            className="bg-transparent border-none text-xs font-bold uppercase focus:ring-0 cursor-pointer"
                            value={user.role}
                            onChange={(e) => updateUserRole(user.id, e.target.value)}
                          >
                            <option value="user">Usuário</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-6 py-4">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => deleteUser(user.id)}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "plans" && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Gerenciar Planos</CardTitle>
            <CardDescription>Configure os limites e preços dos planos disponíveis.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((plan) => (
                <Card key={plan.id} className="border-slate-200">
                  <CardHeader className="bg-slate-50 pb-4">
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Preço (MZN)</label>
                      <Input 
                        type="number" 
                        value={plan.price} 
                        onChange={(e) => {
                          const newPlans = [...plans];
                          const index = newPlans.findIndex(p => p.id === plan.id);
                          newPlans[index].price = Number(e.target.value);
                          setPlans(newPlans);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Conexões WhatsApp</label>
                      <Input 
                        type="number" 
                        value={plan.max_connections} 
                        onChange={(e) => {
                          const newPlans = [...plans];
                          const index = newPlans.findIndex(p => p.id === plan.id);
                          newPlans[index].max_connections = Number(e.target.value);
                          setPlans(newPlans);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Contatos Máximos</label>
                      <Input 
                        type="number" 
                        value={plan.max_contacts} 
                        onChange={(e) => {
                          const newPlans = [...plans];
                          const index = newPlans.findIndex(p => p.id === plan.id);
                          newPlans[index].max_contacts = Number(e.target.value);
                          setPlans(newPlans);
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">Mensagens / Dia</label>
                      <Input 
                        type="number" 
                        value={plan.max_messages_per_day} 
                        onChange={(e) => {
                          const newPlans = [...plans];
                          const index = newPlans.findIndex(p => p.id === plan.id);
                          newPlans[index].max_messages_per_day = Number(e.target.value);
                          setPlans(newPlans);
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <label className="text-xs font-semibold text-slate-500 uppercase">IA Ativada</label>
                      <input 
                        type="checkbox" 
                        checked={plan.ai_enabled}
                        onChange={(e) => {
                          const newPlans = [...plans];
                          const index = newPlans.findIndex(p => p.id === plan.id);
                          newPlans[index].ai_enabled = e.target.checked;
                          setPlans(newPlans);
                        }}
                        className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                      />
                    </div>
                    <Button 
                      className="w-full mt-4" 
                      onClick={() => updatePlan(plan.id, plan)}
                    >
                      Salvar Alterações
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === "settings" && isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Configurações Globais do Sistema</CardTitle>
            <CardDescription>Gerencie as configurações gerais da plataforma.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={updateGlobalSettings} className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                <div className="space-y-0.5">
                  <label className="text-sm font-bold text-slate-900">Modo de Manutenção</label>
                  <p className="text-xs text-slate-500">Impede que usuários não-admin acessem o sistema.</p>
                </div>
                <input 
                  type="checkbox" 
                  checked={globalSettings.maintenance_mode}
                  onChange={(e) => setGlobalSettings({...globalSettings, maintenance_mode: e.target.checked})}
                  className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-900">Mensagem de Boas-vindas</label>
                <textarea 
                  className="flex min-h-[100px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  placeholder="Mensagem exibida no dashboard para novos usuários..."
                  value={globalSettings.welcome_message || ""}
                  onChange={(e) => setGlobalSettings({...globalSettings, welcome_message: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-900">Contato de Suporte (WhatsApp)</label>
                <Input 
                  placeholder="Ex: 258840000000"
                  value={globalSettings.support_contact || ""}
                  onChange={(e) => setGlobalSettings({...globalSettings, support_contact: e.target.value})}
                />
              </div>

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Salvando..." : "Salvar Configurações"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      </>
      )}
    </div>
  );
}
