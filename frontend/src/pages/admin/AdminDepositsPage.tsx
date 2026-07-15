import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminDeposit } from "../../api/types";
import { DepositStatusBadge } from "../../components/admin";
import { EmptyState, Spinner } from "../../components/ui";
import { cx, dateFr, mga } from "../../lib/format";

type Filter = "PENDING" | "APPROVED" | "REJECTED" | "";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "PENDING", label: "En attente" },
  { key: "APPROVED", label: "Approuvés" },
  { key: "REJECTED", label: "Rejetés" },
  { key: "", label: "Tous" },
];

export default function AdminDepositsPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get("status") as Filter) ?? "PENDING";
  const [items, setItems] = useState<AdminDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.admin.deposits(filter || undefined).then((r) => setItems(r.results))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (f: Filter) => {
    if (f) params.set("status", f);
    else params.delete("status");
    setParams(params, { replace: true });
  };

  async function act(d: AdminDeposit, action: "approve" | "reject") {
    setBusyId(d.id);
    try {
      if (action === "approve") await api.admin.approveDeposit(d.id);
      else await api.admin.rejectDeposit(d.id);
      await load();
    } catch (e) {
      setError((e as Error).message ?? "Action échouée");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="mb-4">
        <h1 className="text-2xl font-black uppercase tracking-tight text-zinc-900">Dépôts</h1>
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1">
          Vérifiez le SMS opérateur, puis approuvez pour créditer le joueur
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-600 flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-black">✕</button>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 border border-zinc-200 p-1">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                "whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition border border-transparent",
                active
                  ? "bg-white text-zinc-900 border-zinc-200 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800"
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Aucun dépôt" hint="Rien à valider pour le moment." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((d) => (
            <div key={d.id} className="card space-y-4 flex flex-col justify-between hover:border-zinc-300">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 border-b border-zinc-150 pb-3">
                  <div>
                    <span className="font-mono font-bold text-[10px] tracking-wider text-zinc-800 bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded">{d.code}</span>
                    <p className="font-bold text-sm text-zinc-900 mt-2">{d.user_phone}</p>
                    <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{d.user_name || "—"}</p>
                  </div>
                  <p className="text-lg font-black text-zinc-900">
                    {mga(d.amount)} <span className="text-[10px] font-semibold text-zinc-500">MGA</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">
                  <span>Opérateur : <b className="text-zinc-800">{d.operator_label}</b></span>
                  <span>Expéditeur : <b className="text-zinc-800">{d.sender_phone || "—"}</b></span>
                  <span className="col-span-2">
                    Réf SMS : <b className="text-zinc-800">{d.operator_ref || "—"}</b>
                  </span>
                  <span className="col-span-2 text-[10px] text-zinc-400 mt-1">Demandé : {dateFr(d.created_at)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-zinc-150 pt-3 mt-1">
                <DepositStatusBadge status={d.status} label={d.status_label} />
                {d.status === "PENDING" && (
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === d.id}
                      onClick={() => act(d, "reject")}
                      className="btn bg-white hover:bg-rose-50 text-rose-600 border border-zinc-200 hover:border-rose-200 px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
                    >
                      Rejeter
                    </button>
                    <button
                      // Ceinture+bretelles : on ne peut pas approuver un dépôt
                      // non déclaré (pas de n° expéditeur = pas de transfert confirmé).
                      disabled={busyId === d.id || !d.sender_phone}
                      onClick={() => act(d, "approve")}
                      className="btn bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-40"
                      title={!d.sender_phone ? "Dépôt non déclaré par le joueur" : undefined}
                    >
                      Approuver
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
