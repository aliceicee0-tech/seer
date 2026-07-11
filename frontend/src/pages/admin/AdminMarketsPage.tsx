import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Market } from "../../api/types";
import { MarketStatusBadge } from "../../components/admin";
import { ConfirmDialog } from "../../components/Modal";
import { EmptyState, Spinner } from "../../components/ui";
import { arPrice, cx, dateFr, mga } from "../../lib/format";
import MarketFormDialog, { type MarketFormResult } from "./MarketFormDialog";

type ConfirmState =
  | { kind: "resolve"; market: Market; outcome: "YES" | "NO" }
  | { kind: "cancel"; market: Market }
  | null;

export default function AdminMarketsPage() {
  const [items, setItems] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Market | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.admin.markets().then((r) => setItems(r.results)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(m: Market, outcome: "YES" | "NO") {
    setBusyId(m.id);
    try {
      await api.admin.resolveMarket(m.id, outcome);
      await load();
    } catch (e) {
      setError(humanize(e, "Résolution échouée"));
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(m: Market) {
    setBusyId(m.id);
    try {
      await api.admin.cancelMarket(m.id);
      await load();
    } catch (e) {
      setError(humanize(e, "Annulation échouée"));
    } finally {
      setBusyId(null);
    }
  }

  async function submitForm(data: MarketFormResult, id?: number) {
    try {
      if (id) await api.admin.updateMarket(id, data);
      else await api.admin.createMarket(data);
      setEditing(null);
      setCreating(false);
      await load();
    } catch (e) {
      setError(humanize(e, "Enregistrement échoué"));
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-zinc-900">Marchés</h1>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1">Créer, résoudre, annuler.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary px-4 py-2 text-xs font-bold">
          + Nouveau
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-600 flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-black">✕</button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Aucun marché" hint="Crée ton premier marché." />
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <div key={m.id} className="card space-y-3 hover:border-zinc-300">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-bold text-zinc-900 leading-snug">{m.question}</p>
                  <p className="mt-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                    Clôture : {dateFr(m.bet_close_at)}
                  </p>
                </div>
                <MarketStatusBadge status={m.status} />
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-500 border-t border-zinc-150 pt-2">
                <span>
                  Prix :{" "}
                  <b className="text-zinc-800 font-bold">
                    {m.last_price ? `${arPrice(m.last_price)} Ar` : "—"}
                  </b>
                  {" · "}
                  <span className="text-blue-600 font-bold">OUI {m.proba_yes}</span>
                  {" / "}
                  <span className="text-rose-600 font-bold">NON {m.proba_no}</span>
                </span>
              </div>

              {/* Actions contextuelles selon le statut */}
              <div className={cx("flex flex-wrap gap-2")}>
                <button
                  onClick={() => setEditing(m)}
                  className="btn-secondary px-3 py-2 text-xs"
                >
                  Éditer
                </button>
                {(m.status === "OPEN" || m.status === "LOCKED" || m.status === "RESOLVING") && (
                  <>
                    <button
                      disabled={busyId === m.id}
                      onClick={() => setConfirm({ kind: "resolve", market: m, outcome: "YES" })}
                      className="btn-success px-3 py-2 text-xs"
                    >
                      Résoudre OUI
                    </button>
                    <button
                      disabled={busyId === m.id}
                      onClick={() => setConfirm({ kind: "resolve", market: m, outcome: "NO" })}
                      className="btn-success px-3 py-2 text-xs"
                    >
                      Résoudre NON
                    </button>
                  </>
                )}
                {m.status !== "RESOLVED" && m.status !== "CANCELLED" && (
                  <button
                    disabled={busyId === m.id}
                    onClick={() => setConfirm({ kind: "cancel", market: m })}
                    className="btn-danger px-3 py-2 text-xs"
                  >
                    Annuler
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <MarketFormDialog
          market={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={submitForm}
        />
      )}

      <ConfirmDialog
        open={confirm?.kind === "resolve"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "resolve") resolve(confirm.market, confirm.outcome);
        }}
        title="Résoudre le marché"
        message={
          confirm?.kind === "resolve" ? (
            <>
              Résoudre « {confirm.market.question.slice(0, 50)}… » en{" "}
              <b>{confirm.outcome}</b> et payer les gagnants ?
            </>
          ) : null
        }
        confirmLabel={`Résoudre ${confirm?.kind === "resolve" ? confirm.outcome : ""}`}
      />

      <ConfirmDialog
        open={confirm?.kind === "cancel"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "cancel") cancel(confirm.market);
        }}
        title="Annuler le marché"
        message={
          confirm?.kind === "cancel" ? (
            <>Annuler « {confirm.market.question.slice(0, 50)}… » et rembourser toutes les mises ?</>
          ) : null
        }
        confirmLabel="Annuler le marché"
        danger
      />
    </div>
  );
}

function humanize(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}
