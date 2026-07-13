// Utilitaires de formatage (montants, dates, classes)

export function mga(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
}

export function mgaSigned(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  const s = mga(Math.abs(n));
  return n < 0 ? `− ${s}` : `+ ${s}`;
}

export function percent(value: string | number, digits = 1): string {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

// Valeur d'une part à la résolution (doit rester synchro avec SHARE_VALUE côté backend).
export const SHARE_VALUE = 5000;

/** Formate un prix en Ariary (entier, séparateur de milliers). */
export function arPrice(value: string | number): string {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "—";
  return mga(Math.round(n));
}

/** Pourcentage implicite d'un prix : prix / SHARE_VALUE (ex: 3000 Ar → 60%). */
export function pctOf(price: string | number | null, digits = 0): string {
  if (price === null || price === undefined) return "—";
  const n = typeof price === "number" ? price : parseFloat(price);
  if (Number.isNaN(n)) return "—";
  return `${((n / SHARE_VALUE) * 100).toFixed(digits)}%`;
}

// Fuseau horaire de Madagascar ( Indian/Antananarivo = UTC+3 ).
// Forcé partout pour que les dates soient stables quel que soit le réglage
// du navigateur/téléphone du joueur.
const MG_TZ = "Indian/Antananarivo";

export function dateFr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: MG_TZ,
  }).format(d);
}

export function timeLeft(iso: string | null | undefined): string {
  if (!iso) return "—";
  // La différence d'instants est indépendante du fuseau (timestamps absolus).
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Clôturé";
  const h = Math.floor(ms / 3_600_000);
  const j = Math.floor(h / 24);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (j > 0) return `dans ${j} j ${h % 24} h`;
  if (h > 0) return `dans ${h} h ${m % 60}`;
  return `dans ${m} min`;
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
