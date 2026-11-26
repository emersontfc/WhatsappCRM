import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";

type Origin = { created_at: string; agentx_catalog_campaigns: { id: string; product_name: string; group_name: string } };
type OriginOrder = { catalog_campaign_id: string; order_number: string };

export function LeadCampaignOrigin({ leadId }: { leadId: string }) {
  const [origins, setOrigins] = useState<Origin[]>([]);
  const [orders, setOrders] = useState<OriginOrder[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/catalog-campaigns/lead-origins/${encodeURIComponent(leadId)}`, {
      signal: controller.signal, timeout: 18_000
    }).then((response) => {
      if (!controller.signal.aborted && response?.success && Array.isArray(response.data)) {
        setOrigins(response.data);
        setOrders(Array.isArray(response.orders) ? response.orders : []);
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [leadId]);

  if (!origins.length) return null;
  return <section className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm" aria-label="Origem das campanhas">
    <h3 className="font-semibold text-emerald-900">Origem · Campanhas do catálogo</h3>
    <ul className="mt-1 space-y-1 text-emerald-900">
      {origins.map(({ created_at, agentx_catalog_campaigns: campaign }) => <li key={campaign.id}>
        <Link to="/seller#campanhas" className="font-medium underline">{campaign.product_name}</Link>
        <span> · {campaign.group_name} · {new Date(created_at).toLocaleDateString("pt-MZ")}</span>
        {orders.filter((order) => order.catalog_campaign_id === campaign.id).map((order) => <Link key={order.order_number}
          to={`/orders?q=${encodeURIComponent(order.order_number)}`} className="ml-2 inline-block underline">Pedido {order.order_number}</Link>)}
      </li>)}
    </ul>
  </section>;
}
