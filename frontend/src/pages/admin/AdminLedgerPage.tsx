import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { AdminLedgerEntry } from "../../api/types";
import { Badge, EmptyState, Spinner } from "../../components/ui";
import { cx, dateFr, mgaSigned } from "../../lib/format";

type EntryType =
  | "DEPOSIT" | "WITHDRAW" | "BET_PLACE" | "BET_WIN" | "BET_REFUND" | "BONUS" | "ADJUSTMENT";

const TYPE_TONE: Record<EntryType, "yes" | "no" | "info" | "warn" | "neutral"> = {
  DEPOSIT: "yes",
  BET_WIN: "yes",
  BET_REFUND: "info",
  WITHDRAW: "no",
  BET_PLACE: "no",
  BONUS: "yes",
  ADJUSTMENT: "warn",
};

const FILTERS: { key: EntryType | ""; label: string }[] = [
  { key: "", label: "Tous" },
  { key: "DEPOSIT", label: "Dépôts" },
  { key: "WITHDRAW", label: "Retraits" },
  { key: "BET_PLACE", label: "Mises" },
  { key: "BET_WIN", label: "Gains" },
  { key: "BONUS", label: "Bonus" },
  { key: "BET_REFUND", label: "Remb." },
];

export default function AdminLedgerPage() {
  const [items, setItems] = useState<AdminLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<EntryType | "">("");
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (type) params.type = type;
    if (q) params.q = q;
    api.admin.ledger(params).then((r) => setItems(r.results))
      .finally(() => setLoading(false));
  }, [type, q]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">Comptabilité</h1>
        <p className="text-sm text-zinc-500">Journal complet des mouvements de solde.</p>
      </header>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-zinc-100 border border-zinc-200 p-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setType(f.key)}
            className={cx(
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition border border-transparent",
              type === f.key
                ? "bg-white text-zinc-900 border-zinc-200 shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <input
        className="input"
        placeholder="🔎 Référence, note ou téléphone…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="🧾" title="Aucune écriture" />
      ) : (
        <div className="space-y-2">
          {items.map((e) => {
            const tone = TYPE_TONE[e.type as EntryType] ?? "neutral";
            const credit = parseFloat(e.amount) >= 0;
            return (
              <div key={e.id} className="card flex items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={tone}>{e.type_label}</Badge>
                    <span className="truncate text-xs text-zinc-550">{e.reference || "—"}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-650">
                    {e.user_phone}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                  <p className="text-[11px] text-zinc-400">{dateFr(e.created_at)}</p>
                </div>
                <div className="text-right">
                  <p className={cx(
                    "font-bold",
                    credit ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {mgaSigned(e.amount)}
                  </p>
                  <p className="text-[11px] text-zinc-500">→ {parseFloat(e.balance_after).toLocaleString("fr-FR")}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
