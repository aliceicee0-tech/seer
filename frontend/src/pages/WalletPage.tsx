import { Link } from "react-router-dom";
import { useAuth } from "../store/auth";
import { mga } from "../lib/format";
import { Lock, ArrowDown, ArrowUp, Ticket, History, ChevronRight } from "lucide-react";

export default function WalletPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="relative rounded-2xl bg-gradient-to-b from-white to-zinc-50/50 p-8 text-zinc-900 border border-zinc-200 shadow-sm overflow-hidden">
        {/* Subtle top left glow */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

        <p className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-450 font-display">Solde disponible</p>
        <p className="text-4xl font-black tracking-tight font-display mt-2 text-zinc-900">
          {mga(user.available_balance)}
          <span className="ml-2 text-xs font-bold text-zinc-450 tracking-wider">MGA</span>
        </p>
        {parseFloat(user.locked_balance) > 0 && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">
            <Lock className="h-3.5 w-3.5 text-zinc-400" />
            <span>{mga(user.locked_balance)} MGA bloqués (retraits en cours)</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Link to="/wallet/deposit" className="btn-primary w-full flex items-center justify-center gap-2">
          <ArrowDown className="h-4 w-4 stroke-[2.5px]" /> Déposer
        </Link>
        <Link to="/wallet/withdraw" className="btn-secondary w-full flex items-center justify-center gap-2">
          <ArrowUp className="h-4 w-4 stroke-[2px]" /> Retirer
        </Link>
      </div>

      <div className="space-y-2">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-zinc-450">Suivi</h2>
        <Link
          to="/bets"
          className="card flex items-center justify-between hover:border-zinc-300 hover:bg-zinc-50/50"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-850">
            <Ticket className="h-4 w-4 text-zinc-400" />
            Mes paris
          </span>
          <ChevronRight className="h-4 w-4 text-zinc-400" />
        </Link>
        <Link
          to="/history"
          className="card flex items-center justify-between hover:border-zinc-300 hover:bg-zinc-50/50"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-850">
            <History className="h-4 w-4 text-zinc-400" />
            Historique des transactions
          </span>
          <ChevronRight className="h-4 w-4 text-zinc-400" />
        </Link>
      </div>

      <div className="card text-xs text-zinc-500 space-y-1.5 border-zinc-200 bg-zinc-50/50">
        <p className="font-bold text-zinc-700 uppercase tracking-wider text-[10px]">À savoir</p>
        <p className="leading-relaxed text-[11px] text-zinc-500">
          1 point = 1 MGA (Ariary). Les dépôts et retraits sont traités
          manuellement via MVola, Orange Money ou Airtel Money. Comptez quelques
          heures pour la validation.
        </p>
      </div>
    </div>
  );
}
