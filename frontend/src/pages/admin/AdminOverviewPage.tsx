import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminStats } from "../../api/types";
import { Spinner } from "../../components/ui";
import { mga } from "../../lib/format";
import { Gavel, Users, BookOpen, ArrowLeft } from "lucide-react";

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.admin.stats().then(setStats).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!stats) return null;

  return (
    <div className="space-y-5">
      <header className="mb-6">
        <h1 className="text-2xl font-black uppercase tracking-tight text-white">Tableau de bord</h1>
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1">Pilotage de la plateforme Nexus</p>
      </header>

      {/* Alertes de validation — l'action la plus fréquente de l'admin */}
      <section className="grid grid-cols-2 gap-3">
        <Link to="/admin/deposits?status=PENDING" className="card hover:border-zinc-700 hover:bg-zinc-900/50">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Dépôts à valider</p>
          <p className="mt-1.5 text-3xl font-black text-white">
            {stats.deposits_pending}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-400">
            {mga(stats.deposits_pending_amount)} MGA
          </p>
        </Link>
        <Link to="/admin/withdrawals?status=PENDING" className="card hover:border-zinc-700 hover:bg-zinc-900/50">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Retraits à payer</p>
          <p className="mt-1.5 text-3xl font-black text-white">
            {stats.withdrawals_pending}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-400">
            {mga(stats.withdrawals_pending_amount)} MGA
          </p>
        </Link>
      </section>

      {/* Compteurs généraux */}
      <section className="card space-y-4">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">État de la plateforme</p>
        <div className="grid grid-cols-2 gap-y-4 text-sm border-t border-zinc-900 pt-4">
          <Metric label="Joueurs" value={stats.users_total} />
          <Metric label="Marchés ouverts" value={stats.markets_open} />
          <Metric label="À résoudre" value={stats.markets_locked} tone="amber" />
          <Metric label="Résolus" value={stats.markets_resolved} tone="white" />
        </div>
      </section>

      {/* Trésorerie */}
      <section className="card space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-550">Trésorerie collectée (net)</p>
        <p className="text-3xl font-black tracking-tight text-white">
          {mga(stats.cash_collected_net)} <span className="text-xs font-semibold text-zinc-450">MGA</span>
        </p>
        <p className="text-[10px] text-zinc-500 font-medium leading-relaxed border-t border-zinc-900 pt-2 mt-2">
          Dépôts approuvés − retraits payés. Servira de fonds de roulement Mobile Money.
        </p>
      </section>

      {/* Accès rapides */}
      <section className="grid grid-cols-2 gap-3">
        <Link to="/admin/markets" className="btn-secondary justify-start gap-2.5 text-xs font-bold uppercase tracking-wider">
          <Gavel className="h-4 w-4 text-zinc-550" />
          <span>Gérer les marchés</span>
        </Link>
        <Link to="/admin/users" className="btn-secondary justify-start gap-2.5 text-xs font-bold uppercase tracking-wider">
          <Users className="h-4 w-4 text-zinc-550" />
          <span>Joueurs</span>
        </Link>
        <Link to="/admin/ledger" className="btn-secondary justify-start gap-2.5 text-xs font-bold uppercase tracking-wider">
          <BookOpen className="h-4 w-4 text-zinc-550" />
          <span>Comptabilité</span>
        </Link>
        <Link to="/" className="btn-secondary justify-start gap-2.5 text-xs font-bold uppercase tracking-wider">
          <ArrowLeft className="h-4 w-4 text-zinc-550" />
          <span>Vue joueur</span>
        </Link>
      </section>
    </div>
  );
}

const METRIC_TONE_CLASS: Record<"default" | "amber" | "white", string> = {
  default: "text-zinc-300 font-semibold",
  amber: "text-amber-400 font-extrabold",
  white: "text-white font-extrabold",
};

function Metric({
  label, value, tone = "default",
}: {
  label: string; value: number;
  tone?: "default" | "amber" | "white";
}) {
  const color = METRIC_TONE_CLASS[tone];
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-xl tracking-tight mt-1 ${color}`}>{value}</p>
    </div>
  );
}
