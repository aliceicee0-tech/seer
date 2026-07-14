import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminStats, CommissionConfig } from "../../api/types";
import { Spinner } from "../../components/ui";
import { mga } from "../../lib/format";
import { Gavel, Users, BookOpen, ArrowLeft, Percent } from "lucide-react";

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [commission, setCommission] = useState<CommissionConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.admin.stats(),
      api.admin.commission().catch(() => null), // non bloquant si route absente
    ]).then(([s, c]) => {
      setStats(s);
      setCommission(c);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!stats) return null;

  return (
    <div className="space-y-5">
      <header className="mb-6">
        <h1 className="text-2xl font-black uppercase tracking-tight text-zinc-900">Tableau de bord</h1>
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1">Pilotage de la plateforme Nexus</p>
      </header>

      {/* Alertes de validation — l'action la plus fréquente de l'admin */}
      <section className="grid grid-cols-2 gap-3">
        <Link to="/admin/deposits?status=PENDING" className="card hover:border-zinc-300 hover:bg-zinc-50">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-550">Dépôts à valider</p>
          <p className="mt-1.5 text-3xl font-black text-zinc-900">
            {stats.deposits_pending}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500">
            {mga(stats.deposits_pending_amount)} MGA
          </p>
        </Link>
        <Link to="/admin/withdrawals?status=PENDING" className="card hover:border-zinc-300 hover:bg-zinc-50">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-550">Retraits à payer</p>
          <p className="mt-1.5 text-3xl font-black text-zinc-900">
            {stats.withdrawals_pending}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-500">
            {mga(stats.withdrawals_pending_amount)} MGA
          </p>
        </Link>
      </section>

      {/* Compteurs généraux */}
      <section className="card space-y-4">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">État de la plateforme</p>
        <div className="grid grid-cols-2 gap-y-4 text-sm border-t border-zinc-200 pt-4">
          <Metric label="Joueurs" value={stats.users_total} />
          <Metric label="Marchés ouverts" value={stats.markets_open} />
          <Metric label="À résoudre" value={stats.markets_locked} tone="amber" />
          <Metric label="Résolus" value={stats.markets_resolved} tone="dark" />
        </div>
      </section>

      {/* Trésorerie */}
      <section className="card space-y-1.5">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-550">Trésorerie collectée (net)</p>
        <p className="text-3xl font-black tracking-tight text-zinc-900">
          {mga(stats.cash_collected_net)} <span className="text-xs font-semibold text-zinc-500">MGA</span>
        </p>
        <p className="text-[10px] text-zinc-500 font-medium leading-relaxed border-t border-zinc-200 pt-2 mt-2">
          Dépôts approuvés − retraits payés. Servira de fonds de roulement Mobile Money.
        </p>
      </section>

      {/* Commission plateforme */}
      <CommissionCard config={commission} onChanged={setCommission} />

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

const METRIC_TONE_CLASS: Record<"default" | "amber" | "dark", string> = {
  default: "text-zinc-700 font-semibold",
  amber: "text-amber-500 font-extrabold",
  dark: "text-zinc-900 font-extrabold",
};

function Metric({
  label, value, tone = "default",
}: {
  label: string; value: number;
  tone?: "default" | "amber" | "dark";
}) {
  const color = METRIC_TONE_CLASS[tone];
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-xl tracking-tight mt-1 ${color}`}>{value}</p>
    </div>
  );
}

// --------------------------------------------------------------------------
// CommissionCard — affiche et permet de configurer la commission plateforme.
// Alerte si aucun wallet dédié n'est configuré (fallback admin résolveur).
// --------------------------------------------------------------------------
function CommissionCard({
  config, onChanged,
}: {
  config: CommissionConfig | null;
  onChanged: (c: CommissionConfig | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (config) setRate(String(config.commission_rate));
  }, [config]);

  if (!config) return null; // route indisponible (ancien backend)

  const noRecipient = !config.has_recipient;

  async function save() {
    setError("");
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0 || r > 100) {
      setError("Le taux doit être entre 0 et 100.");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.admin.updateCommission({ rate: r });
      onChanged(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la mise à jour.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-550">
          <Percent className="h-3.5 w-3.5" /> Commission plateforme
        </p>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-[10px] font-bold uppercase tracking-wider text-blue-600 hover:underline">
            Modifier
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="label">Taux (%)</label>
          <input
            className="input"
            inputMode="numeric"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))}
          />
          {error && <p className="text-[10px] font-semibold text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn bg-zinc-900 text-white text-xs disabled:opacity-50">
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button onClick={() => { setEditing(false); setError(""); }} className="btn-secondary text-xs">
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-3xl font-black tracking-tight text-zinc-900">
            {config.commission_rate}<span className="text-sm font-semibold text-zinc-500">%</span>
          </p>
          {noRecipient ? (
            <p className="text-[10px] font-semibold text-amber-700 leading-relaxed border-t border-amber-200 pt-2">
              ⚠️ Aucun wallet dédié configuré. La commission tombe sur l'admin qui
              résout le marché (toi). Pour un wallet séparé, configurez
              <code className="mx-1 px-1 py-0.5 rounded bg-amber-50 border border-amber-200">platform_user_id</code>
              en base.
            </p>
          ) : (
            <p className="text-[10px] text-emerald-600 font-semibold leading-relaxed border-t border-emerald-200 pt-2">
              ✓ Wallet dédié configuré : la commission y est créditée à chaque résolution.
            </p>
          )}
        </>
      )}
    </section>
  );
}
