import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { AdminUser } from "../../api/types";
import { EmptyState, Spinner } from "../../components/ui";
import { dateFr, mga } from "../../lib/format";

export default function AdminUsersPage() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.admin.users(q || undefined).then((r) => setItems(r.results))
      .finally(() => setLoading(false));
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 300);  // debounce léger
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-extrabold">Joueurs</h1>
        <p className="text-sm text-slate-400">Comptes et soldes (hors staff).</p>
      </header>

      <input
        className="input"
        placeholder="🔎 Rechercher par téléphone ou nom…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState icon="👥" title="Aucun joueur" hint={q ? "Affine ta recherche." : undefined} />
      ) : (
        <div className="space-y-3">
          {items.map((u) => (
            <div key={u.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{u.phone}</p>
                  <p className="text-xs text-slate-400">{u.display_name || "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-emerald-300">
                    {mga(u.available_balance)} <span className="text-xs text-slate-400">MGA</span>
                  </p>
                  {parseFloat(u.locked_balance) > 0 && (
                    <p className="text-[11px] text-amber-300">
                      bloqué : {mga(u.locked_balance)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{u.positions_count} position(s) · {dateFr(u.date_joined)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
