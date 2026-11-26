import { useState, useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { ApiError, apiFetch } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { cn } from "../lib/utils";
import { isSellerMethod, sellerMethods, sellerReservationLabel, type OrderPayment, type RecipientEvidence } from "../../shared/seller";

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
  deliverable_name?: string;
}

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
  currency: string;
  status: "created" | "awaiting_payment" | "verification_pending" | "paid" | "fulfilled" | "rejected" | "cancelled" | "expired";
  reservation_expires_at?: string | null;
  lead_id?: string | null;
  payment_method: string;
  seller_payment?: OrderPayment | null;
  delivery_started_at?: string | null;
  delivery_error?: string | null;
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
  proof_media_url?: string;
  extracted_data?: { source?: string };
  currency?: string;
  confidence_score: number;
  created_at: string;
  recipientEvidence?: RecipientEvidence;
  orders?: {
    order_number: string;
    total_amount: number;
    currency?: string;
    customer_name: string;
    customer_phone: string;
    payment_method?: string;
    seller_payment?: OrderPayment | null;
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

const orderStatusFilters = [
  ["all", "Todos"], ["awaiting_payment", "Aguardam pagamento"], ["verification_pending", "Em revisão"],
  ["paid", "Pagos"], ["fulfilled", "Entregues"], ["expired", "Expirados"], ["cancelled", "Cancelados"]
] as const;

function safeProofUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || (url.protocol === "http:" && url.origin === window.location.origin) ? url.href : null;
  } catch {
    return null;
  }
}

async function saveGroupProof(id: string) {
  try {
    const { base64, name } = await apiFetch(`/api/commerce/verifications/${id}/attachment`);
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  } catch {
    toast.error("Não foi possível descarregar o comprovativo.");
  }
}

export default function Orders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const activeTab = tab === "verifications" || tab === "products" || tab === "timeline" ? tab : "orders";
  const setActiveTab = (next: string) => setSearchParams({ tab: next });
  const [approval, setApproval] = useState<{
    id: string; proofId: string; number: string; amount: number; currency: string;
    method?: string; destination?: OrderPayment | null;
  } | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const approvalDialog = useRef<HTMLDialogElement>(null);
  const [rejection, setRejection] = useState<{ id: string; proofId: string; mismatch: boolean } | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionError, setRejectionError] = useState("");
  const rejectionDialog = useRef<HTMLDialogElement>(null);
  const [deliveryReview, setDeliveryReview] = useState<Order | null>(null);
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const [deliveryReviewError, setDeliveryReviewError] = useState("");
  const deliveryDialog = useRef<HTMLDialogElement>(null);
  const [cancellation, setCancellation] = useState<Order | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancellationError, setCancellationError] = useState<{ message: string; blocked: boolean } | null>(null);
  const cancellationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (approval && approvalDialog.current && !approvalDialog.current.open) approvalDialog.current.showModal();
  }, [approval]);
  useEffect(() => {
    if (rejection && rejectionDialog.current && !rejectionDialog.current.open) rejectionDialog.current.showModal();
  }, [rejection]);
  useEffect(() => {
    if (deliveryReview && deliveryDialog.current && !deliveryDialog.current.open) deliveryDialog.current.showModal();
  }, [deliveryReview]);
  useEffect(() => {
    if (cancellation && cancellationDialog.current && !cancellationDialog.current.open) cancellationDialog.current.showModal();
  }, [cancellation]);

  const [proofsUnavailable, setProofsUnavailable] = useState(false);
  const [ordersUnavailable, setOrdersUnavailable] = useState(false);
  const latestDataRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const query = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "all";
  const [search, setSearch] = useState(query);
  const [statusFilter, setStatusFilter] = useState(status);
  useEffect(() => { setSearch(query); setStatusFilter(status); }, [query, status]);
  const pendingProofs = query ? verifications.filter((proof) => proof.orders?.order_number === query) : verifications;

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
    const request = ++latestDataRequest.current;
    setLoading(true);
    const [ordersResult, productsResult, proofsResult, timelineResult] = await Promise.allSettled([
      apiFetch("/api/commerce/orders"), apiFetch("/api/commerce/products"),
      apiFetch("/api/commerce/verifications"), apiFetch("/api/commerce/operations-feed")
    ]);
    if (request !== latestDataRequest.current) return;
    const ordersLoaded = ordersResult.status === "fulfilled" && ordersResult.value?.success === true;
    setOrdersUnavailable(!ordersLoaded);
    if (ordersLoaded) setOrders(ordersResult.value.data || []);
    if (productsResult.status === "fulfilled" && productsResult.value?.success) setProducts(productsResult.value.data || []);
    const proofsLoaded = proofsResult.status === "fulfilled" && proofsResult.value?.success;
    setProofsUnavailable(!proofsLoaded);
    if (proofsResult.status === "fulfilled" && proofsLoaded) setVerifications(proofsResult.value.data || []);
    if (timelineResult.status === "fulfilled" && timelineResult.value?.success) setTimeline(timelineResult.value.data || []);
    if ([ordersResult, productsResult, timelineResult].some((entry) => entry.status === "rejected")) {
      toast.error("Alguns dados comerciais estão indisponíveis.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const [productFile, setProductFile] = useState<File | null>(null);

  const attachProductFile = async (id: string, file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("O ficheiro excede 20 MiB.");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    try {
      await apiFetch(`/api/commerce/products/${id}/deliverable`, { method: "PUT", body });
      toast.success("Ficheiro privado guardado");
      void fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao guardar o ficheiro");
    }
  };

  const handleCreateProduct = async () => {
    if (!newProduct.name || !newProduct.price) {
      toast.error("Nome e preço são obrigatórios.");
      return;
    }

    if (productFile && productFile.size > 20 * 1024 * 1024) {
      toast.error("O ficheiro excede 20 MiB.");
      return;
    }
    setSavingProduct(true);
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(newProduct)) body.append(key, value);
      if (newProduct.type === "digital" && productFile) body.append("file", productFile);
      const res = await apiFetch("/api/commerce/products", {
        method: "POST",
        body: productFile && newProduct.type === "digital" ? body : JSON.stringify(newProduct)
      });

      if (res.success) {
        setProductFile(null);
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

  function reviewProof(proof: Verification) {
    const orderId = proof.order_id;
    const current = proof.orders ?? orders.find((item) => item.id === orderId);
    if (!orderId || !current) {
      toast.error("Não foi possível consultar o pedido. Atualiza a lista antes de aprovar.");
      return;
    }
    if (proof.recipientEvidence?.recipientMatch === "mismatch") {
      toast.error("O destinatário do comprovativo é diferente do destino do pedido.");
      return;
    }
    setApprovalError("");
    setApproval({ id: orderId, proofId: proof.id, number: current.order_number, amount: current.total_amount,
      currency: current.currency || "MT", method: current.payment_method, destination: current.seller_payment });
  }

  async function approveOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!approval || approving || values.get("verified") !== "on") return;
    setApproving(true);
    setApprovalError("");
    try {
      const res = await apiFetch(`/api/commerce/orders/${approval.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ settlementVerified: true, proofId: approval.proofId })
      });
      if (!res.success) throw new Error(res.error || "Não foi possível confirmar o pagamento.");
      if (res.fulfillment?.delivered) toast.success("Pagamento confirmado e envio aceite pelo WhatsApp.");
      else toast.info(res.fulfillment?.message || "Pagamento confirmado. Entrega pendente.");
      setApproval(null);
      void fetchData();
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "Não foi possível confirmar o pagamento.");
    } finally {
      setApproving(false);
    }
  }

  const retryDelivery = async (id: string) => {
    try {
      const result = await apiFetch(`/api/commerce/orders/${id}/delivery`, { method: "POST" });
      if (result.delivered) toast.success("Envio aceite pelo WhatsApp.");
      else toast.info(result.message || "Entrega pendente.");
      void fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao tentar a entrega");
    }
  };

  async function confirmDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deliveryReview || confirmingDelivery || new FormData(event.currentTarget).get("received") !== "on") return;
    setConfirmingDelivery(true);
    setDeliveryReviewError("");
    try {
      const result = await apiFetch(`/api/commerce/orders/${deliveryReview.id}/delivery/confirm`, {
        method: "POST", body: JSON.stringify({ deliveryVerified: true })
      });
      if (result.delivered !== true) throw new Error("A revisão da entrega ficou por confirmar.");
      setDeliveryReview(null);
      toast.success("Entrega confirmada e registada.");
      void fetchData();
    } catch (error) {
      setDeliveryReviewError(error instanceof Error ? error.message : "Não foi possível registar a revisão.");
    } finally {
      setConfirmingDelivery(false);
    }
  }

  async function rejectProof(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (!rejection || rejecting || reason.length < 3) return;
    setRejecting(true);
    setRejectionError("");
    try {
      const res = await apiFetch(`/api/commerce/orders/${rejection.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason, proofId: rejection.proofId })
      });
      if (!res.success) throw new Error("Não foi possível rejeitar o comprovativo.");
      toast.info(res.awaitingOtherProofs ? "Comprovativo rejeitado. Os restantes continuam em revisão."
        : res.notified ? "Comprovativo rejeitado e cliente notificado." : "Comprovativo rejeitado. O aviso ficou por confirmar.");
      setRejection(null);
      void fetchData();
    } catch (error) {
      setRejectionError(error instanceof Error ? error.message : "Não foi possível rejeitar o comprovativo.");
    } finally {
      setRejecting(false);
    }
  }

  async function cancelOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cancellation || cancelling || cancellationError?.blocked) return;
    setCancelling(true);
    setCancellationError(null);
    try {
      const result = await apiFetch(`/api/commerce/orders/${encodeURIComponent(cancellation.id)}/cancel`, { method: "POST" });
      const nextStatus = result?.data?.status;
      if (result?.success !== true || (nextStatus !== "cancelled" && nextStatus !== "expired")) {
        throw new Error("Não foi possível confirmar o cancelamento.");
      }
      setOrders((current) => current.map((order) => order.id === cancellation.id ? { ...order, status: nextStatus } : order));
      setCancellation(null);
      if (nextStatus === "expired") toast.info("O pedido expirou.");
      else toast.success("Pedido cancelado.");
      void fetchData();
    } catch (failure) {
      const blocked = failure instanceof ApiError && (failure.status === 409 || failure.status === 404);
      setCancellationError({ blocked, message: blocked
        ? "Este pedido já não pode ser cancelado. Fecha esta janela para conferir o estado atualizado."
        : failure instanceof Error ? failure.message : "Não foi possível confirmar o cancelamento." });
      if (blocked) void fetchData();
    } finally {
      setCancelling(false);
    }
  }

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
    const matchesStatus = statusFilter === "all" || o.status === statusFilter ||
      (statusFilter === "awaiting_payment" && o.status === "created");
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
      case "created":
        return <Badge variant="outline">Novo</Badge>;
      case "expired":
        return <Badge variant="outline">Expirado</Badge>;
      case "cancelled":
        return <Badge variant="outline">Cancelado</Badge>;
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
            Catálogo e pedidos
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Adiciona os produtos que o agente pode apresentar e acompanha as vendas até à entrega.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/seller" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50">
            Vendedor
          </Link>
          <Link to="/digital-orders" className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50">
            Entrega de ficheiros
          </Link>
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
              {orderStatusFilters.map(([st, label]) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  aria-pressed={statusFilter === st}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all",
                    statusFilter === st ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {label}
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
                        {loading ? <span role="status">A carregar pedidos…</span> : ordersUnavailable
                          ? <span role="alert">Não foi possível consultar os pedidos.</span>
                          : orders.length ? "Nenhum pedido com estes filtros." : "Ainda não há pedidos."}
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map(order => (
                      <tr key={order.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-4 px-4">
                          <span className="font-mono font-bold text-slate-900">{order.order_number}</span>
                          {order.lead_id && <Link to={`/leads?id=${order.lead_id}`} className="block text-xs font-medium text-emerald-700 underline">Ver lead</Link>}
                        </td>
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
                        <td className="py-4 px-4">
                          {getStatusBadge(order.status)}
                          <p className="mt-1 text-xs text-slate-600 empty:hidden">{sellerReservationLabel(order.status, order.reservation_expires_at)}</p>
                        </td>
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

                            {order.status === "paid" && (order.delivery_started_at
                              ? <Button size="sm" variant="outline" className="text-amber-800" onClick={() => {
                                setDeliveryReviewError("");
                                setDeliveryReview(order);
                              }}>Rever entrega</Button>
                              : <Button size="sm" variant="outline" onClick={() => retryDelivery(order.id)}>Tentar entrega</Button>)}

                            {order.status === "verification_pending" && <Link
                              to={`/orders?tab=verifications&q=${encodeURIComponent(order.order_number)}`}
                              className="whitespace-nowrap rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
                              Rever comprovativo
                            </Link>}
                            {(order.status === "created" || order.status === "awaiting_payment") && <Button
                              size="sm" variant="outline" className="whitespace-nowrap" aria-label={"Cancelar pedido " + order.order_number} onClick={() => {
                                setCancellationError(null);
                                setCancellation(order);
                              }}>Cancelar pedido</Button>}
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
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <h2 className="font-bold text-slate-900">Confirmar comprovativos de vendas</h2>
            <p className="mt-1 text-slate-700">Confere no prestador se o valor do pedido entrou na conta da loja.</p>
            {query && <Link to="/orders?tab=verifications" className="mt-2 mr-4 inline-block font-semibold text-emerald-800 underline">Ver todos os comprovativos</Link>}
            <Link to="/digital-orders?view=review" className="mt-2 inline-block font-semibold text-emerald-800 underline">
              Rever comprovativos na Entrega de ficheiros
            </Link>
          </div>
          {loading ? <p role="status">A carregar comprovativos…</p> : proofsUnavailable ? (
            <div role="status" className="rounded-xl border p-4">
              <p className="mb-2 text-sm">Não foi possível consultar os comprovativos.</p>
              <Button size="sm" onClick={fetchData}>Tentar novamente</Button>
            </div>
          ) : pendingProofs.length === 0 ? (
            <Card className="border-dashed border-2 py-12 text-center text-slate-400">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-500" />
              <p className="font-bold text-slate-700 text-lg">Tudo em dia!</p>
              <p className="text-sm">Nenhum comprovativo pendente de conferência humana no momento.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {pendingProofs.map(ver => (
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
                      {ver.transaction_reference ? `Transação: ${ver.transaction_reference}` : "Referência por conferir"}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">
                      Cliente: +{ver.customer_phone} {ver.sender_name && `(${ver.sender_name})`}
                    </CardDescription>
                    {ver.extracted_data?.source === "whatsapp_group" && <span className="text-xs text-slate-600">Grupo do WhatsApp</span>}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="bg-white p-3 rounded-xl border border-slate-100">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Valor do Comprovativo</p>
                      <p className="text-xl font-bold text-slate-900">
                        {Number(ver.amount) > 0 ? `${ver.amount} ${ver.currency || "MT"}` : "Valor por conferir"}
                      </p>
                      {ver.orders && (
                        <p className="text-xs text-slate-500 mt-1">
                          Correspondente ao Pedido: <span className="font-bold text-slate-900">{ver.orders.order_number}</span> (Total: {ver.orders.total_amount} {ver.orders.currency || "MT"})
                        </p>
                      )}
                    </div>

                    {ver.orders?.seller_payment && <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                      <p className="font-semibold">{ver.recipientEvidence?.recipientMatch === "mismatch"
                        ? "Destinatário divergente" : ver.recipientEvidence?.recipientMatch === "match"
                          ? "Dados de destino coincidem" : "Destinatário por conferir"}</p>
                      <p className="mt-1 text-slate-600">Titular da loja · {ver.orders.seller_payment.name}</p>
                      {ver.recipientEvidence?.recipientName &&
                        <p className="text-slate-600">Titular no comprovativo · {ver.recipientEvidence.recipientName}</p>}
                      {ver.recipientEvidence?.recipientAccount && <p className="text-slate-600">
                        Conta ou número indicado · {ver.recipientEvidence.recipientAccount}
                      </p>}
                    </div>}

                    {ver.proof_raw_text && (
                      <div className="bg-slate-900 text-emerald-400 p-3 rounded-xl font-mono text-xs leading-relaxed max-h-32 overflow-y-auto">
                        {ver.proof_raw_text}
                      </div>
                    )}

                    {ver.proof_media_url && safeProofUrl(ver.proof_media_url) && (
                      <a href={safeProofUrl(ver.proof_media_url)!} target="_blank" rel="noopener noreferrer"
                        className="inline-block text-sm font-semibold text-emerald-800 underline">
                        Abrir comprovativo anexado
                      </a>
                    )}
                    {ver.proof_media_url?.startsWith("agentx-group-proof:") && <Button variant="outline" size="sm" onClick={() => void saveGroupProof(ver.id)}>
                      <FileText size={16} className="mr-2" /> Descarregar comprovativo
                    </Button>}
                    {!ver.order_id && <p className="text-sm text-amber-800">Este comprovativo ainda não tem um pedido associado.</p>}
                    <div className="flex gap-3 pt-2">
                      {ver.order_id && ver.recipientEvidence?.recipientMatch !== "mismatch" && (
                        <Button
                          onClick={() => reviewProof(ver)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-bold"
                        >
                          <Check size={18} /> Rever e aprovar
                        </Button>
                      )}
                      {ver.order_id && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setRejectionError("");
                            setRejection({ id: ver.order_id!, proofId: ver.id, mismatch: ver.recipientEvidence?.recipientMatch === "mismatch" });
                          }}
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
          {!loading && products.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5">
            <h2 className="font-bold text-slate-900">Adiciona o primeiro produto</h2>
            <p className="my-2 text-sm text-slate-600">O agente consulta os produtos ativos deste catálogo para apresentar preços no WhatsApp.</p>
            <Button onClick={() => setShowProductModal(true)}>Adicionar produto</Button>
          </div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {products.map(prod => (
              <Card key={prod.id} className="border border-slate-100 shadow-sm flex flex-col justify-between">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                      {prod.category || "Geral"}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      Stock total: {prod.stock}
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
                  {prod.type === "digital" && (
                    <label className="block text-sm">
                      {prod.deliverable_name ? `Ficheiro atual: ${prod.deliverable_name}` : "Anexar ficheiro para entrega"}
                      <Input type="file" accept=".pdf,.epub,.jpg,.jpeg,.png,.webp" aria-label={`Ficheiro de ${prod.name}`}
                        onChange={(event) => {
                          const selected = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (selected) void attachProductFile(prod.id, selected);
                        }} />
                    </label>
                  )}
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

      {approval && (
        <dialog ref={approvalDialog} aria-labelledby="approval-title"
          onCancel={(event) => { event.preventDefault(); if (!approving) setApproval(null); }}
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/50">
          <form onSubmit={approveOrder} className="grid gap-4">
            <div>
              <h2 id="approval-title" className="text-lg font-bold">Confirmar pagamento</h2>
              <p className="mt-1 text-sm text-slate-600">Pedido {approval.number} · {approval.amount} {approval.currency}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
              {isSellerMethod(approval.method) && <p className="font-semibold">{sellerMethods[approval.method]}</p>}
              {approval.destination && <p>{approval.destination.name} · {approval.destination.recipient}</p>}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input className="mt-1" type="checkbox" name="verified" required disabled={approving} />
              Confirmei no prestador o recebimento deste valor na conta da loja.
            </label>
            {approvalError && <p role="alert" className="text-sm text-red-700">{approvalError}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" disabled={approving} onClick={() => setApproval(null)}>Cancelar</Button>
              <Button type="submit" disabled={approving}>{approving ? "A confirmar…" : "Confirmar pagamento"}</Button>
            </div>
          </form>
        </dialog>
      )}

      {rejection && <dialog ref={rejectionDialog} aria-labelledby="rejection-title"
        onCancel={(event) => { event.preventDefault(); if (!rejecting) setRejection(null); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/50">
        <form onSubmit={rejectProof} className="grid gap-4">
          <h2 id="rejection-title" className="text-lg font-bold">Rejeitar comprovativo</h2>
          <label className="grid gap-1 text-sm font-medium">Motivo a comunicar ao cliente
            <Input name="reason" required minLength={3} maxLength={250} disabled={rejecting}
              defaultValue={rejection.mismatch ? "O destinatário do comprovativo difere dos dados do pedido." : ""} />
          </label>
          {rejectionError && <p role="alert" className="text-sm text-red-700">{rejectionError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={rejecting} onClick={() => setRejection(null)}>Cancelar</Button>
            <Button type="submit" disabled={rejecting} className="bg-red-700 hover:bg-red-800">{rejecting ? "A rejeitar…" : "Rejeitar comprovativo"}</Button>
          </div>
        </form>
      </dialog>}

      {deliveryReview && <dialog ref={deliveryDialog} aria-labelledby="delivery-review-title"
        onCancel={(event) => { event.preventDefault(); if (!confirmingDelivery) setDeliveryReview(null); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/50">
        <form onSubmit={confirmDelivery} className="grid gap-4">
          <h2 id="delivery-review-title" className="text-lg font-bold">Rever entrega do pedido {deliveryReview.order_number}</h2>
          <p className="text-sm text-amber-800">{deliveryReview.delivery_error || "Envio por confirmar"}</p>
          <p className="text-sm text-slate-700">Confere a conversa do cliente e regista a entrega depois de confirmares a receção de todos os itens.</p>
          {deliveryReview.customer_phone && <Link to={`/messages?phone=${encodeURIComponent(deliveryReview.customer_phone)}`}
            target="_blank" rel="noopener noreferrer" className="text-sm text-emerald-800 underline">Abrir conversa</Link>}
          <label className="flex items-start gap-2 text-sm font-medium">
            <input className="mt-1" type="checkbox" name="received" required disabled={confirmingDelivery} />
            Confirmei que o cliente recebeu todos os ficheiros ou conteúdos do pedido.
          </label>
          {deliveryReviewError && <p role="alert" className="text-sm text-red-700">{deliveryReviewError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={confirmingDelivery} onClick={() => setDeliveryReview(null)}>Cancelar</Button>
            <Button type="submit" disabled={confirmingDelivery}>{confirmingDelivery ? "A registar…" : "Confirmar entrega"}</Button>
          </div>
        </form>
      </dialog>}

      {cancellation && <dialog ref={cancellationDialog} aria-labelledby="cancellation-title" aria-describedby="cancellation-description"
        onCancel={(event) => { event.preventDefault(); if (!cancelling) setCancellation(null); }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-900/50">
        <form onSubmit={cancelOrder} className="grid gap-4">
          <h2 id="cancellation-title" className="text-lg font-bold">Cancelar pedido {cancellation.order_number}?</h2>
          <p id="cancellation-description" className="text-sm text-slate-700">O pedido fica marcado como cancelado. Se tiver uma reserva de stock ativa, as unidades voltam ao stock disponível.</p>
          {cancellationError && <p role="alert" className="text-sm text-red-700">{cancellationError.message}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" autoFocus disabled={cancelling} onClick={() => setCancellation(null)}>
              {cancellationError?.blocked ? "Fechar" : "Manter pedido"}
            </Button>
            <Button type="submit" variant="danger" disabled={cancelling || cancellationError?.blocked}>
              {cancelling ? "A cancelar…" : "Confirmar cancelamento"}
            </Button>
          </div>
        </form>
      </dialog>}

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

              {newProduct.type === "digital" && (
                <label className="block text-sm font-medium">
                  Ficheiro de entrega privado (PDF, EPUB, JPEG, PNG ou WebP, até 20 MiB)
                  <Input type="file" accept=".pdf,.epub,.jpg,.jpeg,.png,.webp"
                    onChange={(event) => setProductFile(event.currentTarget.files?.[0] ?? null)} />
                </label>
              )}
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
              <Button variant="ghost" onClick={() => { setProductFile(null); setShowProductModal(false); }}>
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

