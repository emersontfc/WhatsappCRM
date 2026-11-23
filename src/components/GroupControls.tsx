import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Link2, Lock, LockOpen, Send, Settings, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { GroupProofSettings } from "./GroupProofSettings";

export interface EditableGroup {
  id: string;
  subject: string;
  desc?: string;
  announce?: boolean;
  restrict?: boolean;
  joinApprovalMode?: boolean;
}

export interface GroupPermissions { manage: boolean; post: boolean; selfId: string }
type PromotionProduct = { id: string; name: string; price: number; currency?: string };

const options = [
  ["restrict", "Só administradores podem editar o grupo"],
  ["joinApprovalMode", "Exigir aprovação para novos membros"]
] as const;
const panelClass = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-5";
const summaryClass = "flex cursor-pointer items-center gap-2 font-semibold text-slate-900";
const textareaClass = "min-h-20 w-full rounded-xl border border-slate-200 p-3 text-sm focus-visible:outline-emerald-500";

export function GroupControls({ group, permissions, refresh, onPostingModeChange }: {
  group: EditableGroup;
  permissions: GroupPermissions;
  refresh: () => Promise<void>;
  onPostingModeChange?: (announce: boolean) => void;
}) {
  const root = `/api/whatsapp/groups/${encodeURIComponent(group.id)}`;
  const [pending, setPending] = useState(false);
  const [name, setName] = useState(group.subject);
  const [description, setDescription] = useState(group.desc ?? "");
  const [announcement, setAnnouncement] = useState("");
  const [publicationKind, setPublicationKind] = useState<"announcement" | "promotion">("announcement");
  const [productId, setProductId] = useState("");
  const [products, setProducts] = useState<PromotionProduct[]>([]);
  const [productState, setProductState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [inviteUrl, setInviteUrl] = useState("");
  const [resetting, setResetting] = useState(false);
  const [requests, setRequests] = useState<string[] | null>(null);

  useEffect(() => {
    if (publicationKind !== "promotion" || !permissions.post) return;
    const controller = new AbortController();
    setProductState("loading");
    void apiFetch(root + "/promotion-products", { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      if (!data?.success || !Array.isArray(data.products)) throw new Error("Catálogo indisponível.");
      setProducts(data.products);
      setProductId((selected) => data.products.some((product: PromotionProduct) => product.id === selected) ? selected : "");
      setProductState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) {
        setProducts([]);
        setProductId("");
        setProductState("unavailable");
      }
    });
    return () => controller.abort();
  }, [permissions.post, publicationKind, root]);

  async function request(path: string, method = "GET", body?: unknown) {
    const data = await apiFetch(root + path, { method, body: JSON.stringify(body) });
    if (data?.success !== true) throw new Error(data?.error || "Não foi possível concluir a operação.");
    return data;
  }

  async function run(operation: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    try {
      await operation();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível concluir a operação.");
    } finally {
      setPending(false);
    }
  }

  async function showInvite(reset: boolean) {
    if (reset) setInviteUrl("");
    const { url } = await request(reset ? "/invite/reset" : "/invite", reset ? "POST" : "GET");
    if (typeof url !== "string" || !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/.test(url)) {
      throw new Error("Link de convite indisponível.");
    }
    setInviteUrl(url);
    setResetting(false);
    if (reset) toast.success("Novo link criado. O convite anterior foi revogado.");
  }

  const isPromotion = publicationKind === "promotion";
  const selectedProduct = products.find((product) => product.id === productId);
  const postingLabel = group.announce ? "Só administradores podem escrever" : "Todos os membros podem escrever";
  const PostingIcon = group.announce ? Lock : LockOpen;
  return <div className="space-y-3">
    <section className={`${panelClass} flex flex-wrap items-center justify-between gap-3`} aria-label="Escrita no grupo">
      <div>
        <h3 className="flex items-center gap-2 font-semibold"><PostingIcon size={16} className="text-emerald-600" /> {group.announce ? "Grupo fechado" : "Grupo aberto"}</h3>
        <p className="mt-1 text-sm text-slate-600">{postingLabel}.</p>
      </div>
      {permissions.manage && <Button variant="outline" disabled={pending} onClick={() => void run(async () => {
        const value = !group.announce;
        try {
          const data = await request("/settings", "PATCH", { field: "announce", value });
          if (data.announce !== value) throw new Error("O WhatsApp ainda não confirmou quem pode escrever.");
          onPostingModeChange?.(data.announce);
          toast.success(value ? "Grupo fechado. Só administradores podem escrever." : "Grupo aberto. Todos os membros podem escrever.");
        } finally {
          await refresh();
        }
      })}>{group.announce ? "Abrir grupo" : "Fechar grupo"}</Button>}
    </section>

    <section className={panelClass} aria-label="Publicar no grupo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold"><Send size={16} className="text-emerald-600" /> Publicar no grupo</h3>
        {permissions.post && <Link className="flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:underline"
          to={`/schedule?new=group&group=${encodeURIComponent(group.id)}`}><CalendarClock size={16} /> Agendar anúncio</Link>}
      </div>
      {permissions.post ? <form className="mt-3 space-y-2" onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const result = await request(isPromotion ? "/promotions" : "/announce", "POST", {
            text: announcement, ...(isPromotion ? { productId: selectedProduct?.id } : {})
          });
          if (result.status !== "sent") throw new Error("Envio por confirmar. Consulta o grupo antes de repetir.");
          setAnnouncement("");
          setProductId("");
          toast.success(`${isPromotion ? "Promoção aceite" : "Anúncio aceite"} pelo WhatsApp em ${group.subject}.`);
        });
      }}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de publicação">
          <Button size="sm" variant={isPromotion ? "outline" : "primary"} aria-pressed={!isPromotion} disabled={pending}
            onClick={() => setPublicationKind("announcement")}>Anúncio</Button>
          <Button size="sm" variant={isPromotion ? "primary" : "outline"} aria-pressed={isPromotion} disabled={pending}
            onClick={() => setPublicationKind("promotion")}>Promoção</Button>
        </div>
        {isPromotion && <div className="space-y-2">
          <label className="block text-sm">Produto do catálogo (opcional)
            <select className="mt-1 block min-h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
              value={productId} disabled={pending || productState !== "ready"}
              onChange={(event) => setProductId(event.target.value)}>
              <option value="">Só texto</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.price} {product.currency || "MT"}</option>)}
            </select>
          </label>
          {productState === "loading" && <p role="status" className="text-sm text-slate-600">A carregar o catálogo…</p>}
          {productState === "unavailable" && <p className="text-sm text-slate-600">Catálogo indisponível. Podes publicar uma promoção em texto.</p>}
        </div>}
        <label className="block text-sm">{isPromotion ? "Texto da promoção" : "Texto do anúncio"}
          <textarea className={textareaClass} maxLength={isPromotion ? 3800 : 4096} value={announcement} disabled={pending}
            onChange={(event) => setAnnouncement(event.target.value)} />
        </label>
        <Button type="submit" disabled={pending || (!announcement.trim() && !(isPromotion && selectedProduct))}>
          {isPromotion ? "Publicar promoção" : "Publicar agora"}
        </Button>
      </form> : <p className="mt-2 text-sm text-slate-600">A conta ligada não pode publicar neste grupo.</p>}
    </section>

    {permissions.manage && <GroupProofSettings key={group.id} jid={group.id} />}
    {permissions.manage && <div className="grid items-start gap-3 xl:grid-cols-2">
      <details className={panelClass}>
        <summary className={summaryClass}><Settings size={16} className="text-emerald-600" /> Definições do grupo</summary>
        <div className="mt-4 space-y-4">
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await request("/subject", "POST", { subject: name });
              toast.success("Nome atualizado no WhatsApp.");
              await refresh();
            });
          }}>
            <label className="block text-sm">Nome do grupo
              <Input className="mt-1" value={name} maxLength={100} disabled={pending} onChange={(event) => setName(event.target.value)} />
            </label>
            <Button size="sm" type="submit" disabled={pending || !name.trim() || name.trim() === group.subject}>Guardar nome</Button>
          </form>
          <form className="space-y-2" onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await request("/settings", "PATCH", { field: "description", value: description });
              toast.success("Descrição atualizada no WhatsApp.");
              await refresh();
            });
          }}>
            <label className="block text-sm">Descrição do grupo
              <textarea className={`${textareaClass} mt-1`} value={description} maxLength={2048} disabled={pending}
                onChange={(event) => setDescription(event.target.value)} />
            </label>
            <Button size="sm" type="submit" disabled={pending || description.trim() === (group.desc ?? "")}>Guardar descrição</Button>
          </form>
          <fieldset className="grid gap-3 border-t border-slate-100 pt-3" disabled={pending}>
            {options.map(([field, label]) => <label key={field} className="flex items-start gap-2 text-sm">
              <input className="mt-1 accent-emerald-600" type="checkbox" checked={Boolean(group[field])}
                onChange={(event) => {
                  const value = event.target.checked;
                  void run(async () => {
                    await request("/settings", "PATCH", { field, value });
                    toast.success("Permissão atualizada no WhatsApp.");
                    await refresh();
                  });
                }} />{label}
            </label>)}
          </fieldset>
        </div>
      </details>

      <details className={panelClass}>
        <summary className={summaryClass}><Link2 size={16} className="text-emerald-600" /> Convites e pedidos de entrada</summary>
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => void run(() => showInvite(false))}>Mostrar link</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setResetting(true)}>Gerar novo link</Button>
          </div>
          {inviteUrl && <div className="flex flex-col gap-2 sm:flex-row">
            <Input aria-label="Link de convite" readOnly value={inviteUrl} onFocus={(event) => event.target.select()} />
            <Button variant="outline" onClick={() => void run(async () => {
              await navigator.clipboard.writeText(inviteUrl);
              toast.success("Link copiado.");
            })}>Copiar</Button>
          </div>}
          {resetting && <div role="group" aria-label="Confirmar revogação do convite" className="rounded-xl bg-amber-50 p-3 text-sm">
            <p>O link anterior deixa de funcionar.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setResetting(false)}>Cancelar</Button>
              <Button size="sm" variant="danger" disabled={pending} onClick={() => void run(() => showInvite(true))}>Revogar e gerar link</Button>
            </div>
          </div>}
          <div className="border-t border-slate-100 pt-3">
            <Button size="sm" variant="outline" className="gap-2" disabled={pending} onClick={() => void run(async () => {
              const data = await request("/requests");
              if (!Array.isArray(data.participants)) throw new Error("Pedidos indisponíveis.");
              setRequests(data.participants);
            })}><UserCheck size={14} /> {requests === null ? "Consultar pedidos" : "Atualizar pedidos"}</Button>
            {requests?.length === 0 && <p className="mt-2 text-sm text-slate-600">Sem pedidos pendentes.</p>}
            {requests && requests.length > 0 && <ul className="mt-2 space-y-2" aria-label="Pedidos pendentes">
              {requests.map((participant) => <li key={participant} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2 text-sm">
                <span className="mr-auto">{participant.endsWith("@lid") ? `ID ${participant.split("@")[0]}` : `+${participant.split("@")[0]}`}</span>
                {(["approve", "reject"] as const).map((action) => <Button key={action} size="sm" variant={action === "approve" ? "primary" : "outline"}
                  disabled={pending} onClick={() => void run(async () => {
                    await request("/requests", "POST", { participant, action });
                    setRequests((items) => items?.filter((item) => item !== participant) ?? null);
                    toast.success(action === "approve" ? "Entrada aprovada." : "Pedido recusado.");
                    if (action === "approve") await refresh();
                  })}>{action === "approve" ? "Aprovar" : "Recusar"}</Button>)}
              </li>)}
            </ul>}
          </div>
        </div>
      </details>
    </div>}
  </div>;
}
