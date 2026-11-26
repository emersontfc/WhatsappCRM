import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

type Product = { id: string; name: string; price: number | string; currency?: string; stock: number; hasCover: boolean };
type Destination = { id: string; name: string };
type Campaign = { id: string; product_name: string; group_name: string; status: string; scheduled_at: string; published_at?: string; error?: string };
type CampaignsData = { products: Product[]; groups: Destination[]; campaigns: Campaign[]; whatsappError?: string; schedulerEnabled: boolean };

const base = "/api/catalog-campaigns";
const selectClass = "min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm";
const stateLabels: Record<string, string> = {
  pending: "Na Agenda", processing: "A publicar", sent: "Aceite pelo WhatsApp", failed: "Envio por confirmar", cancelled: "Cancelada"
};

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function SellerCampaigns() {
  const { hash, search } = useLocation();
  const requestedGroup = hash === "#campanhas" ? new URLSearchParams(search).get("group") : null;
  const section = useRef<HTMLElement>(null);
  const requestKey = useRef<string | null>(null);
  const appliedGroupLink = useRef<string | null>(null);
  const [open, setOpen] = useState(hash === "#campanhas");
  const [data, setData] = useState<CampaignsData | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<"cover" | "preview" | "publish" | "schedule" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [productId, setProductId] = useState("");
  const [groupJid, setGroupJid] = useState("");
  const [caption, setCaption] = useState("");
  const [mode, setMode] = useState<"now" | "scheduled">(requestedGroup ? "scheduled" : "now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [preview, setPreview] = useState("");
  const [cover, setCover] = useState("");
  const [coverRevision, setCoverRevision] = useState(0);
  const [coverError, setCoverError] = useState("");
  const [scheduleEdit, setScheduleEdit] = useState<{ id: string; date: string } | null>(null);
  const [cancelCampaign, setCancelCampaign] = useState<string | null>(null);
  const product = data?.products.find((entry) => entry.id === productId);
  const group = data?.groups.find((entry) => entry.id === groupJid);
  const requestedGroupUnavailable = requestedGroup && data && !data.groups.some((entry) => entry.id === requestedGroup);

  useEffect(() => {
    if (hash !== "#campanhas") return;
    setOpen(true);
    section.current?.scrollIntoView({ block: "start" });
  }, [hash]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    void apiFetch(base, { signal: controller.signal, timeout: 20_000 }).then((response) => {
      if (!controller.signal.aborted && response?.success) setData(response.data);
    }).catch((failure) => {
      if (!controller.signal.aborted) setError(message(failure, "Não foi possível consultar o catálogo e as campanhas."));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open, revision]);

  useEffect(() => {
    if (!requestedGroup || !data || appliedGroupLink.current === requestedGroup) return;
    appliedGroupLink.current = requestedGroup;
    setGroupJid(data.groups.some((entry) => entry.id === requestedGroup) ? requestedGroup : "");
    setMode("scheduled");
    changeDraft();
  }, [requestedGroup, data]);

  useEffect(() => {
    setCover("");
    setCoverError("");
    if (!open || !product?.id || !product.hasCover) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void apiFetch(`${base}/products/${product.id}/cover`, {
      responseType: "blob", signal: controller.signal, timeout: 15_000
    }).then((file: Blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(file);
      setCover(objectUrl);
    }).catch((failure) => {
      if (!controller.signal.aborted) setCoverError(message(failure, "Fotografia indisponível."));
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, product?.id, product?.hasCover, coverRevision]);

  function changeDraft() {
    requestKey.current = null;
    setPreview("");
    setError("");
    setNotice("");
  }

  async function uploadCover(file: File) {
    if (!product || working) return;
    changeDraft();
    if (file.size > 5 * 1024 * 1024) {
      setError("A fotografia deve ter até 5 MiB.");
      return;
    }
    const id = product.id;
    const form = new FormData();
    form.set("image", file);
    setWorking("cover");
    try {
      const response = await apiFetch(`${base}/products/${id}/cover`, { method: "POST", body: form });
      if (!response?.success) throw new Error("A fotografia não foi confirmada.");
      setData((current) => current && { ...current, products: current.products.map((item) => item.id === id ? { ...item, hasCover: true } : item) });
      setCoverRevision((value) => value + 1);
      setNotice("Fotografia guardada no catálogo.");
    } catch (failure) {
      setError(message(failure, "Não foi possível guardar a fotografia."));
    } finally {
      setWorking(null);
    }
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    if (working || !product || !group || !cover) return;
    if (mode === "scheduled" && (!data?.schedulerEnabled || !(Date.parse(scheduledAt) > Date.now()))) {
      setError("Seleciona uma data e hora futuras na Agenda.");
      return;
    }
    setWorking("preview");
    setError("");
    try {
      const response = await apiFetch(`${base}/preview`, { method: "POST", body: JSON.stringify({ productId, caption }) });
      if (!response?.success || typeof response.preview !== "string") throw new Error("Pré-visualização indisponível.");
      setPreview(response.preview);
    } catch (failure) {
      setError(message(failure, "Não foi possível rever esta campanha."));
    } finally {
      setWorking(null);
    }
  }

  async function publish() {
    if (!preview || !product || !group || working) return;
    const key = requestKey.current ??= crypto.randomUUID();
    setWorking("publish");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(base, { method: "POST", timeout: 75_000, body: JSON.stringify({
        productId, groupJid, caption, requestKey: key, publishNow: mode === "now",
        ...(mode === "scheduled" ? { scheduledAt: new Date(scheduledAt).toISOString() } : {})
      }) });
      if (!response?.success || !response.id) throw new Error("A base não confirmou a campanha.");
      const waiting = mode === "now" && ["pending", "processing", "queued"].includes(response.status);
      if (!waiting) changeDraft();
      const statusMessages: Record<string, string> = {
        sent: "A publicação foi aceite pelo WhatsApp neste grupo.", failed: "O envio não foi confirmado. Consulta o estado da campanha.",
        cancelled: "Esta campanha já foi cancelada."
      };
      setNotice(response.warning || statusMessages[response.status] ||
        (mode === "scheduled" ? "Campanha guardada na Agenda." : "Campanha guardada. Consulta o estado da publicação."));
      setRevision((value) => value + 1);
    } catch (failure) {
      setError(message(failure, "Não foi possível confirmar a campanha. Consulta a lista antes de criar outra."));
    } finally {
      setWorking(null);
    }
  }

  async function changeSchedule(id: string, date?: string) {
    if (working) return;
    const cancel = date === undefined;
    if (!cancel && !(Date.parse(date) > Date.now())) {
      setError("Seleciona uma data e hora futuras para o agendamento.");
      return;
    }
    setWorking("schedule");
    setError("");
    setNotice("");
    try {
      const response = await apiFetch(`${base}/${encodeURIComponent(id)}/schedule`, {
        method: cancel ? "DELETE" : "PATCH", timeout: 15_000,
        ...(cancel ? {} : { body: JSON.stringify({ scheduledAt: new Date(date).toISOString() }) })
      });
      if (!response?.success) throw new Error("Não foi possível confirmar a alteração da Agenda.");
      setScheduleEdit(null);
      setCancelCampaign(null);
      setNotice(cancel ? "Campanha cancelada." : "Campanha reagendada.");
    } catch (failure) {
      setError(message(failure, "Não foi possível atualizar a campanha na Agenda."));
    } finally {
      setWorking(null);
      setRevision((value) => value + 1);
    }
  }

  return <section ref={section} id="campanhas" aria-labelledby="campaign-title" className="scroll-mt-5 rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="campaign-title" className="text-lg font-semibold">Campanhas do catálogo</h2>
        <p className="mt-1 text-sm text-slate-600">Divulga um produto num grupo e identifica o interesse quando a pessoa escreve em privado.</p></div>
      <Button type="button" variant="outline" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? "Recolher" : "Abrir campanhas"}</Button>
    </div>
    {open && <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-3">
        {loading && <p role="status" className="text-sm text-slate-600">A consultar catálogo e agenda…</p>}
        {data?.whatsappError && <p className="text-sm text-amber-900">{data.whatsappError}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
        <Button type="button" size="sm" variant="outline" disabled={loading || Boolean(working)} onClick={() => {
          setError("");
          setRevision((value) => value + 1);
        }}>Atualizar catálogo e campanhas</Button>
        {data && <form className="space-y-3" onSubmit={review}>
          <fieldset className="space-y-3" disabled={Boolean(working)}>
            <label className="block text-sm font-medium">Produto
              <select required className={selectClass} value={productId} onChange={(event) => { setProductId(event.target.value); changeDraft(); }}>
                <option value="">Seleciona um produto ativo</option>
                {data.products.map((item) => <option key={item.id} value={item.id}>{item.name} · {Number(item.price).toLocaleString("pt-MZ")} {item.currency || "MT"} · {item.stock} em stock</option>)}
              </select>
            </label>
            {data.products.length === 0 && <p className="text-sm text-slate-600">Disponibiliza um produto com preço e stock em <Link className="underline" to="/orders?tab=products">Catálogo</Link>.</p>}
            {product && <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
              {cover && <img className="h-16 w-16 rounded-lg object-cover" src={cover} alt={`Fotografia de ${product.name}`} />}
              <div><label className="block font-medium">{product.hasCover ? "Substituir fotografia" : "Adicionar fotografia"}
                <input className="block max-w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void uploadCover(file);
                }} /></label>
                {working === "cover" && <p role="status">A guardar a fotografia…</p>}
                {coverError && <p role="alert" className="text-red-700">{coverError}</p>}
              </div>
            </div>}
            <label className="block text-sm font-medium">Grupo de WhatsApp
              <select required className={selectClass} value={groupJid} onChange={(event) => { setGroupJid(event.target.value); changeDraft(); }}>
                <option value="">Seleciona um grupo onde podes publicar</option>
                {data.groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {requestedGroupUnavailable && !groupJid && <p className="text-sm text-amber-900">O grupo selecionado não está disponível para publicar. Escolhe um grupo em que a conta ligada pode escrever.</p>}
            <label className="block text-sm font-medium">Texto da campanha (opcional)
              <textarea className="min-h-20 w-full rounded-xl border border-slate-200 p-3" maxLength={400} value={caption}
                onChange={(event) => { setCaption(event.target.value); changeDraft(); }} />
            </label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="campaign-time" checked={mode === "now"}
                onChange={() => { setMode("now"); changeDraft(); }} /> Publicar agora</label>
              <label className="flex items-center gap-2"><input type="radio" name="campaign-time" checked={mode === "scheduled"}
                disabled={!data.schedulerEnabled} onChange={() => { setMode("scheduled"); changeDraft(); }} /> Agendar</label>
            </div>
            {!data.schedulerEnabled && <p className="text-sm text-amber-900">A Agenda automática está desligada.</p>}
            {mode === "scheduled" && <label className="block text-sm font-medium">Data e hora local
              <Input type="datetime-local" required value={scheduledAt} onChange={(event) => { setScheduledAt(event.target.value); changeDraft(); }} />
            </label>}
          </fieldset>
          <Button type="submit" disabled={Boolean(working) || !product || !group || !cover || Boolean(preview) || (mode === "scheduled" && !data.schedulerEnabled)}>
            {working === "preview" ? "A preparar…" : "Rever publicação"}
          </Button>
        </form>}
        {preview && <section aria-label="Pré-visualização da campanha" className="space-y-3 rounded-xl border border-slate-200 p-3">
          <h3 className="font-semibold">Pré-visualização em {group?.name}</h3>
          {cover && <img className="max-h-44 rounded-lg object-contain" src={cover} alt={product?.name || "Produto da campanha"} />}
          <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{preview}</p>
          <p className="text-xs text-slate-600">O preço, o stock e a fotografia são verificados no momento do envio.</p>
          <Button type="button" disabled={Boolean(working)} onClick={() => void publish()}>
            {working === "publish" ? "A guardar…" : mode === "now" ? (requestKey.current ? "Verificar publicação" : "Confirmar publicação") : "Confirmar agendamento"}
          </Button>
        </section>}
      </div>
      <div>
        <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Publicações recentes</h3><Link className="text-sm text-emerald-800 underline" to="/schedule">Abrir Agenda</Link></div>
        {data?.campaigns.length === 0 && <p className="mt-2 text-sm text-slate-600">Ainda não há campanhas.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {data?.campaigns.map((entry) => <li key={entry.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{entry.product_name}</strong>
              <span className="text-slate-600">{stateLabels[entry.status] || "Por consultar"}</span></div>
            <p className="text-slate-600">{entry.group_name} · {new Date(entry.published_at || entry.scheduled_at).toLocaleString("pt-MZ")}</p>
            {entry.error && <p className="text-amber-900">{entry.error}</p>}
            {entry.status === "pending" && <div className="mt-2 flex flex-wrap gap-2">
              {scheduleEdit?.id === entry.id ? <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
                event.preventDefault(); void changeSchedule(entry.id, scheduleEdit.date);
              }}>
                <Input type="datetime-local" required aria-label="Nova data e hora local" value={scheduleEdit.date} disabled={Boolean(working)}
                  onChange={(event) => setScheduleEdit({ id: entry.id, date: event.target.value })} />
                <Button type="submit" size="sm" disabled={Boolean(working)}>Guardar novo horário</Button>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(working)} onClick={() => setScheduleEdit(null)}>Voltar</Button>
              </form> : cancelCampaign === entry.id ? <div className="flex flex-wrap items-center gap-2">
                <p>Cancelar a publicação agendada?</p>
                <Button type="button" size="sm" variant="danger" disabled={Boolean(working)} onClick={() => void changeSchedule(entry.id)}>Confirmar cancelamento</Button>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(working)} onClick={() => setCancelCampaign(null)}>Voltar</Button>
              </div> : <>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(working) || !data.schedulerEnabled}
                  onClick={() => { setCancelCampaign(null); setScheduleEdit({ id: entry.id, date: "" }); }}>Reagendar</Button>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(working)}
                  onClick={() => { setScheduleEdit(null); setCancelCampaign(entry.id); }}>Cancelar agendamento</Button>
              </>}
            </div>}
          </li>)}
        </ul>
      </div>
    </div>}
  </section>;
}
