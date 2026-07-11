import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Bet } from "../api/types";
import { Badge, EmptyState, Spinner } from "../components/ui";
import { cx, dateFr, mga } from "../lib/format";
import { Layers } from "lucide-react";

export default function MyBetsPage() {
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.myBets().then((r) => setBets(r.results)).finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-black uppercase tracking-tight text-zinc-900">
        Mes paris
      </h1>

      {loading ? (
        <Spinner />
      ) : bets.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-10 w-10 text-zinc-400" />}
          title="Aucun pari"
          hint="Pariez sur un marché pour voir vos paris ici."
        />
      ) : (
        <div className="space-y-3">
          {bets.map((b) => <BetCard key={b.id} b={b} />)}
        </div>
      )}
    </div>
  );
}

function BetCard({ b }: { b: Bet }) {
  const won = b.status === "WON";
  const lost = b.status === "LOST";
  const refunded = b.status === "REFUNDED";

  return (
    <Link to={`/markets/${b.market_id}`} className="block">
      <div className="card hover:border-zinc-300 hover:bg-zinc-50/50">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge tone={b.outcome === "YES" ? "yes" : "no"}>
              {b.outcome_label}
            </Badge>
            <BetStatusBadge status={b.status} />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            {dateFr(b.created_at)}
          </span>
        </div>

        <p className="line-clamp-2 text-sm font-bold text-zinc-900 leading-snug">
          {b.market_question}
        </p>

        <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2.5">
          <span className="text-xs font-semibold text-zinc-500">
            Mise : <b className="text-zinc-800">{mga(b.amount)} Ar</b>
          </span>
          {won && (
            <span className="font-display text-sm font-black text-emerald-600">
              +{mga(b.payout)} Ar
            </span>
          )}
          {lost && (
            <span className="font-display text-sm font-black text-rose-500">
              -{mga(b.amount)} Ar
            </span>
          )}
          {refunded && (
            <span className="text-xs font-bold text-zinc-400">Remboursé</span>
          )}
          {b.status === "PENDING" && (
            <span className="text-xs font-bold text-amber-500">En attente</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function BetStatusBadge({ status }: { status: Bet["status"] }) {
  const tone = status === "WON" ? "yes" : status === "LOST" ? "no" : status === "REFUNDED" ? "neutral" : "warn";
  const label = status === "WON" ? "Gagné" : status === "LOST" ? "Perdu" : status === "REFUNDED" ? "Remboursé" : "En cours";
  return <Badge tone={tone as "yes" | "no" | "neutral" | "warn"}>{label}</Badge>;
}
