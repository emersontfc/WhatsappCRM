import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "./ui/Button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let errorDetails = this.state.error?.message || "Ocorreu um erro inesperado.";
      
      // Check if it's a JSON error from our Firestore handler
      try {
        const parsed = JSON.parse(errorDetails);
        if (parsed.error) {
          errorDetails = `Erro no Banco de Dados: ${parsed.error} (Operação: ${parsed.operationType})`;
        }
      } catch (e) {
        // Not JSON, use as is
      }

      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center space-y-6 bg-white rounded-3xl border border-red-100 shadow-sm">
          <div className="h-16 w-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center">
            <AlertTriangle size={32} />
          </div>
          <div className="space-y-2 max-w-md">
            <h2 className="text-xl font-bold text-slate-900">Ops! Algo deu errado</h2>
            <p className="text-slate-500 text-sm">
              {errorDetails}
            </p>
          </div>
          <Button 
            onClick={() => window.location.reload()} 
            variant="outline"
            className="gap-2"
          >
            <RefreshCcw size={18} />
            Recarregar Página
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
