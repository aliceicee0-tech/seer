import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Estimate, Market, Outcome } from "../api/types";
import { useAuth } from "../store/auth";
import { Badge, ProbabilityBar, Spinner } from "../components/ui";
import { cx, dateFr, mga, timeLeft } from "../lib/format";
import { BookOpen, Globe, ShieldAlert, Calendar, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function MarketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [m, setM] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .market(Number(id))
      .then(setM)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (!m)
    return (
      <div className="py-12 text-center text-zinc-500">
        <p className="text-sm font-semibold">Marché introuvable.</p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1.5 text-xs text-white font-bold hover:underline">
          <ArrowLeft className="h-4 w-4" /> Retour aux marchés
        </Link>
      </div>
    );

  const open = m.status === "OPEN";

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-550 hover:text-zinc-900 transition">
        <ArrowLeft className="h-4.5 w-4.5" /> Marchés
      </Link>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left Column: Details & Rules */}
        <div className="flex-grow space-y-4 w-full md:w-2/3">
          <div className="card">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone="info">{m.category_label}</Badge>
              {open ? (
                <Badge tone="yes">Ouvert</Badge>
              ) : (
                <Badge tone="warn">{m.status}</Badge>
              )}
            </div>
            <h1 className="text-xl font-extrabold leading-snug text-zinc-900">{m.question}</h1>

            <div className="mt-5">
              <ProbabilityBar yes={m.proba_yes} no={m.proba_no} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Pool total" value={`${mga(m.pool_total)} MGA`} />
              <Stat label="Clôture des paris" value={timeLeft(m.bet_close_at)} sub={dateFr(m.bet_close_at)} />
              <Stat label="OUI" value={`${mga(m.pool_yes)} MGA`} tone="yes" />
              <Stat label="NON" value={`${mga(m.pool_no)} MGA`} tone="no" />
            </div>
          </div>

          {/* Règlement & source */}
          <div className="card space-y-4 text-sm">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                <BookOpen className="h-4 w-4 text-zinc-400" /> Règlement
              </h3>
              <p className="whitespace-pre-line text-xs text-zinc-600 leading-relaxed pl-6">{m.description}</p>
            </div>
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                <Globe className="h-4 w-4 text-zinc-400" /> Source officielle
              </h3>
              <div className="pl-6">
                <a
                  href={m.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-xs font-bold text-zinc-600 hover:text-blue-600 underline hover:no-underline"
                >
                  {m.source_url}
                </a>
              </div>
            </div>
            {m.source_rules && (
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                  <ShieldAlert className="h-4 w-4 text-zinc-400" /> En cas de litige
                </h3>
                <p className="whitespace-pre-line text-xs text-zinc-600 leading-relaxed pl-6">{m.source_rules}</p>
              </div>
            )}
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                <Calendar className="h-4 w-4 text-zinc-400" /> Vérification
              </h3>
              <p className="text-xs text-zinc-500 pl-6">{dateFr(m.resolve_at)}</p>
            </div>
          </div>
        </div>

        {/* Right Column: Betting Slip (Sticky on Desktop) */}
        <div className="w-full md:w-[360px] md:sticky md:top-20 shrink-0">
          {open && user ? (
            <BetPanel market={m} onChanged={() => window.location.reload()} />
          ) : open && !user ? (
            <div className="card text-center py-6 space-y-3">
              <p className="text-sm text-zinc-500">Connectez-vous pour parier sur ce marché.</p>
              <Link to="/login" className="btn bg-blue-600 hover:bg-blue-700 text-white font-bold inline-flex w-full">
                Se connecter
              </Link>
            </div>
          ) : (
            <div className="card text-center py-6 text-sm text-zinc-500 space-y-2">
              {m.status === "RESOLVED" ? (
                <>
                  <div className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-800 uppercase tracking-wider bg-zinc-50 border border-zinc-200 px-3 py-1 rounded-full">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Résultat officiel : {m.outcome === "YES" ? "OUI" : "NON"}
                  </div>
                  <p className="text-xs text-zinc-450 font-semibold uppercase tracking-wider mt-2">Résolu le {dateFr(m.resolved_at)}</p>
                </>
              ) : (
                <p className="font-semibold uppercase tracking-wider text-xs text-zinc-450">Ce marché n'est plus ouvert aux paris.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: "yes" | "no";
}) {
  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-150 p-4 space-y-1">
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-400">{label}</p>
      <p
        className={cx(
          "text-base font-black tracking-tight font-display",
          tone === "yes" ? "text-blue-600" : tone === "no" ? "text-rose-600" : "text-zinc-800"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wide mt-0.5">{sub}</p>}
    </div>
  );
}

function BetPanel({ market, onChanged }: { market: Market; onChanged: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [amount, setAmount] = useState("1000");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Estimation en direct (debounce léger)
  useEffect(() => {
    setError("");
    const t = setTimeout(() => {
      const a = parseFloat(amount);
      if (!Number.isNaN(a) && a > 0) {
        api
          .estimate(market.id, outcome, amount)
          .then(setEstimate)
          .catch(() => setEstimate(null));
      } else {
        setEstimate(null);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [outcome, amount, market.id]);

  async function place() {
    setError("");
    setPlacing(true);
    try {
      await api.placeBet(market.id, outcome, amount);
      setDone(true);
      setTimeout(onChanged, 900);
    } catch (e) {
      setError(humanize(e));
    } finally {
      setPlacing(false);
    }
  }

  if (done) {
    return (
      <div className="card text-center py-8 space-y-2.5 bg-white border border-zinc-200">
        <CheckCircle2 className="mx-auto h-9 w-9 text-blue-600 stroke-[1.5px]" />
        <p className="font-bold text-zinc-900 text-xs uppercase tracking-wider font-display">Pari placé avec succès</p>
        <p className="text-[11px] text-zinc-500 font-semibold">Votre mise est enregistrée. Bonne chance.</p>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Placer un pari</h2>

      {/* Choix OUI / NON */}
      <div className="grid grid-cols-2 gap-3">
        {(["YES", "NO"] as Outcome[]).map((o) => {
          const selected = outcome === o;
          return (
            <button
              key={o}
              onClick={() => setOutcome(o)}
              className={cx(
                "rounded-xl border p-4.5 text-center transition-all duration-300 active:scale-[0.96] flex flex-col items-center justify-center gap-1 font-display",
                selected
                  ? o === "YES"
                    ? "bg-blue-600 border-blue-600 text-white font-extrabold shadow-sm"
                    : "bg-rose-500 border-rose-500 text-white font-extrabold shadow-sm"
                  : o === "YES"
                    ? "bg-blue-50/50 border-blue-100/80 text-blue-600 hover:bg-blue-50/80"
                    : "bg-rose-50/50 border-rose-100/80 text-rose-600 hover:bg-rose-50/80"
              )}
            >
              <span className="text-xs tracking-widest font-black uppercase">{o === "YES" ? "OUI" : "NON"}</span>
              <span className={cx("text-[10px] font-bold tracking-wider mt-0.5", selected ? "text-white/85" : "text-zinc-500")}>
                {o === "YES"
                  ? `${Math.round(parseFloat(market.proba_yes) * 100)}%`
                  : `${Math.round(parseFloat(market.proba_no) * 100)}%`}
              </span>
            </button>
          );
        })}
      </div>

      {/* Montant */}
      <div className="space-y-2">
        <label className="label">Mise (MGA)</label>
        <input
          className="input"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <div className="flex gap-2">
          {[500, 1000, 5000].map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-zinc-650 hover:bg-zinc-100 hover:border-zinc-300 transition duration-300"
            >
              {mga(v)}
            </button>
          ))}
        </div>
      </div>

      {/* Estimation */}
      {estimate && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 space-y-1.5">
          <div className="flex justify-between">
            <span>Gain potentiel estimé</span>
            <span className="font-extrabold text-blue-600 font-display">
              {mga(estimate.estimated_payout)} MGA
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-zinc-450">
            <span>Bénéfice net (indicatif)</span>
            <span className="font-bold text-emerald-600 font-display">+{mga(estimate.estimated_net)} MGA</span>
          </div>
          <div className="flex justify-between text-[10px] text-zinc-450">
            <span>Commission plateforme</span>
            <span className="font-bold text-zinc-650 font-display">{estimate.commission_rate}%</span>
          </div>
          <p className="mt-1.5 text-[9px] text-zinc-500 leading-relaxed border-t border-zinc-200/60 pt-2 normal-case font-medium">
            Estimation indicative. Le gain réel dépend des mises jusqu'à la clôture. Une commission de {estimate.commission_rate}% est prélevée sur le pool lors de la résolution.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-xs font-semibold text-rose-600">
          {error}
        </div>
      )}

      <button onClick={place} className="btn-primary w-full" disabled={placing}>
        {placing ? "Placement…" : `Parier ${mga(amount || "0")} MGA sur ${outcome === "YES" ? "OUI" : "NON"}`}
      </button>
    </div>
  );
}

function humanize(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { detail?: string } | null;
    if (d?.detail) return d.detail;
    if (e.status === 400) return "Solde insuffisant ou mise invalide.";
  }
  return "Une erreur est survenue.";
}
