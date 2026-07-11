import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type {
  Estimate, Market, MarketPool, OrderBook, OrderInput, OrderSide, OrderType,
  Outcome,
} from "../api/types";
import { useAuth } from "../store/auth";
import { Badge, ProbabilityBar, Spinner } from "../components/ui";
import { arPrice, cx, dateFr, mga, pctOf, timeLeft } from "../lib/format";
import {
  BookOpen, Globe, ShieldAlert, Calendar, ArrowLeft, CheckCircle2,
  Layers, ArrowDownUp,
} from "lucide-react";

export default function MarketDetailPage() {
  const { id } = useParams();
  const { user, fetchMe } = useAuth();
  const [m, setM] = useState<Market | null>(null);
  const [pool, setPool] = useState<MarketPool | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.market(Number(id)),
      api.marketPool(Number(id)).catch(() => null),
    ])
      .then(([market, p]) => {
        setM(market);
        setPool(p);
      })
      .finally(() => setLoading(false));
  }, [id, refreshKey]);

  if (loading) return <Spinner />;
  if (!m)
    return (
      <div className="py-12 text-center text-zinc-500">
        <p className="text-sm font-semibold">Marché introuvable.</p>
        <Link to="/" className="mt-4 inline-flex items-center gap-1.5 text-xs text-zinc-900 font-bold hover:underline">
          <ArrowLeft className="h-4 w-4" /> Retour aux marchés
        </Link>
      </div>
    );

  const open = m.status === "OPEN";
  // Après toute opération (achat/vente/mint/merge), on rafraîchit à la fois
  // les données du marché ET le wallet du joueur (sinon le solde ne bouge pas).
  const onChanged = () => {
    setRefreshKey((k) => k + 1);
    fetchMe();
  };

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-550 hover:text-zinc-900 transition">
        <ArrowLeft className="h-4.5 w-4.5" /> Marchés
      </Link>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Left Column: Details & Rules */}
        <div className="flex-grow space-y-4 w-full md:w-2/3">
          <div className="card">
            <div className="mb-3 flex items-center gap-2">
              <Badge tone="info">{m.category_label}</Badge>
              {open ? (
                <Badge tone="yes">Ouvert</Badge>
              ) : (
                <Badge tone="warn">{m.status}</Badge>
              )}
            </div>
            <h1 className="text-xl font-extrabold leading-snug text-zinc-900">{m.question}</h1>

            <div className="mt-5">
              <ProbabilityBar yes={m.proba_yes} no={m.proba_no} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <Stat label="Dernier prix" value={m.last_price ? `${arPrice(m.last_price)} Ar` : "—"} sub={`1 part = ${mga(5000)} Ar à la résolution`} />
              <Stat label="Clôture" value={timeLeft(m.bet_close_at)} sub={dateFr(m.bet_close_at)} />
              <Stat label="OUI" value={pctOf(m.last_price)} tone="yes" />
              <Stat label="NON" value={m.last_price ? `${Math.round((1 - parseFloat(m.last_price) / 5000) * 100)}%` : "50%"} tone="no" />
            </div>

            {pool && (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-zinc-150 bg-zinc-50/60 px-4 py-2.5">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-400">
                  Séquestre collatéral
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-display text-xs font-black text-zinc-800">
                    {mga(pool.escrow_balance)} MGA
                  </span>
                  <Badge tone={pool.invariant_ok ? "yes" : "no"}>
                    {pool.invariant_ok ? "Invariant ✓" : "Anomalie"}
                  </Badge>
                </span>
              </div>
            )}
          </div>

          {/* Règlement & source */}
          <div className="card space-y-4 text-sm">
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                <BookOpen className="h-4 w-4 text-zinc-400" /> Règlement
              </h3>
              <p className="whitespace-pre-line text-xs text-zinc-600 leading-relaxed pl-6">{m.description}</p>
            </div>
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                <Globe className="h-4 w-4 text-zinc-400" /> Source officielle
              </h3>
              <div className="pl-6">
                <a
                  href={m.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-xs font-bold text-zinc-600 hover:text-blue-600 underline hover:no-underline"
                >
                  {m.source_url}
                </a>
              </div>
            </div>
            {m.source_rules && (
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                  <ShieldAlert className="h-4 w-4 text-zinc-400" /> En cas de litige
                </h3>
                <p className="whitespace-pre-line text-xs text-zinc-600 leading-relaxed pl-6">{m.source_rules}</p>
              </div>
            )}
            <div className="space-y-1">
              <h3 className="flex items-center gap-2 font-bold uppercase tracking-wider text-xs text-zinc-800">
                <Calendar className="h-4 w-4 text-zinc-400" /> Vérification
              </h3>
              <p className="text-xs text-zinc-500 pl-6">{dateFr(m.resolve_at)}</p>
            </div>
          </div>
        </div>

        {/* Right Column: Trading Panel (Sticky on Desktop) */}
        <div className="w-full md:w-[360px] md:sticky md:top-20 shrink-0">
          {open && user ? (
            <TradingPanel market={m} onChanged={onChanged} />
          ) : open && !user ? (
            <div className="card text-center py-6 space-y-3">
              <p className="text-sm text-zinc-500">Connectez-vous pour échanger sur ce marché.</p>
              <Link to="/login" className="btn bg-blue-600 hover:bg-blue-700 text-white font-bold inline-flex w-full">
                Se connecter
              </Link>
            </div>
          ) : (
            <div className="card text-center py-6 text-sm text-zinc-500 space-y-2">
              {m.status === "RESOLVED" ? (
                <>
                  <div className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-800 uppercase tracking-wider bg-zinc-50 border border-zinc-200 px-3 py-1 rounded-full">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Résultat officiel : {m.outcome === "YES" ? "OUI" : "NON"}
                  </div>
                  <p className="text-xs text-zinc-450 font-semibold uppercase tracking-wider mt-2">Résolu le {dateFr(m.resolved_at)}</p>
                </>
              ) : (
                <p className="font-semibold uppercase tracking-wider text-xs text-zinc-450">Ce marché n'est plus ouvert aux échanges.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: "yes" | "no";
}) {
  return (
    <div className="rounded-xl bg-zinc-50 border border-zinc-150 p-4 space-y-1">
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-zinc-400">{label}</p>
      <p
        className={cx(
          "text-base font-black tracking-tight font-display",
          tone === "yes" ? "text-blue-600" : tone === "no" ? "text-rose-600" : "text-zinc-800"
        )}
      >
        {value}
      </p>
      {sub && <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wide mt-0.5">{sub}</p>}
    </div>
  );
}

// ==========================================================================
// Panneau de trading : Trade (Buy/Sell) | Mint/Merge | Carnet
// ==========================================================================

type PanelTab = "trade" | "amm" | "book";

function TradingPanel({ market, onChanged }: { market: Market; onChanged: () => void }) {
  const [tab, setTab] = useState<PanelTab>("trade");
  const [book, setBook] = useState<OrderBook[] | null>(null);

  useEffect(() => {
    api.orderBook(market.id).then(setBook).catch(() => setBook(null));
  }, [market.id, tab, onChanged]);

  return (
    <div className="space-y-3">
      {/* Onglets */}
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-100 border border-zinc-200 p-1">
        {([
          { k: "trade", label: "Échanger", icon: ArrowDownUp },
          { k: "amm", label: "Émettre", icon: Layers },
        ] as { k: PanelTab; label: string; icon: typeof ArrowDownUp }[]).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={cx(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider transition",
              tab === t.k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
        <button
          onClick={() => setTab("book")}
          className={cx(
            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wider transition",
            tab === "book" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
          )}
        >
          Carnet
        </button>
      </div>

      {tab === "trade" && <TradePanel market={market} onChanged={onChanged} book={book} />}
      {tab === "amm" && <MintMergePanel market={market} onChanged={onChanged} />}
      {tab === "book" && <OrderBookView book={book} />}
    </div>
  );
}

// --------------------------------------------------------------------------
// Trade : Buy / Sell (Limit / Market)
// --------------------------------------------------------------------------

function TradePanel({
  market, onChanged, book,
}: {
  market: Market; onChanged: () => void; book: OrderBook[] | null;
}) {
  const [outcome, setOutcome] = useState<Outcome>("YES");
  const [side, setSide] = useState<OrderSide>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("LIMIT");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("10");
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // Estimation indicative (debounce)
  useEffect(() => {
    setError("");
    const t = setTimeout(() => {
      const q = parseInt(quantity, 10);
      if (Number.isNaN(q) || q <= 0) {
        setEstimate(null);
        return;
      }
      api.estimate(market.id, outcome, q).then(setEstimate).catch(() => setEstimate(null));
    }, 300);
    return () => clearTimeout(t);
  }, [outcome, quantity, market.id]);

  // Pré-remplit le prix avec la meilleure offre du carnet au changement d'onglet outcome
  useEffect(() => {
    if (orderType !== "LIMIT" || !book) return;
    const ob = book.find((b) => b.outcome === outcome);
    if (!ob) return;
    if (side === "BUY" && ob.asks[0]) setPrice(ob.asks[0].price);
    if (side === "SELL" && ob.bids[0]) setPrice(ob.bids[0].price);
  }, [outcome, side, book, orderType]);

  async function submit() {
    setError("");
    setSubmitting(true);
    try {
      const input: OrderInput = {
        side, outcome, order_type: orderType, quantity: parseInt(quantity, 10),
      };
      if (orderType === "LIMIT") input.price = price;
      await api.placeOrder(market.id, input);
      setDone(
        `${side === "BUY" ? "Achat" : "Vente"} de ${quantity} ${outcome === "YES" ? "OUI" : "NON"} placé.`
      );
      setTimeout(onChanged, 1100);
    } catch (e) {
      setError(humanize(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (done)
    return <SuccessCard title="Ordre placé" message={done} />;

  const qty = parseInt(quantity || "0", 10) || 0;

  // Meilleur prix disponible dans le carnet pour le côté choisi.
  const ob = book?.find((b) => b.outcome === outcome);
  const bestAsk = ob?.asks[0];   // meilleure vente (prix le + bas)
  const bestBid = ob?.bids[0];   // meilleur achat (prix le + haut)
  const marketPrice = side === "BUY"
    ? (bestAsk ? parseFloat(bestAsk.price) : null)
    : (bestBid ? parseFloat(bestBid.price) : null);

  // Prix effectif de l'ordre : LIMIT = prix saisi, MARKET = prix du carnet.
  const effectivePrice =
    orderType === "LIMIT" && price
      ? parseFloat(price)
      : marketPrice;

  // Total à payer (achat) / à recevoir (vente).
  const total = effectivePrice ? qty * effectivePrice : null;

  // L'ordre va-t-il s'exécuter immédiatement ?
  let willExecute = false;
  let waitingHint = "";
  if (orderType === "MARKET" && marketPrice) {
    willExecute = true;
  } else if (orderType === "LIMIT" && price && marketPrice) {
    const p = parseFloat(price);
    if (side === "BUY" && p >= marketPrice) {
      willExecute = true;
    } else if (side === "SELL" && p <= marketPrice) {
      willExecute = true;
    } else {
      willExecute = false;
      waitingHint = side === "BUY"
        ? `Prix trop bas : le marché est à ${mga(marketPrice)} Ar. Cet ordre restera en attente jusqu'à ce qu'un vendeur accepte.`
        : `Prix trop haut : le marché est à ${mga(marketPrice)} Ar. Cet ordre restera en attente jusqu'à ce qu'un acheteur accepte.`;
    }
  } else if (orderType === "LIMIT" && price && !marketPrice) {
    waitingHint = "Carnet vide côté opposé : votre ordre sera en attente.";
  }

  return (
    <div className="card space-y-4">
      {/* Sélecteur OUI/NON */}
      <OutcomeButtons market={market} value={outcome} onChange={setOutcome} />

      {/* Buy / Sell */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 border border-zinc-200 p-1">
        {(["BUY", "SELL"] as OrderSide[]).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={cx(
              "rounded-lg py-2.5 text-[10px] font-bold uppercase tracking-wider transition",
              side === s
                ? s === "BUY"
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-rose-500 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-800"
            )}
          >
            {s === "BUY" ? "Acheter" : "Vendre"}
          </button>
        ))}
      </div>

      {/* Limit / Market */}
      <div className="grid grid-cols-2 gap-2">
        {(["LIMIT", "MARKET"] as OrderType[]).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            className={cx(
              "rounded-lg border py-2 text-[10px] font-bold uppercase tracking-widest transition",
              orderType === t
                ? "border-zinc-800 bg-zinc-800 text-white"
                : "border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
            )}
          >
            {t === "LIMIT" ? "Limite" : "Au marché"}
          </button>
        ))}
      </div>

      {orderType === "LIMIT" && (
        <PriceInput
          value={price}
          onChange={setPrice}
          hint={
            marketPrice
              ? `Prix du marché : ${mga(marketPrice)} Ar (${pctOf(marketPrice)}). Offrez ce prix ou plus pour acheter immédiatement.`
              : "Aucun ordre opposé pour l'instant : votre prix sera en attente."
          }
        />
      )}
      <QuantityInput value={quantity} onChange={setQuantity} />

      {/* Avertissement : ordre qui restera en attente (prix non exécutable) */}
      {waitingHint && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-[11px] font-semibold text-amber-700 leading-snug">
          ⏳ {waitingHint}
        </div>
      )}

      {/* Avertissement spécial MARKET sans liquidité : le joueur doit comprendre
          que son ordre ne pourra pas s'exécuter (carnet vide côté opposé). */}
      {orderType === "MARKET" && !marketPrice && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3.5 py-2.5 text-[11px] font-semibold text-rose-700 leading-snug">
          ⚠️ Carnet vide : aucun ordre de {side === "BUY" ? "vente" : "achat"} sur {outcome === "YES" ? "OUI" : "NON"}.
          Un ordre au marché sera rejeté. Utilisez « Émettre » (Mint) pour créer des parts,
          ou placez un ordre LIMIT pour attendre une contrepartie.
        </div>
      )}

      {/* Récap clair façon Polymarket */}
      {total !== null && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 space-y-2">
          {/* Ligne principale : Total à payer / à recevoir */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500">
              {side === "BUY" ? "Total à payer" : "Total à recevoir"}
            </span>
            <span className={cx(
              "font-display text-lg font-black tracking-tight",
              side === "BUY" ? "text-blue-600" : "text-emerald-600"
            )}>
              {mga(String(total))} Ar
            </span>
          </div>

          {/* Détail : prix × quantité */}
          <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-450">
            <span>
              {effectivePrice && mga(String(effectivePrice))} Ar × {qty} part{qty > 1 ? "s" : ""}
            </span>
            <span>
              {willExecute ? "✓ exécuté maintenant" : "en attente"}
            </span>
          </div>

          {/* Gain potentiel à la résolution (achat) */}
          {side === "BUY" && (
            <div className="border-t border-zinc-200/60 pt-2 space-y-1">
              <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-450">
                <span>Si {outcome === "YES" ? "OUI" : "NON"} gagne</span>
                <span className="font-bold text-emerald-600 font-display">
                  +{mga(String(qty * 5000))} Ar
                </span>
              </div>
              <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-450">
                <span>Bénéfice net potentiel</span>
                <span className="font-bold text-emerald-600 font-display">
                  +{mga(String(qty * 5000 - total))} Ar
                </span>
              </div>
              {willExecute && total > 0 && (
                <div className="text-[9px] text-zinc-500 leading-relaxed normal-case font-medium pt-0.5">
                  Chaque part vaut 5000 Ar si {outcome === "YES" ? "OUI" : "NON"} gagne, 0 Ar sinon.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mini-carnet : meilleurs prix disponibles pour le côté sélectionné */}
      {ob && (ob.asks.length > 0 || ob.bids.length > 0) && (
        <div className="rounded-xl border border-zinc-200 overflow-hidden">
          <p className="bg-zinc-50 px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-widest text-zinc-400">
            Carnet — {outcome === "YES" ? "OUI" : "NON"}
          </p>
          <div className="divide-y divide-zinc-100">
            {ob.asks.slice(0, 3).map((l, i) => (
              <div key={`a${i}`} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Vente</span>
                <span className="flex items-center gap-2">
                  <span className="font-display text-xs font-black text-rose-600">{arPrice(l.price)} Ar</span>
                  <span className="text-[10px] text-zinc-500">{l.quantity}</span>
                </span>
              </div>
            ))}
            {ob.bids.slice(0, 3).map((l, i) => (
              <div key={`b${i}`} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">Achat</span>
                <span className="flex items-center gap-2">
                  <span className="font-display text-xs font-black text-blue-600">{arPrice(l.price)} Ar</span>
                  <span className="text-[10px] text-zinc-500">{l.quantity}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-xs font-semibold text-rose-600">
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={submitting}
        className={cx(
          "btn w-full",
          side === "BUY" ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-rose-500 hover:bg-rose-600 text-white"
        )}
      >
        {submitting
          ? "Traitement…"
          : total !== null
            ? `${side === "BUY" ? "Acheter" : "Vendre"} ${qty} part${qty > 1 ? "s" : ""} ${outcome === "YES" ? "OUI" : "NON"} — ${mga(String(total))} Ar`
            : `${side === "BUY" ? "Acheter" : "Vendre"} ${qty} ${outcome === "YES" ? "OUI" : "NON"}`}
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Mint / Merge (Split / Merge — collatéralisation)
// --------------------------------------------------------------------------

function MintMergePanel({ market, onChanged }: { market: Market; onChanged: () => void }) {
  const [mode, setMode] = useState<"mint" | "merge">("mint");
  const [count, setCount] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function submit() {
    setError("");
    setSubmitting(true);
    try {
      const c = parseInt(count, 10);
      if (mode === "mint") {
        await api.mint(market.id, c);
        setDone(`${c} paire(s) YES+NO émise(s).`);
      } else {
        await api.merge(market.id, c);
        setDone(`${c} paire(s) fusionnée(s) : ${c * 5000} Ar restitué(s).`);
      }
      setTimeout(onChanged, 1100);
    } catch (e) {
      setError(humanize(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <SuccessCard title="Opération réussie" message={done} />;

  const c = parseInt(count || "0", 10) || 0;

  return (
    <div className="card space-y-4">
      <h2 className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
        Émission / Fusion de paires
      </h2>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 border border-zinc-200 p-1">
        {([
          { k: "mint", label: "Émettre (Split)" },
          { k: "merge", label: "Fusionner (Merge)" },
        ] as { k: "mint" | "merge"; label: string }[]).map((t) => (
          <button
            key={t.k}
            onClick={() => setMode(t.k)}
            className={cx(
              "rounded-lg py-2.5 text-[10px] font-bold uppercase tracking-wider transition",
              mode === t.k ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <QuantityInput value={count} onChange={setCount} label="Nombre de paires" />

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 space-y-1.5">
        <div className="flex justify-between">
          <span>{mode === "mint" ? "Débité du wallet" : "Restitué au wallet"}</span>
          <span className={cx("font-extrabold font-display", mode === "mint" ? "text-blue-600" : "text-emerald-600")}>
            {mode === "mint" ? "−" : "+"}{mga(String(c))} MGA
          </span>
        </div>
        <div className="flex justify-between text-[10px] text-zinc-450">
          <span>Parts générées / détruites</span>
          <span className="font-bold text-zinc-650 font-display">
            {c} OUI + {c} NON
          </span>
        </div>
        <p className="mt-1.5 text-[9px] text-zinc-500 leading-relaxed border-t border-zinc-200/60 pt-2 normal-case font-medium">
          {mode === "mint"
            ? "1 MGA séquestré par paire → 1 part OUI + 1 part NON. Garantie : la plateforme ne porte aucun risque de caisse."
            : "En fusionnant 1 OUI + 1 NON, vous récupérez exactement 1,00 MGA du séquestre, à tout moment."}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-xs font-semibold text-rose-600">
          {error}
        </div>
      )}

      <button onClick={submit} disabled={submitting} className="btn-primary w-full">
        {submitting
          ? "Traitement…"
          : mode === "mint"
            ? `Émettre ${c} paire(s)`
            : `Fusionner ${c} paire(s)`}
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Vue Carnet d'ordres (lecture)
// --------------------------------------------------------------------------

function OrderBookView({ book }: { book: OrderBook[] | null }) {
  if (!book)
    return (
      <div className="card text-center py-8 text-xs font-semibold uppercase tracking-wider text-zinc-450">
        Carnet indisponible.
      </div>
    );

  return (
    <div className="space-y-3">
      {book.map((ob) => (
        <div key={ob.outcome} className="card space-y-2">
          <div className="flex items-center justify-between">
            <h3 className={cx("text-[10px] font-black uppercase tracking-widest", ob.outcome === "YES" ? "text-blue-600" : "text-rose-600")}>
              {ob.outcome === "YES" ? "OUI" : "NON"}
            </h3>
            {ob.last_price && (
              <span className="text-[10px] font-bold text-zinc-500">
                Dernier : {arPrice(ob.last_price)} Ar
              </span>
            )}
          </div>

          <BookSide title="Ventes (asks)" rows={ob.asks} tone="no" />
          <BookSide title="Achats (bids)" rows={ob.bids} tone="yes" />

          {ob.bids.length === 0 && ob.asks.length === 0 && (
            <p className="text-center text-[10px] text-zinc-400 py-2">Carnet vide.</p>
          )}
          {ob.spread && (
            <p className="text-center text-[9px] text-zinc-400 uppercase tracking-wider">
              Spread : {arPrice(ob.spread)} Ar
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function BookSide({
  title, rows, tone,
}: {
  title: string; rows: { price: string; quantity: number }[]; tone: "yes" | "no";
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">{title}</p>
      <div className="space-y-0.5">
        {rows.slice(0, 6).map((r, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5">
            <span className={cx("font-display text-xs font-black", tone === "yes" ? "text-blue-600" : "text-rose-600")}>
              {arPrice(r.price)} Ar
            </span>
            <span className="text-[11px] font-semibold text-zinc-600">{r.quantity}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================================================
// Sous-composants UI réutilisables
// ==========================================================================

function outcomeStyles(o: Outcome, selected: boolean): string {
  if (selected) {
    return o === "YES"
      ? "bg-blue-600 border-blue-600 text-white font-extrabold shadow-sm"
      : "bg-rose-500 border-rose-500 text-white font-extrabold shadow-sm";
  }
  return o === "YES"
    ? "bg-blue-50/50 border-blue-100/80 text-blue-600 hover:bg-blue-50/80"
    : "bg-rose-50/50 border-rose-100/80 text-rose-600 hover:bg-rose-50/80";
}

function OutcomeButtons({
  market, value, onChange,
}: {
  market: Market; value: Outcome; onChange: (o: Outcome) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {(["YES", "NO"] as Outcome[]).map((o) => {
        const selected = value === o;
        const pct = Math.round(parseFloat(o === "YES" ? market.proba_yes : market.proba_no) * 100);
        // Prix indicatif dérivé du pourcentage (1 part = 5000 Ar).
        const price = Math.round(pct / 100 * 5000);
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={cx(
              "rounded-xl border p-4.5 text-center transition-all duration-300 active:scale-[0.96] flex flex-col items-center justify-center gap-1 font-display",
              outcomeStyles(o, selected)
            )}
          >
            <span className="text-xs tracking-widest font-black uppercase">{o === "YES" ? "OUI" : "NON"}</span>
            <span className={cx("text-[10px] font-bold tracking-wider mt-0.5", selected ? "text-white/85" : "text-zinc-500")}>
              {price} Ar · {pct}%
            </span>
          </button>
        );
      })}
    </div>
  );
}

function QuantityInput({
  value, onChange, label = "Quantité (parts)",
}: {
  value: string; onChange: (v: string) => void; label?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="label">{label}</label>
      <input
        className="input"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
      />
    </div>
  );
}

function PriceInput({
  value, onChange, hint,
}: {
  value: string; onChange: (v: string) => void; hint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="label !mb-0">Prix limite (Ar par part)</label>
        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">1 à 4999 Ar</span>
      </div>
      <div className="relative">
        <input
          className="input pr-16"
          inputMode="numeric"
          value={value}
          placeholder="3000"
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, "");
            const n = parseInt(v, 10);
            if (!Number.isNaN(n)) onChange(String(Math.min(4999, Math.max(0, n))));
            else onChange(v);
          }}
        />
        {value && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            {arPrice(value)} Ar
          </span>
        )}
      </div>
      {hint && (
        <p className="text-[9px] font-semibold text-zinc-400 leading-snug">{hint}</p>
      )}
      <div className="flex gap-2">
        {[1250, 2500, 3750].map((p) => (
          <button
            key={p}
            onClick={() => onChange(String(p))}
            className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 text-[10px] font-extrabold uppercase tracking-widest text-zinc-650 hover:bg-zinc-100 hover:border-zinc-300 transition duration-300"
          >
            {p} Ar
          </button>
        ))}
      </div>
    </div>
  );
}

function SuccessCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="card text-center py-8 space-y-2.5 bg-white border border-zinc-200">
      <CheckCircle2 className="mx-auto h-9 w-9 text-blue-600 stroke-[1.5px]" />
      <p className="font-bold text-zinc-900 text-xs uppercase tracking-wider font-display">{title}</p>
      <p className="text-[11px] text-zinc-500 font-semibold">{message}</p>
    </div>
  );
}

function humanize(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.detail as { detail?: string } | null;
    if (d?.detail) return d.detail;
    if (e.status === 400) return "Solde ou parts insuffisants, ou ordre invalide.";
  }
  return "Une erreur est survenue.";
}
