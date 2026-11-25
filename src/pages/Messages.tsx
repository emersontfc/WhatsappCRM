import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Send,
  User,
  Phone,
  Search,
  Sparkles,
  MessageSquare,
  ChevronLeft,
  Zap,
  List,
  X,
  Mic,
  Bot,
  UserCheck,
  PanelRightClose,
  PanelRightOpen,
  Tag,
  Plus,
  ExternalLink,
  FileText,
  TrendingUp,
  Save,
  Clock,
  CheckCheck,
  Play,
  Pause,
  Download,
  Paperclip,
  ChevronDown
} from "lucide-react";
import { toast } from "sonner";
import { supabase, getUserId } from "../supabase";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { cn } from "../lib/utils";
import { ApiError, apiFetch } from "../lib/api";
import { makeChatRefresh, mergeMessage } from "../lib/chatMessages";
import { useActivation } from "../lib/useActivation";
import { VoiceRecorder, type VoiceSendOutcome } from "../components/VoiceRecorder";
import { uploadVoiceAudio, useVoicePlayback } from "../lib/voiceAudio";
import { isAudioAttachment } from "../../shared/voiceAudio";
import { Contact, Message, Lead, LeadStage, LEAD_STAGES } from "../types";
import { getContactDisplay, formatPhoneNumber } from "./Contacts";

interface QuickReply {
  id: string;
  trigger: string;
  response_text: string;
  shortcut?: string;
}

interface Agent {
  id: string;
  provider: string;
  model: string;
  instructions: string;
}

type ConversationFilter = "all" | "unread" | "ai" | "human" | "leads";

async function loadConversations(signal?: AbortSignal): Promise<Contact[]> {
  const result = await apiFetch("/api/whatsapp/chats", { signal, timeout: 12000 });
  if (result?.success !== true || !Array.isArray(result.chats)) throw new Error("Lista de conversas indisponível.");
  return result.chats;
}

type HistoryPage = { messages: Message[]; hasMore: boolean; beforeCursor: string | null; afterCursor: string | null };
const historyPageSize = 50;

async function loadHistory(
  contactId: string,
  signal: AbortSignal,
  cursor?: { direction: "before" | "after"; value: string }
): Promise<HistoryPage> {
  const query = new URLSearchParams({ limit: String(historyPageSize) });
  if (cursor) query.set(cursor.direction, cursor.value);
  const result = await apiFetch(`/api/whatsapp/chats/${contactId}/messages?${query}`, { signal, timeout: 12000 });
  if (result?.success !== true || !Array.isArray(result.messages) || typeof result.hasMore !== "boolean" ||
      (result.messages.length > 0 && (!result.beforeCursor || !result.afterCursor))) {
    throw new Error("Histórico indisponível.");
  }
  return result;
}

function isDirectConversation(contact: Contact) {
  const phone = contact.phone ?? "";
  const lid = contact.lid ?? "";
  const phoneDigits = phone.replace(/\D/g, "");
  const lidDigits = lid.replace(/\D/g, "");
  if (/@(g\.us|broadcast|newsletter)$/.test(phone) || /@(g\.us|broadcast|newsletter)$/.test(lid) ||
      phoneDigits.startsWith("120363") || lidDigits.startsWith("120363")) return false;
  return (phoneDigits.length >= 7 && phoneDigits.length <= 18) || lidDigits.length >= 5;
}

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
};

const getColorClass = (name: string) => {
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-purple-100 text-purple-700',
    'bg-rose-100 text-rose-700',
    'bg-indigo-100 text-indigo-700',
    'bg-cyan-100 text-cyan-700',
    'bg-fuchsia-100 text-fuchsia-700',
  ];
  const index = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[index % colors.length];
};

function VoiceMessagePlayer({ src, isOut }: { src: string; isOut: boolean }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playAfterLoad = useRef(false);
  const voice = useVoicePlayback(src);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [src]);

  useEffect(() => {
    if (!voice.url || !playAfterLoad.current || !audioRef.current) return;
    playAfterLoad.current = false;
    audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  }, [voice.url]);

  const togglePlay = () => {
    if (!voice.url) {
      playAfterLoad.current = true;
      voice.load();
      return;
    }
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = target;
      setCurrentTime(target);
    }
  };

  const cyclePlaybackRate = () => {
    if (!audioRef.current) return;
    const rates = [1, 1.5, 2];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    audioRef.current.playbackRate = nextRate;
    setPlaybackRate(nextRate);
  };

  const formatSec = (sec: number) => {
    if (isNaN(sec) || !isFinite(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className={cn(
      "flex items-center gap-2 p-2 rounded-xl my-1 min-w-[200px] max-w-[280px]",
      isOut ? "bg-emerald-700/50 text-white" : "bg-slate-100 text-slate-800"
    )}>
      <audio ref={audioRef} src={voice.url} preload="metadata" />
      <button
        type="button"
        onClick={togglePlay}
        disabled={voice.loading}
        aria-label={voice.loading ? "A carregar nota de voz" : isPlaying ? "Pausar nota de voz" : "Ouvir nota de voz"}
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 shadow-sm",
          isOut ? "bg-white text-emerald-700 hover:bg-slate-100" : "bg-emerald-600 text-white hover:bg-emerald-700"
        )}
      >
        {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
        <input
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={handleSeek}
          className={cn(
            "w-full h-1.5 rounded-lg appearance-none cursor-pointer focus:outline-none accent-emerald-500",
            isOut ? "bg-white/30" : "bg-slate-300"
          )}
        />
        <div className="flex justify-between items-center text-[10px] font-mono leading-none opacity-80">
          <span>{voice.failed ? "Áudio indisponível" : formatSec(currentTime > 0 ? currentTime : duration)}</span>
          <button
            type="button"
            onClick={cyclePlaybackRate}
            className={cn(
              "text-[9px] font-bold px-1.5 py-0.5 rounded transition-all",
              isOut ? "bg-white/20 hover:bg-white/30" : "bg-slate-200 hover:bg-slate-300"
            )}
            title="Velocidade"
          >
            {playbackRate}x
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Messages() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isActivated, loading: activationLoading } = useActivation();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<ConversationFilter>("all");
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [showChatOnMobile, setShowChatOnMobile] = useState(false);
  const [showCrmPanel, setShowCrmPanel] = useState(false);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);

  // CRM Panel State for current contact
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [leadLoading, setLeadLoading] = useState(false);
  const [contactNotes, setContactNotes] = useState("");
  const [contactTags, setContactTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [contactNameInput, setContactNameInput] = useState("");
  const [savingCrm, setSavingCrm] = useState(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousMessageAnchor = useRef<{ row: HTMLElement; offset: number } | null>(null);
  const olderPageRequest = useRef<(() => void) | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: 'image' | 'video'; title?: string } | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  // Initial Load
  useEffect(() => {
    if (activationLoading) return;
    let isMounted = true;

    const init = async () => {
      try {
        const uId = await getUserId();
        if (!uId || uId === "guest-user") return;
        setUserId(uId);

        void apiFetch("/api/packs/my").then((response) => {
          if (isMounted && response.success) setQuickReplies(response.data);
        }).catch((error) => console.error("Quick replies unavailable:", error));

        void Promise.resolve(supabase.from("agents").select("*").eq("user_id", uId).eq("is_active", true))
          .then(({ data }) => {
            if (!isMounted || !data) return;
            setAgents(data);
            if (data.length) setSelectedAgentId(data[0].id);
          }).catch((error) => console.error("Agents unavailable:", error));

      } catch {
        if (isMounted) setContactsError("Não foi possível carregar as conversas. A lista será consultada novamente.");
      }
    };

    init();
    return () => { isMounted = false; };
  }, [activationLoading]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    const phoneParam = searchParams.get("phone");
    const contactIdParam = searchParams.get("contactId");
    let openedInitialContact = false;
    const sync = makeChatRefresh(async () => {
      const data = await loadConversations(controller.signal);
      if (controller.signal.aborted) return;
      setContacts((current) => JSON.stringify(current) === JSON.stringify(data) ? current : data);
      setContactsError(null);
      if (!openedInitialContact) {
        openedInitialContact = true;
        const initial = contactIdParam ? data.find(contact => contact.id === contactIdParam)
          : phoneParam ? data.find(contact => contact.phone === phoneParam) ?? data.find(contact =>
            contact.phone && (contact.phone.includes(phoneParam) || phoneParam.includes(contact.phone))) : undefined;
        if (initial) {
          setSelectedContact(initial);
          setShowChatOnMobile(true);
        }
      }
    }, () => !document.hidden && navigator.onLine, () => {
      setContactsError("Não foi possível carregar as conversas. A lista será consultada novamente.");
    });
    const channel = supabase.channel(`messages-contacts-${userId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "contacts", filter: `user_id=eq.${userId}`
      }, sync.received)
      .subscribe(status => sync.connection(status === "SUBSCRIBED"));
    const visibility = () => { if (document.hidden) sync.suspend(); else sync.recover(); };
    sync.recover();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", sync.suspend);
    window.addEventListener("online", sync.recover);
    return () => {
      controller.abort();
      sync.stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", sync.suspend);
      window.removeEventListener("online", sync.recover);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  // Keep the open conversation independent from optional lead and pack requests.
  const contactId = selectedContact?.id;
  const currentChat = useRef<string | undefined>(undefined);
  useEffect(() => {
    currentChat.current = contactId;
    return () => { currentChat.current = undefined; };
  }, [contactId]);
  useEffect(() => {
    if (!selectedContact || !contactId || !userId) return;
    let active = true;

    setCurrentLead(null);
    setContactNotes(selectedContact.notes || "");
    setContactTags(Array.isArray(selectedContact.tags) ? selectedContact.tags : []);
    setContactNameInput(selectedContact.name || "");
    setIsEditingName(false);

    setLeadLoading(true);
    const loadLead = async () => {
      try {
        const linked = await supabase.from("leads").select("*").eq("user_id", userId).eq("contact_id", contactId)
          .order("created_at", { ascending: true, nullsFirst: false }).order("id").limit(1).maybeSingle();
        if (linked.error) throw linked.error;
        let lead = linked.data;
        if (!lead && selectedContact.phone) {
          const byPhone = await supabase.from("leads").select("*").eq("user_id", userId).eq("phone", selectedContact.phone)
            .order("created_at", { ascending: true, nullsFirst: false }).order("id").limit(1).maybeSingle();
          if (byPhone.error) throw byPhone.error;
          lead = byPhone.data;
        }
        if (active) setCurrentLead(lead);
      } catch (error) {
        console.error("Lead unavailable:", error);
      } finally {
        if (active) setLeadLoading(false);
      }
    };
    void loadLead();

    void markConversationAsRead(contactId);

    return () => { active = false; };
  }, [contactId, userId]);

  useEffect(() => {
    if (!contactId || !userId) return;
    const controller = new AbortController();
    const { signal } = controller;
    const canRefresh = () => !document.hidden && navigator.onLine;
    let initialized = false;
    let afterCursor: string | null = null;
    let beforeCursor: string | null = null;
    let readingOlder = false;

    previousMessageAnchor.current = null;
    setMessages([]);
    setHistoryError(null);
    setHistoryLoading(true);
    setHasOlderMessages(false);
    setLoadingOlder(false);
    setOlderError(false);
    setIsNearBottom(true);

    const mergePage = (page: HistoryPage) => {
      if (page.messages.length) setMessages(current => page.messages.reduce(mergeMessage, current));
    };

    const sync = makeChatRefresh(async (reconcileHead) => {
      try {
        if (!afterCursor) {
          const head = await loadHistory(contactId, signal);
          if (signal.aborted) return;
          mergePage(head);

          if (!initialized) {
            beforeCursor = head.hasMore ? head.beforeCursor : null;
            setHasOlderMessages(Boolean(beforeCursor));
          } else {
            // After an empty initial conversation, everything in this first batch is new.
            // Drain all pages even if more than one page arrived while it was offline.
            let cursor = head.hasMore ? head.beforeCursor : null;
            while (cursor && !signal.aborted && canRefresh()) {
              const page = await loadHistory(contactId, signal, { direction: "before", value: cursor });
              if (signal.aborted) return;
              if (page.hasMore && (!page.beforeCursor || page.beforeCursor === cursor)) {
                throw new Error("O cursor do histórico não avançou.");
              }
              mergePage(page);
              cursor = page.hasMore ? page.beforeCursor : null;
            }
            if (cursor) return;
          }
          afterCursor = head.afterCursor;
          initialized = true;
        } else {
          let hasMore = true;
          while (hasMore && !signal.aborted && canRefresh()) {
            const page = await loadHistory(contactId, signal, { direction: "after", value: afterCursor });
            if (signal.aborted) return;
            mergePage(page);
            if (page.hasMore && (!page.afterCursor || page.afterCursor === afterCursor)) {
              throw new Error("O cursor do histórico não avançou.");
            }
            afterCursor = page.afterCursor ?? afterCursor;
            hasMore = page.hasMore;
          }

          // WhatsApp can assign an earlier timestamp to a message that arrived late.
          // Check the recent window on recovery without advancing past an unread delta page.
          if (reconcileHead && canRefresh()) {
            const head = await loadHistory(contactId, signal);
            if (signal.aborted) return;
            mergePage(head);
          }
        }
        if (!signal.aborted) setHistoryError(null);
      } finally {
        if (!signal.aborted) setHistoryLoading(false);
      }
    }, canRefresh, () => {
      setHistoryError("Não foi possível consultar o histórico. A conversa será consultada novamente.");
    });

    olderPageRequest.current = () => {
      if (!beforeCursor || readingOlder || signal.aborted) return;
      const cursor = beforeCursor;
      readingOlder = true;
      setLoadingOlder(true);
      setOlderError(false);
      void (async () => {
        try {
          const page = await loadHistory(contactId, signal, { direction: "before", value: cursor });
          if (signal.aborted) return;
          if (page.hasMore && (!page.beforeCursor || page.beforeCursor === cursor)) {
            throw new Error("O cursor do histórico não avançou.");
          }

          const container = messagesContainerRef.current;
          if (container && page.messages.length) {
            const top = container.getBoundingClientRect().top;
            const row = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-message]"))
              .find(element => element.getBoundingClientRect().bottom > top);
            if (row) previousMessageAnchor.current = { row, offset: row.getBoundingClientRect().top - top };
          }

          mergePage(page);
          beforeCursor = page.hasMore ? page.beforeCursor : null;
          setHasOlderMessages(Boolean(beforeCursor));
        } catch {
          if (!signal.aborted) setOlderError(true);
        } finally {
          readingOlder = false;
          if (!signal.aborted) setLoadingOlder(false);
        }
      })();
    };

    const channel = supabase.channel(`messages-chat-${userId}-${contactId}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "messages", filter: `contact_id=eq.${contactId}`
      }, ({ new: row }) => {
        const incoming = row as Message;
        if (signal.aborted || incoming.user_id !== userId || incoming.contact_id !== contactId) return;
        setMessages(current => mergeMessage(current, incoming));
      })
      .subscribe(status => sync.connection(status === "SUBSCRIBED"));
    const visibility = () => { if (document.hidden) sync.suspend(); else sync.recover(); };
    sync.recover();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("offline", sync.suspend);
    window.addEventListener("online", sync.recover);
    return () => {
      olderPageRequest.current = null;
      controller.abort();
      sync.stop();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("offline", sync.suspend);
      window.removeEventListener("online", sync.recover);
      void supabase.removeChannel(channel);
    };
  }, [contactId, userId]);

  const handleMessagesScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const near = scrollHeight - scrollTop - clientHeight < 120;
    setIsNearBottom(near);
  };

  const scrollToBottom = (smooth = true) => {
    const container = messagesContainerRef.current;
    container?.scrollTo({ top: container.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  useLayoutEffect(() => {
    const anchor = previousMessageAnchor.current;
    const container = messagesContainerRef.current;
    previousMessageAnchor.current = null;
    if (anchor?.row.isConnected && container) {
      const offset = anchor.row.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += offset - anchor.offset;
      handleMessagesScroll();
    } else if (isNearBottom) {
      scrollToBottom(false);
    }
  }, [messages, hasOlderMessages]);

  const markConversationAsRead = async (contactId: string) => {
    try {
      await apiFetch(`/api/whatsapp/chats/${contactId}/read`, { method: "POST" });
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, unread_count: 0 } : c));
    } catch (e) {
      // Non-blocking
    }
  };

  const handleSelectContact = (contact: Contact) => {
    if (contact.id !== contactId) {
      currentChat.current = contact.id;
      setMessages([]);
      setIsRecording(false);
    }
    setSelectedContact(contact);
    setShowCrmPanel(false);
    setShowChatOnMobile(true);
    setSearchParams(contact.phone ? { phone: contact.phone } : { contactId: contact.id });
  };

  const handleAttachmentClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const destination = selectedContact?.id;
    if (!file || !destination || !userId || isUploadingAttachment) return;

    setIsUploadingAttachment(true);
    const toastId = toast.loading("A preparar anexo…");
    try {
      const audio = isAudioAttachment(file.type, file.name);
      let upload;
      if (audio) {
        upload = await uploadVoiceAudio(file, file.name);
      } else {
        const body = new FormData();
        body.append("file", file);
        upload = await apiFetch("/api/media/upload", { method: "POST", body });
        if (!upload?.success || !upload.url) throw new Error("Não foi possível carregar o anexo.");
      }

      if (currentChat.current !== destination) {
        toast.error("A conversa mudou. Seleciona o anexo de novo para enviar.", { id: toastId });
        return;
      }

      const mediaType = audio ? "audio" : file.type.startsWith("image/") ? "image"
        : file.type.startsWith("video/") ? "video" : "document";
      const outcome = await handleSend(undefined, upload.url, mediaType, "", upload.duration, file.name, upload.mimetype || file.type);
      if (outcome === "sent") toast.success("Anexo enviado.", { id: toastId });
      else toast.dismiss(toastId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o anexo.", { id: toastId });
    } finally {
      setIsUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleAiMode = async () => {
    if (!selectedContact) return;
    const nextState = !selectedContact.ai_paused;
    try {
      const res = await apiFetch(`/api/whatsapp/chats/${selectedContact.id}/toggle-ai`, {
        method: "POST",
        body: JSON.stringify({ paused: nextState })
      });

      if (res.success) {
        setSelectedContact(prev => prev ? { ...prev, ai_paused: nextState } : null);
        setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, ai_paused: nextState } : c));
        toast.success(nextState ? "Atendimento Humano assumido (IA pausada nesta conversa)" : "IA reativada para esta conversa!");
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao alterar modo da IA");
    }
  };

  const handleSend = async (
    e?: React.FormEvent,
    mediaUrl?: string,
    mediaType?: string,
    textOverride?: string,
    duration?: number,
    fileName?: string,
    mimetype?: string
  ): Promise<VoiceSendOutcome> => {
    if (e) e.preventDefault();
    const textToSend = (textOverride !== undefined ? textOverride : newMessage).trim();
    if ((!textToSend && !mediaUrl) || !selectedContact || !userId || selectedContact.id !== currentChat.current) {
      return "failed";
    }
    if (!isActivated) {
      toast.error("Ative seu plano para enviar mensagens.");
      return "failed";
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticMsg: any = {
      id: tempId,
      user_id: userId,
      contact_id: selectedContact.id,
      text: textToSend || (mediaType === "audio" ? "🎵 Áudio" : mediaType === "image" ? "📷 Foto" : mediaType === "video" ? "🎥 Vídeo" : "📄 Documento"),
      type: "outbound",
      timestamp: new Date().toISOString(),
      media_url: mediaUrl,
      media_type: mediaType,
      media_mimetype: mimetype,
      media_filename: fileName,
      is_automated: false,
      is_sending: true,
    };

    // 🚀 1. Instant optimistic update in conversation
    setMessages(prev => [...prev, optimisticMsg]);
    if (textOverride === undefined) setNewMessage("");
    setShowQuickReplies(false);

    try {
      const response = await apiFetch(`/api/whatsapp/send`, {
        method: "POST",
        body: JSON.stringify({
          contactId: selectedContact.id,
          text: textToSend,
          mediaUrl,
          mediaType,
          duration,
          fileName,
          mimetype
        }),
      });

      if (response?.success !== true || !response.result?.key?.id) {
        throw new Error(response?.error || "Envio por confirmar. Verifica no WhatsApp antes de repetir.");
      }
      if (response.historySaved === false) {
        toast.warning("O WhatsApp aceitou a mensagem. A confirmação no histórico ainda está pendente.");
      }

      setContacts(prev => {
        const updated = prev.map(c => {
          if (c.id === selectedContact.id) {
            return {
              ...c,
              last_message_at: optimisticMsg.timestamp,
              last_message_text: optimisticMsg.text,
            };
          }
          return c;
        });
        const active = updated.find(c => c.id === selectedContact.id);
        const rest = updated.filter(c => c.id !== selectedContact.id);
        return active ? [active, ...rest] : updated;
      });

      // Mark optimistic message as sent or replace with backend saved message
      if (response.message) {
        setMessages((current) => current.some((message) => message.id === tempId)
          ? mergeMessage(current.filter((message) => message.id !== tempId), response.message)
          : current);
      } else {
        setMessages((current) => {
          const messageId = response.result?.key?.id;
          if (messageId && current.some((message) => message.msg_id === messageId && message.id !== tempId)) {
            return current.filter((message) => message.id !== tempId);
          }
          return current.map((message) => message.id === tempId
            ? { ...message, msg_id: messageId, is_sending: false }
            : message);
        });
      }
      return "sent";
    } catch (err: any) {
      console.error("Failed to send message:", err);
      // Remove failed optimistic message and restore input text
      setMessages(prev => prev.filter(m => m.id !== tempId));
      const definitivelyRejected = err instanceof ApiError && err.status !== undefined && err.status < 500;
      if (definitivelyRejected && currentChat.current === selectedContact.id &&
          !mediaUrl && textToSend && textOverride === undefined) {
        setNewMessage((draft) => draft || textToSend);
      }
      toast.error(definitivelyRejected ? err.message : "Envio por confirmar. Verifica no WhatsApp antes de repetir.");
      return definitivelyRejected ? "failed" : "unconfirmed";
    }
  };

  const handleQuickReply = (text: string) => {
    handleSend(undefined, undefined, undefined, text);
  };

  const getAiSuggestion = async () => {
    if (!selectedContact || messages.length === 0) return;
    setLoading(true);
    try {
      const lastMessage = messages[messages.length - 1];
      const response = await apiFetch("/api/ai/chat", {
        method: "POST",
        body: JSON.stringify({
          message: lastMessage.text,
          agentId: selectedAgentId
        }),
      });

      if (response.reply) {
        setNewMessage(response.reply);
        toast.info("Sugestão pronta para rever.");
      }
    } catch (err) {
      console.error("AI error:", err);
      toast.error(err instanceof Error ? err.message : "Não foi possível gerar uma sugestão.");
    } finally {
      setLoading(false);
    }
  };

  // CRM Panel Handlers
  const handleSaveContactName = async () => {
    if (!selectedContact || !contactNameInput.trim()) return;
    setSavingCrm(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ name: contactNameInput.trim() })
        .eq("id", selectedContact.id);

      if (error) throw error;

      setSelectedContact(prev => prev ? { ...prev, name: contactNameInput.trim() } : null);
      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, name: contactNameInput.trim() } : c));
      setIsEditingName(false);
      toast.success("Nome atualizado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar nome");
    } finally {
      setSavingCrm(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedContact) return;
    setSavingCrm(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ notes: contactNotes })
        .eq("id", selectedContact.id);

      if (error) throw error;
      setSelectedContact(prev => prev ? { ...prev, notes: contactNotes } : null);
      toast.success("Notas guardadas com sucesso!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao guardar notas");
    } finally {
      setSavingCrm(false);
    }
  };

  const handleAddTag = async () => {
    if (!selectedContact || !newTagInput.trim()) return;
    const cleanTag = newTagInput.trim();
    if (contactTags.includes(cleanTag)) {
      setNewTagInput("");
      return;
    }
    const updated = [...contactTags, cleanTag];
    setSavingCrm(true);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ tags: updated })
        .eq("id", selectedContact.id);

      if (error) throw error;
      setContactTags(updated);
      setSelectedContact(prev => prev ? { ...prev, tags: updated } : null);
      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, tags: updated } : c));
      setNewTagInput("");
      toast.success(`Etiqueta "${cleanTag}" adicionada!`);
    } catch (e: any) {
      toast.error(e.message || "Erro ao adicionar tag");
    } finally {
      setSavingCrm(false);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedContact) return;
    const updated = contactTags.filter(t => t !== tagToRemove);
    try {
      const { error } = await supabase
        .from("contacts")
        .update({ tags: updated })
        .eq("id", selectedContact.id);

      if (error) throw error;
      setContactTags(updated);
      setSelectedContact(prev => prev ? { ...prev, tags: updated } : null);
      setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, tags: updated } : c));
    } catch (e: any) {
      toast.error(e.message || "Erro ao remover tag");
    }
  };

  const handleUpdateLeadStage = async (newStage: LeadStage) => {
    if (!selectedContact || !userId) return;
    try {
      const { data } = await apiFetch("/api/leads", {
        method: "POST",
        body: JSON.stringify({ contactId: selectedContact.id, stage: newStage })
      });
      if (!data?.id) throw new Error("A API não confirmou a gravação da oportunidade.");
      setCurrentLead(data);
      toast.success("Estágio comercial atualizado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar estágio do lead");
    }
  };

  const handleUpdateLeadValue = async (val: number) => {
    if (!currentLead) return;
    try {
      const { data, error } = await supabase
        .from("leads")
        .update({ value: val, updated_at: new Date().toISOString() })
        .eq("id", currentLead.id)
        .select()
        .single();

      if (error) throw error;
      setCurrentLead(data);
      toast.success("Valor do negócio atualizado!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao atualizar valor");
    }
  };

  // Filter Contacts for left column (Direct 1-on-1 Messages only - groups belong strictly in /groups)
  const filteredContacts = contacts.filter((c) => {
    if (!isDirectConversation(c)) return false;

    const term = search.toLowerCase().trim();
    const matchesSearch = !term ||
      (c.name && c.name.toLowerCase().includes(term)) ||
      (c.phone && c.phone.includes(term)) ||
      (c.lid && c.lid.includes(term)) ||
      (c.last_message_text && c.last_message_text.toLowerCase().includes(term));

    if (!matchesSearch) return false;

    if (activeFilter === "unread") return (c.unread_count || 0) > 0;
    if (activeFilter === "ai") return !c.ai_paused;
    if (activeFilter === "human") return !!c.ai_paused;
    if (activeFilter === "leads") {
      const tags = Array.isArray(c.tags) ? c.tags : [];
      return tags.includes("Lead") || tags.includes("Cliente") || tags.includes("Oportunidade");
    }
    return true;
  });

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 gap-2 overflow-hidden sm:gap-4">
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* COLUNA 1 (ESQUERDA): LISTA DE CONVERSAS & FILTROS                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Card className={cn(
        "w-full lg:w-80 shrink-0 flex flex-col overflow-hidden transition-all duration-300 border-slate-100 shadow-sm bg-white h-full",
        showChatOnMobile ? "hidden lg:flex" : "flex"
      )}>
        {/* Search Header */}
        <div className="p-3 border-b border-slate-100 space-y-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
            <Input
              placeholder="Buscar conversa..."
              className="pl-9 h-9 text-xs rounded-xl bg-slate-50 border-slate-100 focus:bg-white transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 custom-scrollbar text-[11px]">
            <button
              onClick={() => setActiveFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap",
                activeFilter === "all" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              Todas ({contacts.filter(isDirectConversation).length})
            </button>
            <button
              onClick={() => setActiveFilter("unread")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap flex items-center gap-1",
                activeFilter === "unread" ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              Não lidas
              {contacts.filter(c => (c.unread_count || 0) > 0).length > 0 && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
            <button
              onClick={() => setActiveFilter("human")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap",
                activeFilter === "human" ? "bg-amber-500 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              Humano
            </button>
            <button
              onClick={() => setActiveFilter("ai")}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all whitespace-nowrap",
                activeFilter === "ai" ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              IA Ativa
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1 p-2 custom-scrollbar">
          {contactsError && <p className="p-2 text-sm text-amber-800" role="status">{contactsError}</p>}
          {filteredContacts.length > 0 ? (
            filteredContacts.map((contact) => {
              const isSelected = selectedContact?.id === contact.id;
              const hasUnread = (contact.unread_count || 0) > 0;
              const isHuman = !!contact.ai_paused;
              const display = getContactDisplay(contact);

              return (
                <button
                  key={contact.id}
                  onClick={() => handleSelectContact(contact)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-2xl transition-all duration-200 group text-left relative",
                    isSelected
                      ? "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-300 shadow-sm"
                      : "hover:bg-slate-50 text-slate-700"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "h-11 w-11 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 shadow-sm transition-all",
                    isSelected ? "bg-emerald-600 text-white" : getColorClass(display.title)
                  )}>
                    {display.initials ? (
                      display.initials
                    ) : (
                      <User size={18} className={isSelected ? "text-white" : "text-slate-500"} />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-bold text-xs truncate pr-1">
                        {display.title}
                      </span>
                      {contact.last_message_at && (
                        <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                          {new Date(contact.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    <div className="flex justify-between items-center gap-1">
                      <p className="text-[11px] text-slate-500 truncate line-clamp-1 flex-1">
                        {contact.last_message_text || (display.subtitle ? display.subtitle : "Toque para conversar...")}
                      </p>

                      <div className="flex items-center gap-1 shrink-0">
                        {/* Status Humano vs IA */}
                        {isHuman ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-amber-100 text-amber-800 uppercase tracking-wider" title="Atendimento Humano">
                            Humano
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-100 text-emerald-800 uppercase tracking-wider" title="IA Ativa">
                            IA
                          </span>
                        )}

                        {/* Unread Counter Badge */}
                        {hasUnread && (
                          <span className="min-w-[18px] h-[18px] px-1 bg-emerald-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow-sm animate-pulse">
                            {contact.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
              <div className="h-12 w-12 bg-slate-50 rounded-2xl flex items-center justify-center mb-3 text-slate-300">
                <MessageSquare size={24} />
              </div>
              <p className="text-slate-900 font-bold text-xs mb-1">Nenhuma conversa encontrada</p>
              <p className="text-slate-400 text-[11px]">
                {search ? "Tente outro termo de busca." : "As mensagens recebidas no WhatsApp aparecerão aqui."}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* COLUNA 2 (CENTRAL): CONVERSA SELECIONADA                           */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <Card className={cn(
        "flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden border-slate-100 shadow-sm bg-white relative",
        !showChatOnMobile ? "hidden lg:flex" : "flex"
      )}>
        {selectedContact ? (
          <>
            {/* Header com Modo Humano / IA */}
            <div className="p-2 sm:p-4 border-b border-slate-100 flex items-center justify-between bg-white z-10 shrink-0 gap-1.5 sm:gap-2">
              <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden -ml-1 h-8 w-8 rounded-xl shrink-0"
                  aria-label="Voltar às conversas"
                  onClick={() => { setShowCrmPanel(false); setShowChatOnMobile(false); }}
                >
                  <ChevronLeft size={18} />
                </Button>

                {(() => {
                  const activeDisplay = getContactDisplay(selectedContact);
                  return (
                    <>
                      <div className={cn(
                        "h-8 w-8 sm:h-10 sm:w-10 rounded-xl sm:rounded-2xl flex items-center justify-center text-xs sm:text-sm font-bold shrink-0 shadow-sm",
                        getColorClass(activeDisplay.title)
                      )}>
                        {activeDisplay.initials ? (
                          activeDisplay.initials
                        ) : (
                          <User size={18} className="text-slate-500" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1 sm:gap-2">
                          <p className="font-bold text-xs sm:text-sm truncate text-slate-900">
                            {activeDisplay.title}
                          </p>
                          {selectedContact.ai_paused ? (
                            <Badge variant="warning" className="text-[8px] sm:text-[9px] uppercase font-black tracking-widest px-1.5 sm:px-2 py-0.5 shrink-0">
                              <UserCheck size={10} className="mr-0.5 sm:mr-1 inline" />
                              <span className="hidden sm:inline">Humano</span>
                            </Badge>
                          ) : (
                            <Badge variant="success" className="text-[8px] sm:text-[9px] uppercase font-black tracking-widest px-1.5 sm:px-2 py-0.5 shrink-0">
                              <Bot size={10} className="mr-0.5 sm:mr-1 inline" />
                              <span className="hidden sm:inline">IA Ativa</span>
                            </Badge>
                          )}
                        </div>
                        {activeDisplay.subtitle && (
                          <p className="text-[10px] sm:text-xs text-slate-400 font-mono mt-0.5 truncate">
                            {activeDisplay.subtitle}
                          </p>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Ações no Header */}
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/* Botão [Assumir Conversa] / [Retomar IA] */}
                <Button
                  size="sm"
                  variant={selectedContact.ai_paused ? "outline" : "default"}
                  onClick={toggleAiMode}
                  className={cn(
                    "text-xs font-bold rounded-xl transition-all shadow-sm h-8 sm:h-9 px-2 sm:px-3",
                    selectedContact.ai_paused
                      ? "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      : "bg-amber-500 hover:bg-amber-600 text-white"
                  )}
                  title={selectedContact.ai_paused ? "Reativar resposta da IA nesta conversa" : "Pausar IA e falar manualmente"}
                >
                  {selectedContact.ai_paused ? (
                    <>
                      <Bot size={14} className="sm:mr-1.5" />
                      <span className="hidden sm:inline">Retomar IA</span>
                      <span className="sm:hidden text-[10px]">IA</span>
                    </>
                  ) : (
                    <>
                      <UserCheck size={14} className="sm:mr-1.5" />
                      <span className="hidden sm:inline">Assumir Conversa</span>
                      <span className="sm:hidden text-[10px]">Humano</span>
                    </>
                  )}
                </Button>

                {/* Sugestão de IA */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 sm:h-9 sm:w-9 text-amber-500 hover:text-amber-600 hover:bg-amber-50 rounded-xl shrink-0"
                  onClick={getAiSuggestion}
                  disabled={loading || messages.length === 0 || !isActivated}
                  title="Sugerir resposta profissional com IA"
                >
                  <Sparkles size={16} />
                </Button>

                {/* Toggle Painel CRM Direito */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowCrmPanel(!showCrmPanel)}
                  className={cn(
                    "h-8 w-8 sm:h-9 sm:w-9 rounded-xl transition-colors shrink-0",
                    showCrmPanel ? "bg-emerald-50 text-emerald-600" : "text-slate-400 hover:text-slate-600"
                  )}
                  title={showCrmPanel ? "Ocultar Painel CRM" : "Exibir Painel CRM"}
                >
                  <TrendingUp size={16} />
                </Button>
              </div>
            </div>

            {/* Mensagens Body */}
            <div
              ref={messagesContainerRef}
              role="log"
              aria-label="Histórico da conversa"
              onScroll={handleMessagesScroll}
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none] p-2 sm:p-6 space-y-4 bg-slate-50/40 relative custom-scrollbar"
            >
              {historyError && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800" role="status">{historyError}</p>}
              {hasOlderMessages && (
                <div className="flex flex-col items-center gap-1">
                  <Button type="button" variant="outline" size="sm" disabled={loadingOlder}
                    onClick={() => olderPageRequest.current?.()}>
                    {loadingOlder ? "A carregar mensagens…" : "Carregar mensagens anteriores"}
                  </Button>
                  {olderError && <p className="text-xs text-rose-700" role="status">Não foi possível carregar esta página. Tenta novamente.</p>}
                </div>
              )}
              {messages.length > 0 ? (
                messages.map((msg) => {
                  const isOut = msg.type === "outbound";
                  const isSticker = msg.media_type === "sticker";

                  if (isSticker && msg.media_url) {
                    return (
                      <div
                        key={msg.id}
                        data-chat-message={msg.id}
                        className={cn(
                          "flex flex-col max-w-[85%] sm:max-w-[70%]",
                          isOut ? "ml-auto items-end" : "mr-auto items-start"
                        )}
                      >
                        <div className="my-1 cursor-pointer hover:scale-105 transition-transform" onClick={() => setPreviewMedia({ url: msg.media_url!, type: "image", title: "sticker.webp" })}>
                          <img src={msg.media_url} alt="Sticker" className="w-32 h-32 max-w-full object-contain" />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5 px-1 font-mono">
                          {msg.is_automated && <span className="text-emerald-600 font-bold uppercase mr-1">[Auto]</span>}
                          <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {isOut && (
                            (msg as any).is_sending ? (
                              <Clock size={11} className="text-slate-400 animate-pulse ml-0.5" />
                            ) : (
                              <CheckCheck size={13} className="text-emerald-500 ml-0.5" />
                            )
                          )}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={msg.id}
                      data-chat-message={msg.id}
                      className={cn(
                        "flex flex-col max-w-[85%] sm:max-w-[70%]",
                        isOut ? "ml-auto items-end" : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-full break-words px-3 py-2.5 rounded-2xl text-sm shadow-sm leading-relaxed",
                          isOut
                            ? "bg-emerald-600 text-white rounded-tr-none"
                            : "bg-white text-slate-900 border border-slate-100 rounded-tl-none"
                        )}
                      >
                        {/* Rich Media Renderers */}
                        {msg.media_url && (
                          <div className="mb-2 rounded-xl overflow-hidden">
                            {msg.media_type === "image" ? (
                              <div
                                className="relative cursor-pointer group rounded-xl overflow-hidden max-w-[280px]"
                                onClick={() => setPreviewMedia({ url: msg.media_url!, type: "image", title: msg.media_filename || "foto.jpg" })}
                              >
                                <img src={msg.media_url} alt="Foto" className="max-h-64 w-auto object-cover rounded-xl group-hover:scale-102 transition-transform duration-200" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                  <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg backdrop-blur-xs transition-opacity">
                                    Ampliar
                                  </span>
                                </div>
                              </div>
                            ) : msg.media_type === "audio" ? (
                              <VoiceMessagePlayer src={msg.media_url} isOut={isOut} />
                            ) : msg.media_type === "video" ? (
                              <div className="max-w-[280px] bg-black/20 rounded-xl overflow-hidden">
                                <video controls src={msg.media_url} className="max-h-60 w-full rounded-xl bg-black" />
                              </div>
                            ) : msg.media_type === "document" ? (
                              <div className={cn(
                                "flex items-center gap-3 p-2.5 rounded-xl border transition-all max-w-[280px]",
                                isOut ? "bg-emerald-700/40 border-emerald-500/30 text-white" : "bg-slate-50 border-slate-200 text-slate-800"
                              )}>
                                <div className={cn("p-2 rounded-lg shrink-0", isOut ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700")}>
                                  <FileText size={18} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold truncate">{msg.media_filename || "Documento"}</p>
                                  <p className="text-[10px] opacity-75 uppercase font-mono">{msg.media_mimetype ? msg.media_mimetype.split("/")[1] : "Arquivo"}</p>
                                </div>
                                <a
                                  href={msg.media_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  download={msg.media_filename || "documento"}
                                  className={cn(
                                    "p-1.5 rounded-lg transition-transform active:scale-95 shrink-0",
                                    isOut ? "hover:bg-white/20 text-white" : "hover:bg-slate-200 text-slate-600"
                                  )}
                                  title="Baixar arquivo"
                                >
                                  <Download size={15} />
                                </a>
                              </div>
                            ) : (
                              <div className="p-2 flex items-center gap-2 text-xs font-medium">
                                <FileText size={16} /> Anexo recebido
                              </div>
                            )}
                          </div>
                        )}
                        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{msg.text}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1 px-1 font-mono">
                        {msg.is_automated && <span className="text-emerald-600 font-bold uppercase mr-1">[Auto]</span>}
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {isOut && (
                          (msg as any).is_sending ? (
                            <Clock size={11} className="text-slate-400 animate-pulse ml-0.5" />
                          ) : (
                            <CheckCheck size={13} className="text-emerald-500 ml-0.5" />
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              ) : historyLoading ? (
                <p className="p-3 text-center text-sm text-slate-500" role="status">A carregar conversa…</p>
              ) : !historyError && (
                <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
                  <MessageSquare size={32} className="mb-2 opacity-50 text-slate-300" />
                  <p className="text-xs font-semibold">Nenhuma mensagem registrada ainda.</p>
                  <p className="text-[11px] text-slate-400">Envie uma mensagem abaixo para iniciar.</p>
                </div>
              )}

              {/* Botão Flutuante de Scroll para o Fim */}
              {!isNearBottom && (
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className="sticky bottom-2 ml-auto z-20 bg-emerald-600 text-white rounded-full p-2.5 shadow-xl hover:bg-emerald-700 transition-all animate-in fade-in zoom-in-75 flex items-center justify-center"
                  title="Rolar para as mensagens mais recentes"
                >
                  <ChevronDown size={16} />
                </button>
              )}

              {/* Quick Replies Drawer */}
              {showQuickReplies && quickReplies.length > 0 && (
                <div className="absolute bottom-4 left-4 right-4 bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 z-20 animate-in slide-in-from-bottom-4">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Respostas Rápidas</h4>
                    <Button variant="ghost" size="icon" className="h-6 w-6 rounded-lg" onClick={() => setShowQuickReplies(false)}>
                      <X size={14} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {quickReplies.map(reply => (
                      <button
                        key={reply.id}
                        onClick={() => handleQuickReply(reply.response_text)}
                        className="text-left p-2.5 rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/50 transition-all text-xs group"
                      >
                        <span className="font-bold text-slate-800 group-hover:text-emerald-700 block truncate">
                          /{reply.shortcut}
                        </span>
                        <span className="text-slate-500 text-[11px] line-clamp-1 block">
                          {reply.response_text}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="p-2 sm:p-3 bg-white border-t border-slate-100 shrink-0">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelected}
                className="hidden"
                accept="image/*,video/*,audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.pdf,.doc,.docx,.xls,.xlsx,.txt"
              />
              {isRecording ? (
                <VoiceRecorder
                  key={contactId}
                  onSend={async (url, duration, media) => {
                    const outcome = await handleSend(undefined, url, "audio", "", duration, "nota-de-voz.ogg", media?.mimetype);
                    if (outcome === "sent" && currentChat.current === contactId) setIsRecording(false);
                    return outcome;
                  }}
                  onCancel={() => setIsRecording(false)}
                />
              ) : (
                <form onSubmit={handleSend} className="flex gap-1.5 sm:gap-2 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 sm:h-10 sm:w-10 shrink-0 rounded-xl transition-colors",
                      showQuickReplies ? "text-emerald-600 bg-emerald-50" : "text-slate-400 hover:text-emerald-600"
                    )}
                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                    disabled={!isActivated || quickReplies.length === 0}
                    title="Respostas Rápidas"
                  >
                    <List size={18} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 text-slate-400 hover:text-emerald-600 rounded-xl"
                    onClick={handleAttachmentClick}
                    disabled={!isActivated || isUploadingAttachment}
                    title="Anexar áudio, foto, vídeo ou documento"
                  >
                    <Paperclip size={18} />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 text-slate-400 hover:text-emerald-600 rounded-xl"
                    onClick={() => setIsRecording(true)}
                    disabled={!isActivated}
                    title="Gravar Áudio de Voz"
                  >
                    <Mic size={18} />
                  </Button>
                  <Input
                    placeholder={selectedContact.ai_paused ? "Modo Humano ativo..." : "Digite uma mensagem..."}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    className="min-w-0 flex-1 h-9 sm:h-10 text-base sm:text-sm rounded-xl border-slate-200 focus:ring-emerald-500/20"
                    disabled={loading || !isActivated}
                  />
                  <Button
                    type="submit"
                    aria-label="Enviar mensagem"
                    size="icon"
                    className="h-8 w-8 sm:h-10 sm:w-10 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md shadow-emerald-600/20"
                    disabled={loading || !newMessage.trim() || !isActivated}
                  >
                    <Send size={16} />
                  </Button>
                </form>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-4 p-8 text-center">
            <div className="h-16 w-16 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300">
              <MessageSquare size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-bold text-slate-800">Selecione uma conversa</p>
              <p className="text-xs text-slate-400 max-w-[240px]">
                Escolha um contato na lista à esquerda para visualizar as mensagens e o painel CRM.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PAINEL LATERAL DE CRM (DESKTOP: COLUNA 3; MOBILE/TABLET: DRAWER)    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {selectedContact && showCrmPanel && (
        <>
          {/* Desktop: Coluna 3 fixada (>= xl) */}
          <Card className="w-80 shrink-0 hidden xl:flex flex-col overflow-hidden border-slate-100 shadow-sm bg-white animate-in slide-in-from-right-4 duration-300 h-full">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <User size={16} className="text-emerald-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Perfil CRM</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:bg-slate-50 rounded-lg"
                onClick={() => setShowCrmPanel(false)}
              >
                <X size={14} />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar text-xs">
              {/* 1. DADOS DO CONTACTO */}
              <div className="space-y-3 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contacto</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                    onClick={() => setIsEditingName(!isEditingName)}
                  >
                    {isEditingName ? "Cancelar" : "Editar"}
                  </Button>
                </div>

                {isEditingName ? (
                  <div className="flex gap-1.5">
                    <Input
                      value={contactNameInput}
                      onChange={e => setContactNameInput(e.target.value)}
                      className="h-7 text-xs bg-white"
                    />
                    <Button size="sm" className="h-7 text-xs px-2 bg-emerald-600" onClick={handleSaveContactName} disabled={savingCrm}>
                      <Save size={12} />
                    </Button>
                  </div>
                ) : (
                  <p className="font-bold text-sm text-slate-900">{selectedContact.name || "Sem nome"}</p>
                )}

                <p className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                  <Phone size={12} className="text-slate-400" /> {selectedContact.phone}
                </p>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-[11px] font-bold h-8 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center gap-1.5"
                  onClick={() => navigate(`/contacts?phone=${selectedContact.phone}`)}
                >
                  <ExternalLink size={12} /> Ver no Módulo Contatos
                </Button>
              </div>

              {/* 2. OPORTUNIDADE / PIPELINE (LEAD) */}
              <div className="space-y-3 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <TrendingUp size={12} className="text-emerald-600" /> Lead / Oportunidade
                  </span>
                  {currentLead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                      onClick={() => navigate(`/leads?phone=${selectedContact.phone}`)}
                    >
                      Ver Pipeline
                    </Button>
                  )}
                </div>

                {/* Seletor de Fase do Funil */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Estágio da Venda</label>
                  <select
                    value={currentLead?.stage || 'novo'}
                    onChange={(e) => handleUpdateLeadStage(e.target.value as LeadStage)}
                    className="w-full h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  >
                    {LEAD_STAGES.map(stage => (
                      <option key={stage.id} value={stage.id}>
                        {stage.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Valor do Negócio */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor Estimado (MT)</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    className="h-8 text-xs bg-white font-mono"
                    defaultValue={currentLead?.value || 0}
                    onBlur={(e) => handleUpdateLeadValue(Number(e.target.value))}
                  />
                </div>

                {/* Intenção detectada pela IA */}
                {currentLead?.intent && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Intenção IA</span>
                    <div>
                      <Badge variant="info" className="text-[10px] font-bold uppercase px-2 py-0.5">
                        {currentLead.intent}
                      </Badge>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. ETIQUETAS (TAGS) */}
              <div className="space-y-2.5 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <Tag size={12} className="text-emerald-600" /> Etiquetas
                </span>

                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {contactTags.length > 0 ? (
                    contactTags.map(tag => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-bold group"
                      >
                        {tag}
                        <button
                          onClick={() => handleRemoveTag(tag)}
                          className="text-slate-400 hover:text-red-500 ml-0.5"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))
                  ) : (
                    <p className="text-[11px] text-slate-400 italic">Sem etiquetas</p>
                  )}
                </div>

                <div className="flex gap-1.5 pt-1">
                  <Input
                    placeholder="Nova tag..."
                    value={newTagInput}
                    onChange={e => setNewTagInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                    className="h-7 text-xs bg-white"
                  />
                  <Button size="sm" className="h-7 px-2.5 text-xs bg-slate-900 hover:bg-slate-800" onClick={handleAddTag} disabled={savingCrm}>
                    <Plus size={12} />
                  </Button>
                </div>
              </div>

              {/* 4. NOTAS INTERNAS */}
              <div className="space-y-2 bg-slate-50/50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <FileText size={12} className="text-emerald-600" /> Notas Internas
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                    onClick={handleSaveNotes}
                    disabled={savingCrm}
                  >
                    <Save size={11} className="mr-1" /> Salvar
                  </Button>
                </div>
                <textarea
                  value={contactNotes}
                  onChange={e => setContactNotes(e.target.value)}
                  placeholder="Ex: Cliente tem interesse no plano Pro. Ligar na sexta-feira..."
                  className="w-full h-24 p-2.5 bg-white border border-slate-200 rounded-xl text-xs resize-none outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800"
                />
              </div>
            </div>
          </Card>

          {/* Mobile e Tablet: Slide-Over Drawer (< xl) */}
          <div
            className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs xl:hidden animate-in fade-in duration-200"
            onClick={() => setShowCrmPanel(false)}
          >
            <div
              className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-300"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/60">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-emerald-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Perfil CRM do Contacto</h3>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-slate-400 hover:bg-slate-100 rounded-xl"
                  onClick={() => setShowCrmPanel(false)}
                >
                  <X size={16} />
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar text-xs">
                {/* 1. DADOS DO CONTACTO */}
                <div className="space-y-3 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contacto</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                      onClick={() => setIsEditingName(!isEditingName)}
                    >
                      {isEditingName ? "Cancelar" : "Editar"}
                    </Button>
                  </div>

                  {isEditingName ? (
                    <div className="flex gap-1.5">
                      <Input
                        value={contactNameInput}
                        onChange={e => setContactNameInput(e.target.value)}
                        className="h-8 text-xs bg-white"
                      />
                      <Button size="sm" className="h-8 text-xs px-2.5 bg-emerald-600" onClick={handleSaveContactName} disabled={savingCrm}>
                        <Save size={12} />
                      </Button>
                    </div>
                  ) : (
                    <p className="font-bold text-sm text-slate-900">{selectedContact.name || "Sem nome"}</p>
                  )}

                  <p className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                    <Phone size={12} className="text-slate-400" /> {selectedContact.phone}
                  </p>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-[11px] font-bold h-8 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-100 flex items-center justify-center gap-1.5"
                    onClick={() => {
                      setShowCrmPanel(false);
                      navigate(`/contacts?phone=${selectedContact.phone}`);
                    }}
                  >
                    <ExternalLink size={12} /> Ver no Módulo Contatos
                  </Button>
                </div>

                {/* 2. OPORTUNIDADE / PIPELINE (LEAD) */}
                <div className="space-y-3 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      <TrendingUp size={12} className="text-emerald-600" /> Lead / Oportunidade
                    </span>
                    {currentLead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                        onClick={() => {
                          setShowCrmPanel(false);
                          navigate(`/leads?phone=${selectedContact.phone}`);
                        }}
                      >
                        Ver Pipeline
                      </Button>
                    )}
                  </div>

                  {/* Seletor de Fase do Funil */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Estágio da Venda</label>
                    <select
                      value={currentLead?.stage || 'novo'}
                      onChange={(e) => handleUpdateLeadStage(e.target.value as LeadStage)}
                      className="w-full h-8 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      {LEAD_STAGES.map(stage => (
                        <option key={stage.id} value={stage.id}>
                          {stage.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Valor do Negócio */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor Estimado (MT)</label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      className="h-8 text-xs bg-white font-mono"
                      defaultValue={currentLead?.value || 0}
                      onBlur={(e) => handleUpdateLeadValue(Number(e.target.value))}
                    />
                  </div>

                  {/* Intenção detectada pela IA */}
                  {currentLead?.intent && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Intenção IA</span>
                      <div>
                        <Badge variant="info" className="text-[10px] font-bold uppercase px-2 py-0.5">
                          {currentLead.intent}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. ETIQUETAS (TAGS) */}
                <div className="space-y-2.5 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <Tag size={12} className="text-emerald-600" /> Etiquetas
                  </span>

                  <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                    {contactTags.length > 0 ? (
                      contactTags.map(tag => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-bold group"
                        >
                          {tag}
                          <button
                            onClick={() => handleRemoveTag(tag)}
                            className="text-slate-400 hover:text-red-500 ml-0.5"
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))
                    ) : (
                      <p className="text-[11px] text-slate-400 italic">Sem etiquetas</p>
                    )}
                  </div>

                  <div className="flex gap-1.5 pt-1">
                    <Input
                      placeholder="Nova tag..."
                      value={newTagInput}
                      onChange={e => setNewTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                      className="h-8 text-xs bg-white"
                    />
                    <Button size="sm" className="h-8 px-2.5 text-xs bg-slate-900 hover:bg-slate-800" onClick={handleAddTag} disabled={savingCrm}>
                      <Plus size={12} />
                    </Button>
                  </div>
                </div>

                {/* 4. NOTAS INTERNAS */}
                <div className="space-y-2 bg-slate-50/60 p-3.5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      <FileText size={12} className="text-emerald-600" /> Notas Internas
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] text-emerald-600 font-bold px-2 hover:bg-emerald-50 rounded-lg"
                      onClick={handleSaveNotes}
                      disabled={savingCrm}
                    >
                      <Save size={11} className="mr-1" /> Salvar
                    </Button>
                  </div>
                  <textarea
                    value={contactNotes}
                    onChange={e => setContactNotes(e.target.value)}
                    placeholder="Ex: Cliente tem interesse no plano Pro. Ligar na sexta-feira..."
                    className="w-full h-24 p-2.5 bg-white border border-slate-200 rounded-xl text-xs resize-none outline-none focus:ring-2 focus:ring-emerald-500/20 text-slate-800"
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Lightbox Modal para Mídia (Imagens e Vídeos) */}
      {previewMedia && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setPreviewMedia(null)}
        >
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10" onClick={(e) => e.stopPropagation()}>
            <a
              href={previewMedia.url}
              download={previewMedia.title || "whatsapp-media"}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Baixar arquivo"
            >
              <Download size={18} />
            </a>
            <button
              onClick={() => setPreviewMedia(null)}
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Fechar visualizador"
            >
              <X size={18} />
            </button>
          </div>
          <div className="max-w-4xl max-h-[85vh] overflow-hidden flex items-center justify-center rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {previewMedia.type === "image" ? (
              <img src={previewMedia.url} alt="Visualização" className="max-h-[85vh] max-w-full object-contain rounded-2xl" />
            ) : (
              <video controls autoPlay src={previewMedia.url} className="max-h-[85vh] max-w-full rounded-2xl bg-black" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
