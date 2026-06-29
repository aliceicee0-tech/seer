import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Market } from "../../api/types";
import { MarketStatusBadge } from "../../components/admin";
import { EmptyState, Spinner } from "../../components/ui";
import { cx, dateFr, mga } from "../../lib/format";
import MarketFormDialog, { type MarketFormResult } from "./MarketFormDialog";

export default function AdminMarketsPage() {
  const [items, setItems] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Market | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.admin.markets().then((r) => setItems(r.results)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(m: Market, outcome: "YES" | "NO") {
    if (!confirm(`Résoudre « ${m.question.slice(0, 50)}… » en ${outcome} et payer les gagnants ?`))
      return;
    setBusyId(m.id);
    try {
      await api.admin.resolveMarket(m.id, outcome);
      await load();
    } catch (e) {
      alert((e as Error).message ?? "Résolution échouée");
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(m: Market) {
    if (!confirm(`Annuler « ${m.question.slice(0, 50)}… » et rembourser toutes les mises ?`))
      return;
    setBusyId(m.id);
    try {
      await api.admin.cancelMarket(m.id);
      await load();
    } catch (e) {
      alert((e as Error).message ?? "Annulation échouée");
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
      alert((e as Error).message ?? "Enregistrement échoué");
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight text-white">Marchés</h1>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1">Créer, résoudre, annuler.</p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-primary px-4 py-2 text-xs font-bold">
          + Nouveau
        </button>
      </header>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Aucun marché" hint="Crée ton premier marché." />
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <div key={m.id} className="card space-y-3 hover:border-zinc-800">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-bold text-zinc-150 leading-snug">{m.question}</p>
                  <p className="mt-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                    Clôture : {dateFr(m.bet_close_at)}
                  </p>
                </div>
                <MarketStatusBadge status={m.status} />
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-550 border-t border-zinc-950 pt-2">
                <span>
                  Prix :{" "}
                  <b className="text-zinc-200 font-bold">
                    {m.last_price ? `${Math.round(parseFloat(m.last_price) * 100)}¢` : "—"}
                  </b>
                  {" · "}
                  <span className="text-zinc-400">OUI {m.proba_yes}</span>
                  {" / "}
                  <span className="text-zinc-500">NON {m.proba_no}</span>
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
                      onClick={() => resolve(m, "YES")}
                      className="btn-success px-3 py-2 text-xs"
                    >
                      Résoudre OUI
                    </button>
                    <button
                      disabled={busyId === m.id}
                      onClick={() => resolve(m, "NO")}
                      className="btn-success px-3 py-2 text-xs"
                    >
                      Résoudre NON
                    </button>
                  </>
                )}
                {m.status !== "RESOLVED" && m.status !== "CANCELLED" && (
                  <button
                    disabled={busyId === m.id}
                    onClick={() => cancel(m)}
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
    </div>
  );
}
