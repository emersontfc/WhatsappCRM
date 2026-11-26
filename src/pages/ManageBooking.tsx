import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Loader2 } from "lucide-react";
import AgentXLogo from "../components/AgentXLogo";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ApiError, apiFetch } from "../lib/api";
import { dayInZone, readBookingZone } from "../lib/publicBooking";

const apiPath = "/api/appointments/public/manage";
const unavailableLink = "O link expirou ou já não está disponível.";
const statusLabels = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  completed: "Concluída",
  cancelled: "Cancelada"
};

type Appointment = {
  appointment_date: string;
  start_time: string;
  end_time: string | null;
  time_zone: string | null;
  status: keyof typeof statusLabels;
  revision: string;
  canManage: boolean;
  businessName?: string;
  services: { name: string } | null;
  professionals: { name: string } | null;
};

type Action = { name: "reschedule" | "cancel"; revision: string };
type SlotList = { date: string; times: string[]; timeZone: string };

function appointmentFrom(response: { success?: boolean; data?: Appointment }) {
  const data = response?.data;
  if (!response?.success || !data || !Object.hasOwn(statusLabels, data.status) ||
      typeof data.revision !== "string" || typeof data.canManage !== "boolean" ||
      typeof data.appointment_date !== "string" || typeof data.start_time !== "string") {
    throw new Error("A agenda não confirmou os dados da marcação.");
  }
  return data;
}

function displayDate(date: string) {
  return date.split("-").reverse().join("/");
}

export default function ManageBooking({ token, bookingPath }: { token: string; bookingPath: string }) {
  const [loading, setLoading] = useState(Boolean(token));
  const [lookupError, setLookupError] = useState(token ? "" : unavailableLink);
  const [lookupVersion, setLookupVersion] = useState(0);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [date, setDate] = useState("");
  const [slotList, setSlotList] = useState<SlotList | null>(null);
  const [slotError, setSlotError] = useState("");
  const [slotVersion, setSlotVersion] = useState(0);
  const [selectedTime, setSelectedTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const pending = useRef<AbortController | null>(null);
  const actionHeading = useRef<HTMLHeadingElement>(null);
  const activeAction = appointment?.canManage && action?.revision === appointment.revision ? action?.name : null;
  const timeZone = readBookingZone(appointment?.time_zone, "Africa/Maputo");
  const slotDate = !loading && !lookupError && activeAction === "reschedule" ? date : "";
  const slots = slotList?.date === slotDate ? slotList : null;
  const times = slots?.times.filter((time) => slotDate !== appointment?.appointment_date ||
    slots.timeZone !== timeZone || time.slice(0, 5) !== appointment.start_time.slice(0, 5)) ?? [];

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    apiFetch(apiPath, {
      authenticate: false, cache: "no-store", headers: { "X-Booking-Token": token }, signal: controller.signal
    }).then((response) => {
      const current = appointmentFrom(response);
      if (!controller.signal.aborted) setAppointment(current);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLookupError(error instanceof ApiError && error.status === 404
        ? unavailableLink : "Não foi possível consultar a marcação. Tenta novamente.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [token, lookupVersion]);

  useEffect(() => {
    if (!slotDate) return;
    const controller = new AbortController();
    setSlotList(null);
    setSlotError("");
    setSelectedTime("");
    const search = new URLSearchParams({ date: slotDate });
    apiFetch(`${apiPath}/slots?${search}`, {
      authenticate: false, cache: "no-store", headers: { "X-Booking-Token": token }, signal: controller.signal
    }).then((response) => {
      if (!response?.success || !Array.isArray(response.slots) || response.slots.some((value: unknown) => typeof value !== "string")) {
        throw new Error("Horários indisponíveis.");
      }
      if (controller.signal.aborted) return;
      setSlotList({ date: slotDate, times: response.slots, timeZone: readBookingZone(response.timeZone, timeZone) });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setSlotError(error instanceof ApiError && error.status === 404 ? unavailableLink : "Não foi possível carregar os horários.");
    });
    return () => controller.abort();
  }, [slotDate, slotVersion, timeZone, token]);

  useEffect(() => () => pending.current?.abort(), []);

  useEffect(() => {
    if (activeAction && !loading) actionHeading.current?.focus();
  }, [activeAction, loading]);

  function refreshAppointment() {
    setLookupError("");
    setLoading(true);
    setSlotList(null);
    setSelectedTime("");
    setLookupVersion((version) => version + 1);
  }

  function begin(name: Action["name"]) {
    if (!appointment?.canManage) return;
    setStatus("");
    setSlotList(null);
    setSlotError("");
    setSelectedTime("");
    const today = dayInZone(timeZone);
    setDate(appointment.appointment_date >= today ? appointment.appointment_date : today);
    setAction({ name, revision: appointment.revision });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeAction || !action || pending.current || (activeAction === "reschedule" && !times.includes(selectedTime))) return;
    const controller = new AbortController();
    pending.current = controller;
    setSaving(true);
    setStatus("");
    const selection = activeAction === "reschedule" ? { appointmentDate: date, startTime: selectedTime } : {};
    try {
      const response = await apiFetch(`${apiPath}/${activeAction}`, {
        method: "POST", authenticate: false, cache: "no-store", headers: { "X-Booking-Token": token },
        body: JSON.stringify({ revision: action.revision, ...selection }), signal: controller.signal
      });
      if (controller.signal.aborted) return;
      setAppointment(appointmentFrom(response));
      setAction(null);
      setStatus(activeAction === "reschedule" ? "Marcação remarcada." : "Marcação cancelada.");
    } catch (error) {
      if (controller.signal.aborted) return;
      setStatus(error instanceof ApiError && error.status === 409
        ? "A marcação ou o horário mudou. Confere os dados atualizados."
        : "A alteração ficou por confirmar. Confere o estado atual antes de tentar novamente.");
      refreshAppointment();
    } finally {
      if (pending.current === controller && !controller.signal.aborted) {
        pending.current = null;
        setSaving(false);
      }
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:py-12">
      <header className="mx-auto mb-6 flex w-full max-w-xl justify-center">
        <AgentXLogo size="sm" />
      </header>
      <main className="mx-auto w-full max-w-xl space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-emerald-50 p-2.5 text-emerald-700"><CalendarDays size={22} aria-hidden="true" /></span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold">Gerir marcação</h1>
            {!loading && !lookupError && appointment?.businessName && (
              <p className="break-words text-sm text-slate-600">{appointment.businessName}</p>
            )}
          </div>
        </div>

        {loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin text-emerald-600" aria-hidden="true" /> A carregar a marcação…</p>}
        {!loading && lookupError && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-slate-700">{lookupError}</p>
            {lookupError !== unavailableLink && <Button variant="outline" onClick={refreshAppointment}>Tentar novamente</Button>}
          </div>
        )}
        {!loading && !lookupError && appointment && (
          <>
            <dl className="grid gap-x-4 gap-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-600">Serviço</dt><dd className="break-words font-semibold">{appointment.services?.name || "Marcação"}</dd></div>
              <div><dt className="text-slate-600">Profissional</dt><dd className="break-words font-semibold">{appointment.professionals?.name || "Equipa"}</dd></div>
              <div>
                <dt className="text-slate-600">Data e hora</dt>
                <dd className="font-semibold">{displayDate(appointment.appointment_date)} às {appointment.start_time.slice(0, 5)}</dd>
                <dd className="text-xs text-slate-600">{timeZone}</dd>
              </div>
              <div><dt className="text-slate-600">Estado</dt><dd className="font-semibold">{statusLabels[appointment.status]}</dd></div>
            </dl>
            {status && <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-800">{status}</p>}
            {appointment.canManage && !activeAction && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => begin("reschedule")}>Remarcar</Button>
                <Button variant="outline" onClick={() => begin("cancel")}>Cancelar marcação</Button>
              </div>
            )}
            {!appointment.canManage && appointment.status !== "cancelled" && (
              <p className="text-sm text-slate-600">Para tratar desta marcação, fala com a equipa.</p>
            )}
            {activeAction === "reschedule" && (
              <form onSubmit={submit} className="space-y-4 border-t border-slate-100 pt-4">
                <h2 ref={actionHeading} tabIndex={-1} className="font-bold">Escolher nova data e hora</h2>
                <fieldset disabled={saving} className="space-y-3">
                  <label htmlFor="manage-booking-date" className="block text-sm font-medium">Nova data</label>
                  <Input id="manage-booking-date" type="date" min={dayInZone(slots?.timeZone ?? timeZone)} value={date}
                    onChange={(event) => { setDate(event.target.value); setSlotList(null); setSlotError(""); setSelectedTime(""); setStatus(""); }} />
                  {slotError ? (
                    <div className="space-y-2">
                      <p role="alert" className="text-sm text-red-700">{slotError}</p>
                      <Button type="button" variant="outline" onClick={() => setSlotVersion((version) => version + 1)}>Atualizar horários</Button>
                    </div>
                  ) : slots ? (
                    <div role="group" aria-label="Horários livres" className="space-y-2">
                      <p className="text-sm text-slate-600">Horários livres em {slots.timeZone}</p>
                      {times.length ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {times.map((time) => (
                          <Button key={time} type="button" variant={selectedTime === time ? "primary" : "outline"}
                            aria-pressed={selectedTime === time} onClick={() => setSelectedTime(time)}>{time.slice(0, 5)}</Button>
                        ))}
                      </div> : <p role="status" className="text-sm text-slate-600">Nenhum horário livre nesta data.</p>}
                    </div>
                  ) : <p role="status" className="text-sm text-slate-600">{slotDate ? "A carregar horários…" : "Escolhe uma data para consultar os horários."}</p>}
                </fieldset>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving || !times.includes(selectedTime)}>{saving ? "A guardar…" : "Confirmar novo horário"}</Button>
                  <Button type="button" variant="outline" disabled={saving} onClick={() => setAction(null)}>Voltar</Button>
                </div>
              </form>
            )}
            {activeAction === "cancel" && (
              <form onSubmit={submit} className="space-y-3 rounded-2xl border border-red-200 bg-red-50 p-4">
                <h2 ref={actionHeading} tabIndex={-1} className="font-bold text-red-900">Confirmar cancelamento</h2>
                <p className="text-sm text-red-900">Ao confirmar, o horário fica livre para outra pessoa.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" disabled={saving} onClick={() => setAction(null)}>Manter marcação</Button>
                  <Button type="submit" variant="danger" disabled={saving}>{saving ? "A cancelar…" : "Confirmar cancelamento"}</Button>
                </div>
              </form>
            )}
          </>
        )}
        {!loading && <Link to={bookingPath} className="inline-block text-sm font-semibold text-emerald-800 underline underline-offset-2">Voltar à página de marcações</Link>}
      </main>
    </div>
  );
}
