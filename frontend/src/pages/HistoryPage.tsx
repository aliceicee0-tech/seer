import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { LedgerEntry } from "../api/types";
import { EmptyState, Spinner } from "../components/ui";
import { cx, dateFr, mgaSigned } from "../lib/format";
import { ArrowDownLeft, ArrowUpRight, Ticket, Trophy, Undo2, Sliders } from "lucide-react";

const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  DEPOSIT: { icon: ArrowDownLeft, tone: "text-emerald-600 font-bold" },
  WITHDRAW: { icon: ArrowUpRight, tone: "text-zinc-500 font-bold" },
  BET_PLACE: { icon: Ticket, tone: "text-zinc-500" },
  BET_WIN: { icon: Trophy, tone: "text-blue-600 font-extrabold" },
  BET_REFUND: { icon: Undo2, tone: "text-zinc-500" },
  ADJUSTMENT: { icon: Sliders, tone: "text-amber-600 font-bold" },
};

export default function HistoryPage() {
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.myLedger().then((r) => setItems(r.results)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-black uppercase tracking-tight text-white">Transactions</h1>
      <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
        Historique comptable complet de votre compte
      </p>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Aucune transaction" />
      ) : (
        <div className="card divide-y divide-zinc-100 p-0 overflow-hidden">
          {items.map((e) => {
            const meta = TYPE_META[e.type] ?? TYPE_META.ADJUSTMENT;
            const Icon = meta.icon;
            return (
              <div key={e.id} className="flex items-center gap-4 px-5 py-4.5 hover:bg-zinc-50/50 transition duration-300">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-50 border border-zinc-200 text-zinc-500">
                  <Icon className="h-4.5 w-4.5 stroke-[2px]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black uppercase tracking-wider text-zinc-800">
                    {e.type_label}
                    {e.reference && (
                      <span className="ml-2 font-mono text-[9px] text-zinc-500 bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded">{e.reference}</span>
                    )}
                  </p>
                  <p className="truncate text-[10px] font-semibold text-zinc-450 mt-1">
                    {e.note || dateFr(e.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={cx("text-sm font-black tracking-tight font-display", meta.tone)}>{mgaSigned(e.amount)}</p>
                  <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider mt-1">Solde: {e.balance_after}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
