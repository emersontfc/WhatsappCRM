import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useActivation } from "../lib/useActivation";
import { getUserId } from "../supabase";




// 🔥 IMPORTANTE: só alterei lógica de conexão e QR — resto mantido

// ... (imports iguais, NÃO MUDE)

export default function Dashboard() {
  const navigate = useNavigate();
  const { isActivated, plan, loading: activationLoading } = useActivation();

  const [status, setStatus] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // =========================
  // 🔥 CONNECT (NOVO)
  // =========================
  const connect = async () => {
    setLoading(true);
    setError(null);

    try {
      const userId = await getUserId();

      if (!userId) throw new Error("User não encontrado");

      console.log("🔌 Criando sessão:", userId);

      await fetch(`${import.meta.env.VITE_API_URL}/connect/${userId}`);

      setStatus("connecting");

    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // =========================
  // 🔥 CHECK STATUS (NOVO)
  // =========================
  const checkStatus = async (userId: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/qr/${userId}`);
      const data = await res.json();

      if (data.qr) {
        setQr(data.qr);
        setStatus("qr");
      } else {
        setStatus("connecting");
      }
    } catch {
      setStatus("connecting");
    }
  };

  // =========================
  // 🔄 POLLING
  // =========================
  useEffect(() => {
    if (activationLoading || !isActivated) return;

    const init = async () => {
      const uId = await getUserId();

      if (uId && uId !== "guest-user") {
        setUserId(uId);
        await checkStatus(uId);
      }
    };

    init();

    const interval = setInterval(async () => {
      const uId = await getUserId();

      if (uId && uId !== "guest-user") {
        await checkStatus(uId);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activationLoading, isActivated]);

  // =========================
  // 🎯 UI
  // =========================
  return (
    <div className="space-y-8">

      {/* 🔥 WHATSAPP CARD */}
      <div className="max-w-md mx-auto">

        {error && (
          <div className="text-red-500 text-sm">{error}</div>
        )}

        {status === "qr" && qr ? (
          <div className="text-center space-y-4">
            <img src={qr} className="mx-auto w-64" />
            <p>Escaneie com seu WhatsApp</p>
          </div>
        ) : (
          <div className="text-center space-y-4">
            <p>Gerando QR...</p>

            <button
              onClick={connect}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded"
            >
              {loading ? "Conectando..." : "Gerar QR Code"}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
