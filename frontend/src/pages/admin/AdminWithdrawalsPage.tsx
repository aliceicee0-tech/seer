import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { AdminWithdraw } from "../../api/types";
import { WithdrawStatusBadge } from "../../components/admin";
import { ConfirmDialog, PromptDialog } from "../../components/Modal";
import { EmptyState, Spinner } from "../../components/ui";
import { cx, dateFr, mga } from "../../lib/format";

type Filter = "PENDING" | "PAID" | "REJECTED" | "";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "PENDING", label: "À payer" },
  { key: "PAID", label: "Payés" },
  { key: "REJECTED", label: "Rejetés" },
  { key: "", label: "Tous" },
];

type DialogState =
  | { kind: "pay"; withdraw: AdminWithdraw }
  | { kind: "reject"; withdraw: AdminWithdraw }
  | null;

export default function AdminWithdrawalsPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get("status") as Filter) ?? "PENDING";
  const [items, setItems] = useState<AdminWithdraw[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.admin.withdrawals(filter || undefined).then((r) => setItems(r.results))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (f: Filter) => {
    if (f) params.set("status", f);
    else params.delete("status");
    setParams(params, { replace: true });
  };

  async function pay(w: AdminWithdraw, ref: string) {
    setBusyId(w.id);
    try {
      await api.admin.payWithdraw(w.id, ref);
      await load();
    } catch (e) {
      setError((e as Error).message ?? "Paiement échoué");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(w: AdminWithdraw) {
    setBusyId(w.id);
    try {
      await api.admin.rejectWithdraw(w.id);
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
        <h1 className="text-2xl font-black uppercase tracking-tight text-white">Retraits</h1>
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500 mt-1">
          Transférez l'argent depuis votre téléphone, puis marquez comme payé
        </p>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-xs font-semibold text-rose-300 flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 font-black">✕</button>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-zinc-950 border border-zinc-900 p-1">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                "whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold uppercase tracking-wider transition border border-transparent",
                active
                  ? "bg-zinc-900 text-white border-zinc-800"
                  : "text-zinc-500 hover:text-zinc-300"
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
        <EmptyState title="Aucun retrait" hint="Aucune demande pour le moment." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((w) => (
            <div key={w.id} className="card space-y-4 flex flex-col justify-between hover:border-zinc-800">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 border-b border-zinc-900 pb-3">
                  <div>
                    <span className="font-mono font-bold text-[10px] tracking-wider text-white bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded">{w.code}</span>
                    <p className="font-bold text-sm text-zinc-100 mt-2">{w.user_phone}</p>
                    <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">{w.user_name || "—"}</p>
                  </div>
                  <p className="text-lg font-black text-zinc-300">
                    −{mga(w.amount)} <span className="text-[10px] font-semibold text-zinc-500">MGA</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">
                  <span>Opérateur : <b className="text-zinc-350">{w.operator_label}</b></span>
                  <span>Vers : <b className="text-zinc-350">{w.recipient_phone}</b></span>
                  <span className="col-span-2 text-[10px] text-zinc-650 mt-1">Demandé : {dateFr(w.created_at)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-zinc-900 pt-3 mt-1">
                <WithdrawStatusBadge status={w.status} label={w.status_label} />
                {w.status === "PENDING" && (
                  <div className="flex gap-2">
                    <button
                      disabled={busyId === w.id}
                      onClick={() => setDialog({ kind: "reject", withdraw: w })}
                      className="btn bg-zinc-950 hover:bg-rose-950/20 text-rose-450 border border-zinc-850 hover:border-rose-900/30 px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
                    >
                      Rejeter
                    </button>
                    <button
                      disabled={busyId === w.id}
                      onClick={() => setDialog({ kind: "pay", withdraw: w })}
                      className="btn bg-white hover:bg-zinc-200 text-black px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
                    >
                      Payer
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <PromptDialog
        open={dialog?.kind === "pay"}
        onClose={() => setDialog(null)}
        onSubmit={(ref) => {
          if (dialog?.kind === "pay") pay(dialog.withdraw, ref);
        }}
        title="Confirmer le paiement"
        message={
          dialog?.kind === "pay" ? (
            <>
              Effectue le transfert {dialog.withdraw.operator_label} de {mga(dialog.withdraw.amount)} MGA vers{" "}
              {dialog.withdraw.recipient_phone}, puis saisis la référence du SMS opérateur (optionnel) :
            </>
          ) : null
        }
        defaultValue={dialog?.kind === "pay" ? dialog.withdraw.operator_ref ?? "" : ""}
        placeholder="Référence SMS opérateur"
        submitLabel="Marquer payé"
      />

      <ConfirmDialog
        open={dialog?.kind === "reject"}
        onClose={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind === "reject") reject(dialog.withdraw);
        }}
        title="Rejeter le retrait"
        message={
          dialog?.kind === "reject" ? (
            <>Rejeter la demande de retrait de {mga(dialog.withdraw.amount)} MGA vers {dialog.withdraw.recipient_phone} ? Le montant sera recrédité au joueur.</>
          ) : null
        }
        confirmLabel="Rejeter"
        danger
      />
    </div>
  );
}
