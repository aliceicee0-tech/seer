import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { DepositRequest, MobileMoneyInfo, Operator } from "../api/types";
import { Badge, Spinner } from "../components/ui";
import { cx, dateFr, mga } from "../lib/format";
import { ArrowLeft, AlertTriangle, CreditCard } from "lucide-react";

const OPERATORS: { key: Operator; label: string }[] = [
  { key: "MVOLA", label: "MVola" },
  { key: "ORANGE", label: "Orange Money" },
  { key: "AIRTEL", label: "Airtel Money" },
];

export default function DepositPage() {
  const [info, setInfo] = useState<MobileMoneyInfo | null>(null);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // État du formulaire de création
  const [amount, setAmount] = useState("5000");
  const [operator, setOperator] = useState<Operator>("MVOLA");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Déclaration (après transfert réel)
  const [declared, setDeclared] = useState<{ [id: number]: boolean }>({});
  const [sender, setSender] = useState("");
  const [smsRef, setSmsRef] = useState("");

  function load() {
    Promise.all([api.mobileMoney(), api.deposits()])
      .then(([i, d]) => {
        setInfo(i);
        setDeposits(d.results);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function create() {
    setError("");
    setCreating(true);
    try {
      await api.createDeposit(amount, operator);
      setAmount("5000");
      load();
    } catch {
      setError("Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  async function declare(dep: DepositRequest) {
    setError("");
    try {
      await api.declareDeposit(dep.id, sender, smsRef);
      setDeclared((s) => ({ ...s, [dep.id]: false }));
      setSender("");
      setSmsRef("");
      load();
    } catch {
      setError("Déclaration impossible.");
    }
  }

  if (loading || !info) return <Spinner />;

  const number = info.numbers[operator];

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <Link to="/wallet" className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-white transition">
        <ArrowLeft className="h-4 w-4" /> Wallet
      </Link>
      <h1 className="text-2xl font-black uppercase tracking-tight text-white">Déposer</h1>

      {/* Étape 1 : créer la demande */}
      <div className="card space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-zinc-400">1. Créer la demande</h2>
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
                      ? "bg-white border-white text-black shadow-md"
                      : "bg-zinc-950/60 border-zinc-900/80 text-zinc-450 hover:text-zinc-200 hover:border-zinc-700"
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
        <button onClick={create} className="btn-primary w-full" disabled={creating}>
          {creating ? "Création…" : "Générer le code"}
        </button>
        {error && <p className="text-xs font-semibold text-rose-400 bg-rose-950/20 border border-rose-900/30 px-3 py-2 rounded-xl">{error}</p>}
      </div>

      {/* Instructions */}
      <div className="card space-y-3.5 text-xs">
        <h2 className="text-xs font-black uppercase tracking-wider text-zinc-400">2. Effectuez le transfert</h2>
        <p className="text-zinc-400 leading-relaxed">
          Envoyez votre montant vers le numéro officiel de Nexus, puis déclarez
          votre transaction ci-dessous.
        </p>
        <div className="rounded-xl bg-zinc-950 border border-zinc-900 p-4 space-y-2">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-550">Destinataire</p>
            <p className="font-bold text-zinc-200">{info.holder}</p>
          </div>
          <div className="border-t border-zinc-900 pt-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-550">Numéro {operator}</p>
            <p className="text-lg font-black tracking-wider text-white">{number}</p>
          </div>
        </div>
        <div className="rounded-xl border border-amber-950/50 bg-amber-950/15 p-3.5 text-zinc-400 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
          <p className="leading-relaxed">
            Incluez précisément le code de référence de votre demande dans le motif de votre transfert opérateur.
          </p>
        </div>
      </div>

      {/* Demandes existantes */}
      <div className="space-y-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wider text-zinc-550">Vos demandes</h2>
        {deposits.length === 0 && (
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider px-1">Aucune demande en cours.</p>
        )}
        {deposits.map((d) => (
          <div key={d.id} className="card space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-black text-white">{mga(d.amount)} MGA</p>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-0.5">{d.operator_label}</p>
              </div>
              <Badge
                tone={
                  d.status === "APPROVED" ? "yes"
                    : d.status === "REJECTED" ? "no" : "warn"
                }
              >
                {d.status_label}
              </Badge>
            </div>
            <div className="rounded-lg bg-zinc-950 border border-zinc-900 px-3.5 py-2 text-xs flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Code à inclure :</span>
              <span className="font-mono font-bold text-white tracking-wider bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">{d.code}</span>
            </div>
            <p className="text-[10px] font-semibold text-zinc-650 uppercase tracking-wider">Créée le {dateFr(d.created_at)}</p>

            {d.status === "PENDING" && !declared[d.id] && (
              <button
                onClick={() => setDeclared((s) => ({ ...s, [d.id]: true }))}
                className="btn-secondary w-full text-xs font-bold"
              >
                Déclarer le transfert
              </button>
            )}

            {declared[d.id] && (
              <div className="space-y-2 border-t border-zinc-850 pt-3">
                <input
                  className="input text-xs"
                  placeholder="Votre n° expéditeur"
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                />
                <input
                  className="input text-xs"
                  placeholder="Référence SMS opérateur (optionnel)"
                  value={smsRef}
                  onChange={(e) => setSmsRef(e.target.value)}
                />
                <button onClick={() => declare(d)} className="btn-primary w-full text-xs font-bold">
                  Valider ma déclaration
                </button>
              </div>
            )}

            {d.sender_phone && d.status === "PENDING" && (
              <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">
                Déclaré depuis {d.sender_phone}. En attente de validation admin.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
