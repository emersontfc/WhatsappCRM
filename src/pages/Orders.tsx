import { useState, useEffect } from "react";
import { 
  ShoppingCart, 
  Package, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Plus, 
  Search, 
  Check, 
  X, 
  Eye, 
  RefreshCw, 
  FileText, 
  TrendingUp,
  Smartphone,
  ShieldCheck,
  Tag,
  ArrowRight
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { cn } from "../lib/utils";

interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  stock: number;
  type: string;
  digital_content?: string;
}

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
  currency: string;
  status: "created" | "awaiting_payment" | "verification_pending" | "paid" | "fulfilled" | "rejected" | "cancelled";
  payment_method: string;
  created_at: string;
  order_items: {
    id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
  }[];
}

interface Verification {
  id: string;
  order_id?: string;
  customer_phone: string;
  provider: string;
  transaction_reference: string;
  amount: number;
  sender_name?: string;
  sender_phone?: string;
  proof_type: string;
  proof_raw_text?: string;
  confidence_score: number;
  created_at: string;
  orders?: {
    order_number: string;
    total_amount: number;
    customer_name: string;
    customer_phone: string;
  };
}

interface TimelineEvent {
  id: string;
  step: string;
  description: string;
  created_at: string;
  orders?: {
    order_number: string;
    total_amount: number;
    customer_name: string;
  };
}

export default function Orders() {
  const [activeTab, setActiveTab] = useState<"orders" | "verifications" | "products" | "timeline">("orders");
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Product modal
  const [showProductModal, setShowProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: "",
    description: "",
    price: "",
    category: "Pacotes",
    stock: "999",
    type: "digital",
    digital_content: ""
  });
  const [savingProduct, setSavingProduct] = useState(false);

  // Timeline modal for specific order
  const [selectedOrderTimeline, setSelectedOrderTimeline] = useState<{ orderNumber: string; events: any[] } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [ordRes, prodRes, verRes, timeRes] = await Promise.all([
        apiFetch("/api/commerce/orders"),
        apiFetch("/api/commerce/products"),
        apiFetch("/api/commerce/verifications"),
        apiFetch("/api/commerce/operations-feed")
      ]);

      if (ordRes.success) setOrders(ordRes.data || []);
      if (prodRes.success) setProducts(prodRes.data || []);
      if (verRes.success) setVerifications(verRes.data || []);
      if (timeRes.success) setTimeline(timeRes.data || []);
    } catch (err: any) {
      console.error("Error loading commerce data:", err);
      toast.error(`Erro ao carregar dados: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateProduct = async () => {
    if (!newProduct.name || !newProduct.price) {
      toast.error("Nome e preço são obrigatórios.");
      return;
    }

    setSavingProduct(true);
    try {
      const res = await apiFetch("/api/commerce/products", {
        method: "POST",
        body: JSON.stringify(newProduct)
      });

      if (res.success) {
        toast.success("Produto cadastrado com sucesso!");
        setShowProductModal(false);
        setNewProduct({
          name: "",
          description: "",
          price: "",
          category: "Pacotes",
          stock: "999",
          type: "digital",
          digital_content: ""
        });
        fetchData();
      }
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar produto.");
    } finally {
      setSavingProduct(false);
    }
  };

  const handleApproveOrder = async (orderId: string) => {
    try {
      toast.info("Aprovando pedido e iniciando entrega digital...");
      const res = await apiFetch(`/api/commerce/orders/${orderId}/approve`, {
        method: "POST",
        body: JSON.stringify({ notes: "Validado pelo painel administrativo" })
      });

      if (res.success) {
        toast.success("Pedido aprovado! Produtos entregues via WhatsApp.");
        fetchData();
      }
    } catch (err: any) {
      toast.error(`Falha ao aprovar: ${err.message}`);
    }
  };

  const handleRejectOrder = async (orderId: string) => {
    const reason = window.prompt("Informe o motivo da rejeição (será enviado ao cliente):", "Comprovativo não identificado ou valor divergente");
    if (!reason) return;

    try {
      const res = await apiFetch(`/api/commerce/orders/${orderId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });

      if (res.success) {
        toast.info("Pedido rejeitado e cliente notificado.");
        fetchData();
      }
    } catch (err: any) {
      toast.error(`Erro ao rejeitar: ${err.message}`);
    }
  };

  const handleViewTimeline = async (order: Order) => {
    try {
      const res = await apiFetch(`/api/commerce/orders/${order.id}/timeline`);
      if (res.success) {
        setSelectedOrderTimeline({
          orderNumber: order.order_number,
          events: res.data || []
        });
      }
    } catch (err: any) {
      toast.error("Erro ao carregar histórico do pedido.");
    }
  };

  // KPI calculations
  const totalRevenue = orders
    .filter(o => o.status === "paid" || o.status === "fulfilled")
    .reduce((acc, curr) => acc + (Number(curr.total_amount) || 0), 0);
  const paidCount = orders.filter(o => o.status === "paid" || o.status === "fulfilled").length;
  const pendingCount = verifications.length;

  const filteredOrders = orders.filter(o => {
    const matchesSearch = 
      o.order_number.toLowerCase().includes(search.toLowerCase()) ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      o.customer_phone.includes(search);
    const matchesStatus = statusFilter === "all" || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "fulfilled":
        return <Badge variant="success" className="bg-emerald-50 text-emerald-700 border-emerald-200">Entregue</Badge>;
      case "paid":
        return <Badge variant="success" className="bg-blue-50 text-blue-700 border-blue-200">Pago</Badge>;
      case "verification_pending":
        return <Badge variant="warning" pulse className="bg-amber-50 text-amber-700 border-amber-200">Verificação Pendente</Badge>;
      case "awaiting_payment":
        return <Badge variant="warning" className="bg-slate-100 text-slate-700 border-slate-200">Aguardando Pagamento</Badge>;
      case "rejected":
        return <Badge variant="error" className="bg-red-50 text-red-700 border-red-200">Rejeitado</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <ShoppingCart className="text-emerald-600" size={32} />
            Vendas & Operações Comerciais
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Gestão de pedidos, catálogo de produtos, conferência de comprovativos e entrega automatizada.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-2">
            <RefreshCw size={16} className={cn(loading && "animate-spin")} /> Atualizar
          </Button>
          <Button onClick={() => setShowProductModal(true)} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Plus size={16} /> Novo Produto
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="border border-slate-100 shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Faturamento Aprovado</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{totalRevenue.toLocaleString("pt-MZ")} MT</h3>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp size={24} />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-100 shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Vendas Concluídas</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{paidCount} pedidos</h3>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <CheckCircle2 size={24} />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-100 shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Comprovativos Pendentes</p>
              <h3 className="text-2xl font-black text-amber-600 mt-1">{pendingCount} validações</h3>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock size={24} />
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-100 shadow-sm">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Itens no Catálogo</p>
              <h3 className="text-2xl font-black text-slate-900 mt-1">{products.length} ativos</h3>
            </div>
            <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Package size={24} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 gap-2">
        <button
          onClick={() => setActiveTab("orders")}
          className={cn(
            "pb-3 px-4 font-bold text-sm transition-all border-b-2 flex items-center gap-2",
            activeTab === "orders" ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <ShoppingCart size={16} /> Pedidos ({orders.length})
        </button>

        <button
          onClick={() => setActiveTab("verifications")}
          className={cn(
            "pb-3 px-4 font-bold text-sm transition-all border-b-2 flex items-center gap-2",
            activeTab === "verifications" ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <ShieldCheck size={16} /> Validações Pendentes
          {pendingCount > 0 && (
            <span className="h-5 w-5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">
              {pendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("products")}
          className={cn(
            "pb-3 px-4 font-bold text-sm transition-all border-b-2 flex items-center gap-2",
            activeTab === "products" ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Package size={16} /> Catálogo de Produtos ({products.length})
        </button>

        <button
          onClick={() => setActiveTab("timeline")}
          className={cn(
            "pb-3 px-4 font-bold text-sm transition-all border-b-2 flex items-center gap-2",
            activeTab === "timeline" ? "border-emerald-600 text-emerald-600" : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          <Clock size={16} /> Linha Temporal de Operações
        </button>
      </div>

      {/* Tab 1: Orders */}
      {activeTab === "orders" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar por pedido, nome ou telefone..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1">
              {["all", "awaiting_payment", "verification_pending", "paid", "fulfilled"].map(st => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all",
                    statusFilter === st ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {st === "all" ? "Todos" : 
                   st === "awaiting_payment" ? "Aguardando" :
                   st === "verification_pending" ? "Em Análise" :
                   st === "paid" ? "Pagos" : "Entregues"}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-400 text-[10px] font-bold uppercase tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="py-3 px-4">Pedido</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4">Itens</th>
                    <th className="py-3 px-4">Total</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400 font-medium">
                        Nenhum pedido encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map(order => (
                      <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-4 px-4 font-mono font-bold text-slate-900">{order.order_number}</td>
                        <td className="py-4 px-4">
                          <p className="font-bold text-slate-900">{order.customer_name || "Cliente"}</p>
                          <p className="text-xs text-slate-400 font-mono">+{order.customer_phone}</p>
                        </td>
                        <td className="py-4 px-4">
                          <div className="space-y-1">
                            {(order.order_items || []).map((item, idx) => (
                              <p key={idx} className="text-xs text-slate-600">
                                {item.quantity}x {item.product_name}
                              </p>
                            ))}
                          </div>
                        </td>
                        <td className="py-4 px-4 font-black text-slate-900">
                          {order.total_amount} {order.currency}
                        </td>
                        <td className="py-4 px-4">{getStatusBadge(order.status)}</td>
                        <td className="py-4 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewTimeline(order)}
                              title="Ver Linha Temporal da Operação"
                              className="text-slate-400 hover:text-slate-800"
                            >
                              <Eye size={16} />
                            </Button>

                            {order.status === "verification_pending" && (
                              <>
                                <Button
                                  size="sm"
                                  onClick={() => handleApproveOrder(order.id)}
                                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs px-2.5 h-8"
                                >
                                  <Check size={14} /> Aprovar
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleRejectOrder(order.id)}
                                  className="text-red-600 hover:bg-red-50 text-xs px-2.5 h-8"
                                >
                                  <X size={14} />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Verifications (Comprovativos) */}
      {activeTab === "verifications" && (
        <div className="space-y-4">
          {verifications.length === 0 ? (
            <Card className="border-dashed border-2 py-12 text-center text-slate-400">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
              <p className="font-bold text-slate-700 text-lg">Tudo em dia!</p>
              <p className="text-sm">Nenhum comprovativo pendente de conferência humana no momento.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {verifications.map(ver => (
                <Card key={ver.id} className="border border-amber-200 bg-amber-50/20 shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="warning" className="uppercase font-mono text-[10px]">
                        {ver.provider.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-slate-400 font-medium">
                        {new Date(ver.created_at).toLocaleTimeString("pt-MZ")}
                      </span>
                    </div>
                    <CardTitle className="text-lg font-black text-slate-900 mt-2">
                      Transação: {ver.transaction_reference}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      Cliente: +{ver.customer_phone} {ver.sender_name && `(${ver.sender_name})`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="bg-white p-3 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor do Comprovativo</p>
                      <p className="text-2xl font-black text-emerald-600">{ver.amount} MT</p>
                      {ver.orders && (
                        <p className="text-xs text-slate-500 mt-1">
                          Correspondente ao Pedido: <span className="font-bold text-slate-900">{ver.orders.order_number}</span> (Total: {ver.orders.total_amount} MT)
                        </p>
                      )}
                    </div>

                    {ver.proof_raw_text && (
                      <div className="bg-slate-900 text-emerald-400 p-3 rounded-xl font-mono text-xs leading-relaxed max-h-32 overflow-y-auto">
                        {ver.proof_raw_text}
                      </div>
                    )}

                    <div className="flex gap-3 pt-2">
                      {ver.order_id && (
                        <Button
                          onClick={() => handleApproveOrder(ver.order_id!)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-bold"
                        >
                          <Check size={18} /> Validar e Entregar
                        </Button>
                      )}
                      {ver.order_id && (
                        <Button
                          variant="outline"
                          onClick={() => handleRejectOrder(ver.order_id!)}
                          className="text-red-600 border-red-200 hover:bg-red-50"
                        >
                          Rejeitar
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Products Catalog */}
      {activeTab === "products" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {products.map(prod => (
              <Card key={prod.id} className="border border-slate-100 shadow-sm flex flex-col justify-between">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                      {prod.category || "Geral"}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      Estoque: {prod.stock}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg font-bold text-slate-900 mt-2">{prod.name}</CardTitle>
                  <CardDescription className="line-clamp-2">{prod.description || "Sem descrição."}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-baseline justify-between pt-2 border-t border-slate-50">
                    <span className="text-2xl font-black text-slate-900">{prod.price} {prod.currency || "MT"}</span>
                    <span className="text-xs text-emerald-600 font-bold uppercase">{prod.type}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Operations Feed */}
      {activeTab === "timeline" && (
        <Card className="border border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-black text-slate-900">Linha Temporal de Operações do Agente</CardTitle>
            <CardDescription>Eventos reais executados pelo agente autônomo e administradores em tempo real.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {timeline.map((event, idx) => (
                <div key={idx} className="relative">
                  <div className="absolute -left-6 top-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{event.step.toUpperCase()}</span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(event.created_at).toLocaleString("pt-MZ")}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mt-0.5">{event.description}</p>
                    {event.orders && (
                      <p className="text-xs font-mono text-emerald-600 mt-1">
                        Pedido: {event.orders.order_number} ({event.orders.total_amount} MT)
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Product Modal */}
      {showProductModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-2xl bg-white">
            <CardHeader>
              <CardTitle className="text-xl font-black text-slate-900">Novo Produto / Serviço</CardTitle>
              <CardDescription>Cadastre produtos para que o Agente de Vendas possa ofertar e entregar via WhatsApp.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700">Nome do Produto</label>
                <Input
                  placeholder="Ex: Pacote de Internet 5GB"
                  value={newProduct.name}
                  onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700">Preço (MT)</label>
                  <Input
                    type="number"
                    placeholder="Ex: 500"
                    value={newProduct.price}
                    onChange={e => setNewProduct({ ...newProduct, price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">Categoria</label>
                  <Input
                    placeholder="Ex: Pacotes, Cursos"
                    value={newProduct.category}
                    onChange={e => setNewProduct({ ...newProduct, category: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700">Descrição Comercial</label>
                <textarea
                  className="w-full p-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  rows={2}
                  placeholder="Descrição que a IA usará para apresentar o produto ao cliente..."
                  value={newProduct.description}
                  onChange={e => setNewProduct({ ...newProduct, description: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700">Conteúdo Digital / Instrução de Entrega</label>
                <textarea
                  className="w-full p-3 rounded-xl border border-slate-200 text-sm font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  rows={3}
                  placeholder="Link de download, código de licença ou instruções que o cliente receberá após aprovação do pagamento..."
                  value={newProduct.digital_content}
                  onChange={e => setNewProduct({ ...newProduct, digital_content: e.target.value })}
                />
              </div>
            </CardContent>
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <Button variant="ghost" onClick={() => setShowProductModal(false)}>
                Cancelar
              </Button>
              <Button onClick={handleCreateProduct} disabled={savingProduct} className="bg-emerald-600 hover:bg-emerald-700 font-bold">
                {savingProduct ? "Salvando..." : "Cadastrar Produto"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Order Specific Timeline Modal */}
      {selectedOrderTimeline && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg shadow-2xl bg-white max-h-[80vh] flex flex-col">
            <CardHeader className="border-b border-slate-100">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-black text-slate-900">
                  Histórico do Pedido {selectedOrderTimeline.orderNumber}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setSelectedOrderTimeline(null)}>
                  <X size={18} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-6 overflow-y-auto space-y-4">
              <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                {selectedOrderTimeline.events.map((ev, i) => (
                  <div key={i} className="relative">
                    <div className="absolute -left-6 top-1 h-4 w-4 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
                    <p className="text-xs font-bold text-slate-800">{ev.step.toUpperCase()}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{ev.description}</p>
                    <p className="text-[10px] text-slate-400 mt-1">{new Date(ev.created_at).toLocaleString("pt-MZ")}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

