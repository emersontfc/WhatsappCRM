import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Zap, LogIn, UserPlus, Mail, Lock, User, MessageCircle, Eye, EyeOff, Rocket, ArrowLeft, Sparkles } from "lucide-react";
import { supabase } from "../supabase";
import { Button } from "../components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/Card";
import { apiFetch } from "../lib/api";
import { motion, AnimatePresence } from "motion/react";

export default function Login() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Basic Validation
    if (!email || !password) {
      setError("Por favor, preencha todos os campos.");
      return;
    }
    if (isRegistering && !name) {
      setError("Por favor, informe seu nome.");
      return;
    }
    if (password.length < 6) {
      setError("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setLoading(true);
    try {
      if (isRegistering) {
        await apiFetch("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, name }),
        });

        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) throw signInError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          if (signInError.message === "Invalid login credentials") {
            throw new Error("E-mail ou senha incorretos.");
          }
          throw signInError;
        }
      }
      navigate("/dashboard");
    } catch (err: any) {
      console.error("Auth error:", err);
      setError(err.message || "Falha na autenticação. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row overflow-hidden">
      {/* Left Side - Visual/Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative bg-white items-center justify-center p-12 overflow-hidden border-r border-slate-200">
        <div className="absolute top-0 left-0 w-full h-full opacity-10">
          <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-emerald-500 blur-[120px] rounded-full"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-blue-500 blur-[120px] rounded-full"></div>
        </div>
        
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="relative z-10 space-y-8 max-w-lg"
        >
          <Link to="/" className="flex items-center gap-4 group mb-12">
            <div className="bg-emerald-500 p-3 rounded-2xl group-hover:rotate-12 transition-transform duration-300 shadow-lg shadow-emerald-500/20">
              <Rocket className="w-8 h-8 text-white" />
            </div>
            <span className="font-black text-4xl tracking-tighter uppercase italic text-slate-900">Agentex</span>
          </Link>
          
          <h2 className="text-6xl font-black uppercase italic tracking-tighter leading-none text-slate-900">
            Domine o <br />
            <span className="text-emerald-600 text-7xl">WhatsApp</span> <br />
            em Moçambique.
          </h2>
          
          <p className="text-xl text-slate-600 font-medium leading-relaxed">
            A plataforma definitiva para automação, CRM e Inteligência Artificial. Feito para empresas moçambicanas que não aceitam limites.
          </p>

          <div className="grid grid-cols-2 gap-6 pt-8">
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 backdrop-blur-sm">
              <Sparkles className="w-6 h-6 text-emerald-600 mb-3" />
              <p className="text-sm font-bold uppercase tracking-widest text-slate-400">IA Nativa</p>
            </div>
            <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 backdrop-blur-sm">
              <Zap className="w-6 h-6 text-blue-600 mb-3" />
              <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Ultra Rápido</p>
            </div>
          </div>
        </motion.div>

        {/* Decorative elements */}
        <div className="absolute bottom-10 left-10 text-[10px] uppercase tracking-[0.5em] text-slate-300 font-black italic">
          Agentex // Next-Gen CRM
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="flex-1 flex flex-col bg-slate-50 lg:bg-slate-50 relative">
        <div className="lg:hidden p-6">
          <Link to="/" className="flex items-center gap-3">
            <div className="bg-emerald-500 p-2 rounded-xl shadow-lg shadow-emerald-500/20">
              <Rocket className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-2xl tracking-tighter uppercase italic text-slate-900">Agentex</span>
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md space-y-8"
          >
            <div className="space-y-2">
              <h1 className="text-4xl font-black uppercase italic tracking-tighter text-slate-900">
                {isRegistering ? "Criar Conta" : "Bem-vindo de volta"}
              </h1>
              <p className="text-slate-500 font-medium">
                {isRegistering 
                  ? "Comece sua jornada de automação agora." 
                  : "Acesse sua conta para gerenciar seu negócio."}
              </p>
            </div>

            <AnimatePresence mode="wait">
              <motion.form 
                key={isRegistering ? "register" : "login"}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                onSubmit={handleAuth} 
                className="space-y-5"
              >
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-red-50 text-red-600 text-sm font-bold border border-red-100"
                  >
                    {error}
                  </motion.div>
                )}

                {isRegistering && (
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Nome Completo</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="text"
                        required
                        className="w-full bg-white border border-slate-200 rounded-2xl px-12 py-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                        placeholder="Seu Nome"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="email"
                      required
                      className="w-full bg-white border border-slate-200 rounded-2xl px-12 py-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
                      placeholder="seu@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-xs font-black uppercase tracking-widest text-slate-400">Senha</label>
                    {!isRegistering && (
                      <Link to="#" className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-500">Esqueceu?</Link>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      className="w-full bg-white border border-slate-200 rounded-2xl px-12 py-4 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium pr-12"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <Button 
                  type="submit"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white h-16 text-lg font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-500/20 mt-4" 
                  disabled={loading}
                >
                  <span className="flex items-center justify-center gap-3">
                    {loading ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                    ) : (
                      <>
                        {isRegistering ? <UserPlus size={20} /> : <LogIn size={20} />}
                        {isRegistering ? "CRIAR CONTA" : "ENTRAR AGORA"}
                      </>
                    )}
                  </span>
                </Button>
              </motion.form>
            </AnimatePresence>

            <div className="pt-4 text-center">
              <button 
                className="text-sm font-bold text-slate-500 hover:text-emerald-600 transition-colors uppercase tracking-widest"
                onClick={() => setIsRegistering(!isRegistering)}
              >
                {isRegistering 
                  ? "Já tem uma conta? Entre aqui" 
                  : "Não tem uma conta? Cadastre-se agora"}
              </button>
            </div>

            <div className="pt-8 flex items-center justify-center gap-6">
              <Link to="/" className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 hover:text-slate-600 flex items-center gap-2">
                <ArrowLeft size={12} /> Voltar para Home
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
