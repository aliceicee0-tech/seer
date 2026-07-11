import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Market, MarketPool, Outcome } from "../api/types";
import { Badge, Spinner } from "../components/ui";
import { cx, dateFr, mga } from "../lib/format";
import { ArrowLeft, Clock, TrendingUp } from "lucide-react";
import { useAuth } from "../store/auth";

export default function MarketDetailPage() {
  const { id } = useParams();
  const [m, setM] = useState<Market | null>(null);
  const [pool, setPool] = useState<MarketPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.market(Number(id)),
      api.marketPool(Number(id)).catch(() => null),
    ])
      .then(([market, p]) => {
        setM(market);
        setPool(p);
      })
      .finally(() => setLoading(false));
  }, [id, refreshKey]);

  if (loading) return <Spinner />;
  if (!m)
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-zinc-500">Marché introuvable.</p>
        <Link to="/" className="btn-secondary mt-4 inline-block">← Retour</Link>
      </div>
    );

  const open = m.status === "OPEN";
  const onChanged = () => setRefreshKey((k) => k + 1);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 transition">
        <ArrowLeft className="h-4 w-4" /> Marchés
      </Link>

      {/* En-tête marché */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Badge tone="info">{m.category_label}</Badge>
          {m.is_featured && <Badge tone="info">À la une</Badge>}
          {!open && <Badge tone="warn">{statusLabel(m.status)}</Badge>}
        </div>
        <h1 className="text-2xl font-black leading-tight text-zinc-900 font-display tracking-tight">
          {m.question}
        </h1>
        {m.description && (
          <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{m.description}</p>
        )}
      </div>

      {/* Pools + cotes */}
      {pool && <PoolDisplay pool={pool} outcome={m.outcome} />}

      {/* Dates */}
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-500 border-t border-zinc-200 pt-3">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {open ? `Clôture : ${dateFr(m.bet_close_at)}` : `Résolu : ${dateFr(m.resolved_at ?? m.resolve_at)}`}
        </span>
      </div>

      {/* Panel de pari */}
      {open ? (
        <BetPanel market={m} pool={pool} onChanged={onChanged} />
      ) : (
        <ResultBanner market={m} />
      )}

      {/* Source / règles de résolution */}
      {m.source_url && (
        <div className="card space-y-1.5 text-xs">
          <p className="font-bold uppercase tracking-wider text-zinc-400">Source de résolution</p>
          <a href={m.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
            {m.source_url}
          </a>
          {m.source_rules && <p className="text-zinc-500 leading-relaxed pt-1">{m.source_rules}</p>}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Pools + cotes
// --------------------------------------------------------------------------
function PoolDisplay({ pool, outcome }: { pool: MarketPool; outcome?: Outcome }) {
  const total = Number(pool.total);
  const py = Number(pool.pool_yes);
  const pn = Number(pool.pool_no);
  const pctYes = total > 0 ? Math.round((py / total) * 100) : 50;
  const pctNo = total > 0 ? 100 - pctYes : 50;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-black uppercase tracking-wider text-zinc-400">Cotes en direct</h3>
        <TrendingUp className="h-4 w-4 text-zinc-400" />
      </div>

      {/* Barre de répartition */}
      <div className="flex h-8 overflow-hidden rounded-lg">
        <div className="flex items-center justify-center bg-blue-500 text-white text-xs font-black" style={{ width: `${pctYes}%` }}>
          {pctYes > 12 && `OUI ${pctYes}%`}
        </div>
        <div className="flex items-center justify-center bg-rose-500 text-white text-xs font-black" style={{ width: `${pctNo}%` }}>
          {pctNo > 12 && `NON ${pctNo}%`}
        </div>
      </div>

      {/* Détail des pools + cotes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-blue-400">OUI</p>
          <p className="font-display text-lg font-black text-blue-600">
            {pool.odds_yes ? pool.odds_yes.toFixed(2) : "—"}
          </p>
          <p className="text-[10px] text-zinc-500 font-semibold">{mga(pool.pool_yes)} Ar misés</p>
        </div>
        <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-rose-400">NON</p>
          <p className="font-display text-lg font-black text-rose-600">
            {pool.odds_no ? pool.odds_no.toFixed(2) : "—"}
          </p>
          <p className="text-[10px] text-zinc-500 font-semibold">{mga(pool.pool_no)} Ar misés</p>
        </div>
      </div>
      <p className="text-[10px] text-zinc-400 font-medium">
        Pot total : <b className="text-zinc-600">{mga(pool.total)} Ar</b>. Cote = gain potentiel pour 1 Ar misé.
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
// BetPanel — pari mutuel simplifié
// --------------------------------------------------------------------------
function BetPanel({
  market, pool, onChanged,
}: {
  market: Market; pool: MarketPool | null; onChanged: () => void;
}) {
  const { user } = useAuth();
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [amount, setAmount] = useState("1000");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function submit() {
    setError("");
    const amt = parseInt(amount.replace(/[^0-9]/g, ""), 10);
    if (!amt || amt < 500) {
      setError("Mise minimum : 500 Ar.");
      return;
    }
    setSubmitting(true);
    try {
      await api.placeBet(market.id, outcome, amt);
      setDone(`Pari placé : ${amt} Ar sur ${outcome === "YES" ? "OUI" : "NON"}.`);
      setTimeout(onChanged, 1200);
    } catch (e) {
      setError(humanize(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (done)
    return (
      <div className="card text-center space-y-2">
        <p className="text-lg">✅</p>
        <p className="text-sm font-bold text-emerald-600">{done}</p>
      </div>
    );

  const amt = parseInt(amount.replace(/[^0-9]/g, ""), 10) || 0;
  const total = Number(pool?.total ?? "0");
  const poolSide = outcome === "YES" ? Number(pool?.pool_yes ?? "0") : Number(pool?.pool_no ?? "0");
  const odds = poolSide > 0 ? total / poolSide : null;
  // Gain potentiel = (mise / pool_côté_après) × pot_net(90%).
  // Approximation simple : mise × cote × 0.9 (si pool_side > 0).
  const potentialWin = odds && poolSide > 0
    ? Math.round(amt * odds * 0.9)
    : null;
  const balance = user ? Number(user.available_balance) : 0;

  return (
    <div className="card space-y-4">
      <h3 className="text-xs font-black uppercase tracking-wider text-zinc-400">Parier</h3>

      {/* Choix OUI / NON */}
      <div className="grid grid-cols-2 gap-2">
        {(["YES", "NO"] as Outcome[]).map((o) => {
          const selected = outcome === o;
          const oPool = o === "YES" ? Number(pool?.pool_yes ?? "0") : Number(pool?.pool_no ?? "0");
          const oOdds = oPool > 0 && total > 0 ? (total / oPool).toFixed(2) : "—";
          return (
            <button
              key={o}
              onClick={() => setOutcome(o)}
              className={cx(
                "rounded-xl border p-4 text-center transition-all duration-200 active:scale-[0.97]",
                selected
                  ? o === "YES"
                    ? "border-blue-500 bg-blue-50 shadow-md"
                    : "border-rose-500 bg-rose-50 shadow-md"
                  : "border-zinc-200 bg-white hover:bg-zinc-50"
              )}
            >
              <p className={cx(
                "text-sm font-black uppercase tracking-wider",
                selected ? (o === "YES" ? "text-blue-600" : "text-rose-600") : "text-zinc-500"
              )}>
                {o === "YES" ? "OUI" : "NON"}
              </p>
              <p className="text-[10px] font-semibold text-zinc-400 mt-0.5">Cote {oOdds}</p>
            </button>
          );
        })}
      </div>

      {/* Montant */}
      <div>
        <label className="label">Votre mise (MGA)</label>
        <input
          className="input text-lg font-display font-black"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
        />
        {/* Raccourcis */}
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {["500", "1000", "5000", "10000"].map((q) => (
            <button
              key={q}
              onClick={() => setAmount(q)}
              className="rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 text-[10px] font-bold text-zinc-600 hover:bg-zinc-100 transition"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Récap gain potentiel */}
      {potentialWin !== null && amt >= 500 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">
              Si {outcome === "YES" ? "OUI" : "NON"} gagne
            </span>
            <span className="font-display text-lg font-black text-emerald-600">
              +{mga(String(potentialWin))} Ar
            </span>
          </div>
          <div className="flex justify-between text-[10px] font-semibold text-zinc-500">
            <span>Profit net potentiel</span>
            <span className="font-bold text-emerald-600">
              +{mga(String(potentialWin - amt))} Ar
            </span>
          </div>
        </div>
      )}

      {/* Solde insuffisant ? */}
      {amt > balance && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] font-semibold text-amber-700">
          Solde insuffisant ({mga(String(balance))} Ar).{" "}
          <Link to="/wallet/deposit" className="underline font-bold">Déposer →</Link>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-xs font-semibold text-rose-600">
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting || amt < 500 || amt > balance}
        className={cx(
          "btn w-full text-white",
          outcome === "YES" ? "bg-blue-600 hover:bg-blue-700" : "bg-rose-500 hover:bg-rose-600",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
      >
        {submitting
          ? "Traitement…"
          : `Parier ${amt >= 500 ? mga(String(amt)) : ""} Ar sur ${outcome === "YES" ? "OUI" : "NON"}`}
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Résultat (marché résolu)
// --------------------------------------------------------------------------
function ResultBanner({ market }: { market: Market }) {
  if (market.status === "CANCELLED") {
    return (
      <div className="card text-center">
        <p className="text-sm font-bold text-zinc-500">Marché annulé — tous les paris ont été remboursés.</p>
      </div>
    );
  }
  const won = market.outcome;
  return (
    <div className={cx("card text-center space-y-1", won === "YES" ? "bg-blue-50" : "bg-rose-50")}>
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Résultat</p>
      <p className={cx("text-2xl font-black font-display", won === "YES" ? "text-blue-600" : "text-rose-600")}>
        {won === "YES" ? "OUI" : "NON"}
      </p>
    </div>
  );
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    LOCKED: "Clôturé", RESOLVING: "En résolution",
    RESOLVED: "Résolu", CANCELLED: "Annulé", DRAFT: "Brouillon",
    FROZEN: "Gelé",
  };
  return map[s] ?? s;
}

function humanize(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Une erreur est survenue.";
}
