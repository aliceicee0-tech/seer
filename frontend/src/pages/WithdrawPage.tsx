import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Operator, WithdrawRequest } from "../api/types";
import { useAuth } from "../store/auth";
import { Badge, Spinner } from "../components/ui";
import { cx, dateFr, mga } from "../lib/format";
import { ArrowLeft } from "lucide-react";

const OPERATORS: { key: Operator; label: string }[] = [
  { key: "MVOLA", label: "MVola" },
  { key: "ORANGE", label: "Orange Money" },
  { key: "AIRTEL", label: "Airtel Money" },
];

// Ton visuel selon le statut du retrait (vert = payé, rouge = rejeté, ambre sinon).
const WITHDRAW_TONE: Record<WithdrawRequest["status"], "yes" | "no" | "warn"> = {
  PENDING: "warn",
  PAID: "yes",
  REJECTED: "no",
};

export default function WithdrawPage() {
  const { user } = useAuth();
  const [list, setList] = useState<WithdrawRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const [amount, setAmount] = useState("1000");
  const [operator, setOperator] = useState<Operator>("MVOLA");
  const [recipient, setRecipient] = useState(user?.phone ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function load() {
    api.withdrawals().then((r) => setList(r.results)).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function create() {
    setError("");
    setCreating(true);
    try {
      await api.createWithdraw(amount, operator, recipient);
      load();
    } catch (e) {
      setError(humanize(e));
    } finally {
      setCreating(false);
    }
  }

  if (loading || !user) return <Spinner />;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <Link to="/wallet" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 transition">
        <ArrowLeft className="h-4 w-4" /> Wallet
      </Link>
      <h1 className="text-2xl font-black uppercase tracking-tight text-zinc-900">Retirer</h1>

      <div className="card space-y-4">
        <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-3.5 text-xs flex justify-between items-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-550">Disponible :</span>
          <span className="font-black text-zinc-900 text-sm">{mga(user.available_balance)} MGA</span>
        </div>

        <div>
          <label className="label">Opérateur</label>
          <div className="grid grid-cols-3 gap-2">
            {OPERATORS.map((o) => {
              const selected = operator === o.key;
              return (
                <button
                  key={o.key}
                  onClick={() => setOperator(o.key)}
                  className={cx(
                    "rounded-xl border p-3 text-[10px] font-black uppercase tracking-widest transition-all duration-300 active:scale-[0.96] font-display",
                    selected
                      ? "bg-zinc-900 border-zinc-900 text-white shadow-md font-bold"
                      : "bg-zinc-50 border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="label">Montant (MGA)</label>
          <input
            className="input"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </div>

        <div>
          <label className="label">Numéro de réception</label>
          <input
            className="input"
            inputMode="tel"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>

        {error && <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-xl">{error}</p>}

        <button onClick={create} className="btn-primary w-full" disabled={creating}>
          {creating ? "Traitement…" : "Demander le retrait"}
        </button>
        <p className="text-[10px] font-medium leading-relaxed text-zinc-550">
          Le montant sera bloqué immédiatement et transféré vers votre numéro
          après validation manuelle par l'administrateur.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-zinc-550">Demandes de retrait</h2>
        {list.length === 0 && <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider px-1">Aucune demande.</p>}
        {list.map((w) => (
          <div key={w.id} className="card flex items-center justify-between">
            <div className="space-y-0.5">
              <p className="text-base font-black text-zinc-900">{mga(w.amount)} MGA</p>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                {w.operator_label} &rarr; {w.recipient_phone}
              </p>
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mt-1">{dateFr(w.created_at)}</p>
            </div>
            <Badge tone={WITHDRAW_TONE[w.status]}>
              {w.status_label}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

const HTTP_BAD_REQUEST = 400;  // solde insuffisant côté API

function humanize(e: unknown): string {
  if (e instanceof ApiError && e.status === HTTP_BAD_REQUEST) {
    return "Solde disponible insuffisant.";
  }
  return "Demande impossible.";
}
