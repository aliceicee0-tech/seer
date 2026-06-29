import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { Category, Market } from "../api/types";
import { Badge, EmptyState, ProbabilityBar, Spinner } from "../components/ui";
import { cx, dateFr, timeLeft } from "../lib/format";
import { Clock } from "lucide-react";

export default function MarketsPage() {
  const [searchParams] = useSearchParams();
  const cat = (searchParams.get("cat") || "") as Category | "";
  const [items, setItems] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .markets(cat ? { category: cat } : {})
      .then((r) => setItems(r.results))
      .finally(() => setLoading(false));
  }, [cat]);

  return (
    <div>
      <div className="mb-8 border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 uppercase font-display">Marchés ouverts</h1>
        <p className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-450 mt-2">
          Prédictions en Ariary sur la Météo et les Réseaux sociaux
        </p>
      </div>

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="Aucun marché pour l'instant" hint="Revenez bientôt !" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((m) => (
            <MarketCard key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketCard({ m }: { m: Market }) {
  const open = m.status === "OPEN";
  return (
    <Link to={`/markets/${m.id}`} className="block">
      <div className="card hover:border-zinc-300 hover:bg-zinc-50/50">
        <div className="mb-3.5 flex items-center gap-2">
          <Badge tone={categoryTone(m.category)}>{m.category_label}</Badge>
          {m.is_featured && <Badge tone="info">À la une</Badge>}
          {!open && <Badge tone="warn">{statusLabel(m.status)}</Badge>}
        </div>

        <h3 className="mb-5 line-clamp-2 text-base font-bold leading-snug text-zinc-900 font-display tracking-tight h-[48px]">{m.question}</h3>

        <ProbabilityBar yes={m.proba_yes} no={m.proba_no} />

        <div className="mt-5 flex items-center justify-between text-[9px] font-extrabold uppercase tracking-widest text-zinc-450 border-t border-zinc-100 pt-3.5">
          <span>
            Prix :{" "}
            <strong className="text-zinc-700 font-extrabold">
              {m.last_price ? `${Math.round(parseFloat(m.last_price) * 100)}¢ / 100¢` : "—"}
            </strong>
          </span>
          <span className="flex items-center gap-1.5">
            {open ? (
              <>
                <Clock className="h-3.5 w-3.5 text-zinc-400" />
                <span>{timeLeft(m.bet_close_at)}</span>
              </>
            ) : (
              <span>Résolu : {dateFr(m.resolved_at)}</span>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}

function categoryTone(c: Category): "yes" | "info" | "warn" {
  if (c === "WEATHER") return "info";
  if (c === "SOCIAL") return "yes";
  if (c === "SPORTS") return "warn";   // ambre → se démarque (temps réel)
  return "warn";
}

function statusLabel(s: Market["status"]): string {
  const map: Record<string, string> = {
    LOCKED: "Clôturé", RESOLVING: "En résolution",
    RESOLVED: "Résolu", CANCELLED: "Annulé", DRAFT: "Brouillon",
    FROZEN: "Gelé",
  };
  return map[s] ?? s;
}
