import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { ReferralInfo } from "../api/types";
import { Spinner, Badge } from "../components/ui";
import { mga, dateFr, cx } from "../lib/format";
import { Gift, Copy, Check, Users, Trophy, Wallet, Share2 } from "lucide-react";

export default function ReferralPage() {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    api.referral().then(setInfo).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const code = info?.code;
  const link = info?.link ? `${window.location.origin}${info.link}` : null;

  async function copy(text: string, what: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback : sélection manuelle (téléphones anciens).
    }
  }

  async function share() {
    if (!code || !link) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Nexus — Paris en Ariary",
          text: `Rejoins-moi sur Nexus et reçois 500 Ar de bonus au 1er dépôt avec mon code : ${code}`,
          url: link,
        });
      } catch { /* partage annulé */ }
    } else {
      copy(link, "link");
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-black uppercase tracking-tight text-zinc-900">
          <Gift className="h-6 w-6 text-emerald-500" /> Parrainage
        </h1>
        <p className="mt-1 text-xs font-bold uppercase tracking-wider text-zinc-500">
          Invitez vos amis, gagnez 500 Ar chacun
        </p>
      </header>

      {/* Comment ça marche */}
      <section className="card space-y-2">
        <p className="text-xs font-black uppercase tracking-wider text-zinc-400">Comment ça marche</p>
        <ol className="space-y-2 text-sm text-zinc-700">
          <Step n={1}>Partagez votre code ou votre lien à un ami.</Step>
          <Step n={2}>Il s'inscrit avec votre code et fait son 1er dépôt.</Step>
          <Step n={3}>
            Vous recevez <b className="text-emerald-600">chacun 500 Ar</b> de bonus.
          </Step>
        </ol>
        <p className="text-[10px] font-medium text-amber-600 leading-relaxed border-t border-amber-200/60 pt-2 mt-1">
          ⚠️ Le bonus doit être misé au moins une fois avant de pouvoir être retiré.
        </p>
      </section>

      {/* Code + lien partageable */}
      {code ? (
        <section className="card space-y-3">
          <p className="text-xs font-black uppercase tracking-wider text-zinc-400">Votre code</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-xl bg-zinc-900 px-4 py-3 text-center font-display text-2xl font-black tracking-widest text-white">
              {code}
            </code>
            <button
              onClick={() => copy(code, "code")}
              className="btn-secondary !px-3"
              title="Copier le code"
            >
              {copied === "code" ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          {link && (
            <button onClick={share} className="btn w-full bg-emerald-600 text-white hover:bg-emerald-700">
              <Share2 className="h-4 w-4 mr-1.5" /> Partager mon lien
            </button>
          )}
        </section>
      ) : (
        <section className="card text-center">
          <p className="text-sm text-zinc-500">Votre code de parrainage n'est pas encore disponible.</p>
          <p className="text-[11px] text-zinc-400 mt-1">Rechargez la page dans un instant.</p>
        </section>
      )}

      {/* Stats */}
      {info && (
        <section className="grid grid-cols-3 gap-2">
          <Stat icon={Users} label="Invités" value={info.stats.invited} />
          <Stat icon={Trophy} label="Récompensés" value={info.stats.rewarded} tone="emerald" />
          <Stat icon={Wallet} label="Gagnés (Ar)" value={mga(info.stats.total_earned)} tone="emerald" />
        </section>
      )}

      {/* Liste des filleuls */}
      {info && info.referrals.length > 0 && (
        <section className="card space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-zinc-400">Vos filleuls</p>
          <ul className="divide-y divide-zinc-100">
            {info.referrals.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-bold text-zinc-800">{r.display_name}</p>
                  <p className="text-[10px] text-zinc-400 font-medium">
                    {r.phone_masked && <span className="font-mono">{r.phone_masked} · </span>}
                    Inscrit le {dateFr(r.created_at)}
                  </p>
                </div>
                {r.status === "REWARDED" ? (
                  <Badge tone="info">+{mga(r.reward_amount)} Ar</Badge>
                ) : (
                  <Badge tone="warn">En attente</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-emerald-100 text-[10px] font-black text-emerald-600">
        {n}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

const TONE: Record<string, string> = {
  default: "text-zinc-900",
  emerald: "text-emerald-600",
};

function Stat({
  icon: Icon, label, value, tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string | number; tone?: keyof typeof TONE;
}) {
  return (
    <div className="card !p-3 text-center">
      <Icon className={cx("mx-auto h-4 w-4 mb-1", TONE[tone])} />
      <p className={cx("font-display text-lg font-black", TONE[tone])}>{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
    </div>
  );
}
