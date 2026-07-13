import { useState } from "react";
import type { Category, Market, MarketFormData } from "../../api/types";

export type MarketFormResult = MarketFormData;

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "SPORTS", label: "⚽ Sport" },
  { value: "WEATHER", label: "🌦️ Météo" },
  { value: "SOCIAL", label: "📱 Réseaux sociaux" },
  { value: "TRENDING", label: "📈 Tendances" },
];

/** Convertit une Date ISO en valeur pour <input type="datetime-local">. */
function toInputDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  // datetime-local n'accepte pas le fuseau : on formate en local
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
}

/**
 * Convertit une valeur datetime-local (ex: "2026-07-15T20:00") en ISO complet
 * avec fuseau local. Sans ça, Postgres interprète la valeur comme UTC et
 * l'heure affichée est décalée ( Madagascar UTC+3 ).
 */
function toLocalISO(value: string): string {
  // new Date("2026-07-15T20:00") interprète déjà en HEURE LOCALE du navigateur.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString(); // ex: 2026-07-15T17:00:00.000Z (= 20:00 à Antananarivo)
}

export default function MarketFormDialog({
  market, onClose, onSubmit,
}: {
  market: Market | null;
  onClose: () => void;
  onSubmit: (data: MarketFormResult, id?: number) => void;
}) {
  const [form, setForm] = useState<MarketFormData>({
    question: market?.question ?? "",
    description: market?.description ?? "",
    category: market?.category ?? "WEATHER",
    source_url: market?.source_url ?? "",
    source_rules: market?.source_rules ?? "",
    bet_close_at: toInputDate(market?.bet_close_at) ?? "",
    resolve_at: toInputDate(market?.resolve_at) ?? "",
    image_url: market?.image_url ?? "",
    is_featured: market?.is_featured ?? false,
    status: market?.status ?? "OPEN",
  });
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof MarketFormData>(k: K, v: MarketFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.question.trim()) return setError("La question est obligatoire.");
    if (!form.source_url.trim()) return setError("Le lien source est obligatoire.");
    if (!form.bet_close_at || !form.resolve_at)
      return setError("Les dates de clôture et de vérification sont obligatoires.");
    setError(null);
    // datetime-local renvoie une valeur SANS fuseau horaire (ex: 2026-07-15T20:00).
    // Si on l'envoie tel quel, Postgres l'interprète comme UTC → décalage de 3h
    // à l'affichage ( Madagascar = UTC+3 ). On convertit donc en ISO complet
    // avec le fuseau local pour que l'heure saisie soit l'heure stockée.
    onSubmit(
      {
        ...form,
        bet_close_at: toLocalISO(form.bet_close_at),
        resolve_at: toLocalISO(form.resolve_at),
      },
      market?.id,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-white border border-zinc-200 p-6 sm:rounded-2xl shadow-2xl text-zinc-900"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
          <h2 className="text-lg font-black uppercase tracking-tight text-zinc-900">{market ? "Éditer le marché" : "Nouveau marché"}</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-600 font-bold">✕</button>
        </div>

        <div>
          <label className="label">Question binaire *</label>
          <input
            className="input"
            placeholder="La page X atteindra-t-elle 500 000 fans avant le 31/07 ?"
            value={form.question}
            onChange={(e) => set("question", e.target.value)}
          />
          <p className="mt-1 text-[10px] font-semibold text-zinc-450 uppercase tracking-wider">
            Syntaxe : [Quoi] [Seuil] [Où] [Avant quand] ?
          </p>
        </div>

        <div>
          <label className="label">Catégorie</label>
          <select
            className="input"
            value={form.category}
            onChange={(e) => set("category", e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Lien source officiel *</label>
          <input
            className="input"
            type="url"
            placeholder="https://www.facebook.com/…"
            value={form.source_url}
            onChange={(e) => set("source_url", e.target.value)}
          />
        </div>

        <div>
          <label className="label">Règlement / litige</label>
          <textarea
            className="input min-h-[72px]"
            placeholder="Que faire si la source est indisponible ?"
            value={form.source_rules}
            onChange={(e) => set("source_rules", e.target.value)}
          />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input min-h-[60px]"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Clôture des paris *</label>
            <input
              className="input"
              type="datetime-local"
              value={form.bet_close_at}
              onChange={(e) => set("bet_close_at", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date de vérification *</label>
            <input
              className="input"
              type="datetime-local"
              value={form.resolve_at}
              onChange={(e) => set("resolve_at", e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-600">
          <input
            type="checkbox"
            checked={form.is_featured}
            onChange={(e) => set("is_featured", e.target.checked)}
            className="rounded border-zinc-300 text-blue-600 focus:ring-blue-500/30"
          />
          Mettre en avant (featured)
        </label>

        {error && <p className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs font-semibold text-rose-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
          <button type="submit" className="btn-primary flex-1">
            {market ? "Enregistrer" : "Créer"}
          </button>
        </div>
      </form>
    </div>
  );
}
