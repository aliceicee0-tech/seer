import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Bet, BetStatus } from "../api/types";
import { Badge, EmptyState, Spinner } from "../components/ui";
import { cx, dateFr, mga } from "../lib/format";
import { Ticket } from "lucide-react";

type Tab = "active" | "history";

export default function MyBetsPage() {
  const [tab, setTab] = useState<Tab>("active");
  const [items, setItems] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = tab === "active" ? api.myActiveBets() : api.myBets();
    p.then((r) => setItems(r.results)).finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-black uppercase tracking-tight text-zinc-900">Mes paris</h1>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 border border-zinc-200 p-1">
        {(["active", "history"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cx(
                "rounded-lg py-2 text-xs font-bold uppercase tracking-wider transition border border-transparent",
                active ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-550 hover:text-zinc-900"
              )}
            >
              {t === "active" ? "En cours" : "Historique"}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Ticket className="h-10 w-10 text-zinc-400" />}
          title={tab === "active" ? "Aucun pari en cours" : "Aucun pari pour l'instant"}
          hint={tab === "active" ? "Explorez les marchés ouverts." : undefined}
        />
      ) : (
        <div className="space-y-3">
          {items.map((b) => (
            <Link key={b.id} to={`/markets/${b.market}`} className="block">
              <div className="card hover:border-zinc-300 hover:bg-zinc-50/50">
                <div className="mb-2 flex items-center justify-between">
                  <Badge tone={b.outcome === "YES" ? "yes" : "no"}>
                    {b.outcome_label}
                  </Badge>
                  <StatusBadge status={b.status} label={b.status_label} />
                </div>
                <p className="line-clamp-2 text-sm font-bold text-zinc-900 leading-snug">{b.market_question}</p>
                <div className="mt-3.5 flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-semibold text-[11px] uppercase tracking-wider text-zinc-450">Mise : <b className="text-zinc-800">{mga(b.amount)} MGA</b></span>
                  {b.status === "WON" && (
                    <span className="font-black text-emerald-600">+{mga(b.payout)} MGA</span>
                  )}
                  {b.status === "LOST" && (
                    <span className="font-black text-zinc-500">−{mga(b.amount)} MGA</span>
                  )}
                  {b.status === "REFUNDED" && (
                    <span className="font-black text-zinc-550">Remboursé</span>
                  )}
                </div>
                <p className="mt-2 text-[10px] font-semibold text-zinc-450 uppercase tracking-wider">{dateFr(b.created_at)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, label }: { status: BetStatus; label: string }) {
  const tone =
    status === "WON" ? "yes" :
    status === "LOST" ? "no" :
    status === "REFUNDED" ? "info" : "warn";
  return <Badge tone={tone as "yes" | "no" | "info" | "warn"}>{label}</Badge>;
}
