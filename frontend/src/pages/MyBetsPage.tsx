import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Order, OrderStatus, Position } from "../api/types";
import { Badge, EmptyState, Spinner } from "../components/ui";
import { arPrice, cx, dateFr, mga } from "../lib/format";
import { Layers, ListOrdered } from "lucide-react";

type Tab = "positions" | "orders";

export default function MyBetsPage() {
  const [tab, setTab] = useState<Tab>("positions");
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p =
      tab === "positions"
        ? api.myPositions().then((r) => setPositions(r.results))
        : api.myOrders().then((r) => setOrders(r.results));
    p.finally(() => setLoading(false));
  }, [tab]);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-black uppercase tracking-tight text-zinc-900">
        Mes positions
      </h1>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 border border-zinc-200 p-1">
        {(["positions", "orders"] as Tab[]).map((t) => {
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
              {t === "positions" ? "Positions" : "Mes ordres"}
            </button>
          );
        })}
      </div>

      {loading ? (
        <Spinner />
      ) : tab === "positions" ? (
        positions.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-10 w-10 text-zinc-400" />}
            title="Aucune position ouverte"
            hint="Émettez des paires ou achetez des parts sur un marché."
          />
        ) : (
          <div className="space-y-3">
            {positions.map((p) => (
              <PositionCard key={p.id} p={p} />
            ))}
          </div>
        )
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ListOrdered className="h-10 w-10 text-zinc-400" />}
          title="Aucun ordre"
          hint="Vos ordres en attente et historique apparaîtront ici."
        />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <OrderCard key={o.id} o={o} />
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Position : parts détenues + P&L
// --------------------------------------------------------------------------

function PositionCard({ p }: { p: Position }) {
  const pnl = parseFloat(p.pnl);
  const avg = parseFloat(p.avg_buy_price);
  const last = p.last_price ? parseFloat(p.last_price) : null;
  const isWin = pnl > 0;

  return (
    <Link to={`/markets/${p.market}`} className="block">
      <div className="card hover:border-zinc-300 hover:bg-zinc-50/50">
        <div className="mb-2 flex items-center justify-between">
          <Badge tone={p.outcome === "YES" ? "yes" : "no"}>{p.outcome_label}</Badge>
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            {p.market_status}
          </span>
        </div>

        <p className="line-clamp-2 text-sm font-bold text-zinc-900 leading-snug">
          {p.market_question}
        </p>

        {/* Stats principales */}
        <div className="mt-3.5 grid grid-cols-4 gap-2 text-center">
          <Metric label="Taille" value={`${p.quantity}`} />
          <Metric label="Prix moy." value={avg ? `${arPrice(avg)} Ar` : "—"} />
          <Metric
            label="Valeur"
            value={last ? `${mga(String(last * p.quantity))}` : "—"}
          />
          <Metric
            label="P&L"
            value={`${isWin ? "+" : ""}${mga(p.pnl)}`}
            tone={isWin ? "yes" : pnl < 0 ? "no" : "neutral"}
          />
        </div>

        <p className="mt-2.5 text-[10px] font-semibold text-zinc-450 uppercase tracking-wider">
          {p.available_quantity < p.quantity
            ? `${p.available_quantity} dispo · ${p.locked_quantity} en vente`
            : dateFr(p.updated_at)}
        </p>
      </div>
    </Link>
  );
}

function Metric({
  label, value, tone = "neutral",
}: {
  label: string; value: string; tone?: "neutral" | "yes" | "no";
}) {
  return (
    <div className="rounded-lg bg-zinc-50 border border-zinc-150 py-2 px-1">
      <p className="text-[8px] font-extrabold uppercase tracking-widest text-zinc-400">
        {label}
      </p>
      <p
        className={cx(
          "font-display text-xs font-black tracking-tight mt-0.5",
          tone === "yes" ? "text-emerald-600" : tone === "no" ? "text-rose-600" : "text-zinc-800"
        )}
      >
        {value}
      </p>
    </div>
  );
}

// --------------------------------------------------------------------------
// Ordre : en attente / exécuté / annulé
// --------------------------------------------------------------------------

function OrderCard({ o }: { o: Order }) {
  return (
    <Link to={`/markets/${o.market}`} className="block">
      <div className="card hover:border-zinc-300 hover:bg-zinc-50/50">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge tone={o.side === "BUY" ? "yes" : "no"}>
              {o.side === "BUY" ? "Achat" : "Vente"}
            </Badge>
            <Badge tone={o.outcome === "YES" ? "info" : "warn"}>
              {o.outcome_label}
            </Badge>
          </div>
          <OrderStatusBadge status={o.status} label={o.status_label} />
        </div>

        <p className="line-clamp-2 text-sm font-bold text-zinc-900 leading-snug">
          {o.market_question}
        </p>

        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span className="font-semibold text-[11px] uppercase tracking-wider text-zinc-450">
            {o.order_type === "LIMIT" ? `Limite ${o.price ? `${arPrice(o.price)} Ar` : ""}` : "Au marché"} ·{" "}
            <b className="text-zinc-700">{o.filled_quantity}/{o.quantity}</b>
          </span>
          {o.status === "OPEN" && (
            <CancelOrderButton orderId={o.id} marketId={o.market} />
          )}
        </div>
        <p className="mt-2 text-[10px] font-semibold text-zinc-450 uppercase tracking-wider">
          {dateFr(o.created_at)}
        </p>
      </div>
    </Link>
  );
}

function OrderStatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  const tone =
    status === "FILLED" ? "yes" :
    status === "CANCELLED" || status === "EXPIRED" ? "neutral" :
    "warn";
  return <Badge tone={tone as "yes" | "neutral" | "warn"}>{label}</Badge>;
}

function CancelOrderButton({ orderId, marketId }: { orderId: number; marketId: number }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        setBusy(true);
        api
          .cancelOrder(marketId, orderId)
          .finally(() => window.location.reload());
      }}
      disabled={busy}
      className="rounded-lg border border-rose-200 bg-rose-50/50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-rose-600 hover:bg-rose-100 transition disabled:opacity-50"
    >
      {busy ? "…" : "Annuler"}
    </button>
  );
}
