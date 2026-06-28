import { Link } from "react-router-dom";
import { TrendingUp, Wallet, CheckCircle, ArrowRight, Shield, Zap, BarChart3 } from "lucide-react";

const STEPS = [
  {
    step: "01",
    icon: Wallet,
    title: "Créez votre compte & déposez",
    desc: "Inscrivez-vous en quelques secondes, puis alimentez votre portefeuille en Ariary (MGA) via mobile money ou virement bancaire.",
  },
  {
    step: "02",
    icon: BarChart3,
    title: "Choisissez un marché",
    desc: "Parcourez les marchés de prédiction disponibles — météo, tendances, réseaux sociaux — et trouvez un événement qui vous intéresse.",
  },
  {
    step: "03",
    icon: TrendingUp,
    title: "Pariez OUI ou NON",
    desc: "Misez sur l'issue que vous pensez la plus probable. Le prix reflète la probabilité perçue par la communauté en temps réel.",
  },
  {
    step: "04",
    icon: CheckCircle,
    title: "Récoltez vos gains",
    desc: "Quand l'événement se résout, si votre prédiction est correcte vous recevez automatiquement vos gains dans votre portefeuille.",
  },
];

const FEATURES = [
  {
    icon: Shield,
    title: "Sécurisé",
    desc: "Vos fonds sont protégés. Chaque transaction est tracée et vérifiable dans votre historique.",
  },
  {
    icon: Zap,
    title: "Instantané",
    desc: "Placez un pari en moins de 5 secondes. Les gains sont crédités immédiatement après résolution.",
  },
  {
    icon: BarChart3,
    title: "Transparent",
    desc: "Les probabilités sont déterminées par le marché. Aucune manipulation, tout est visible publiquement.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-16 py-4">
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="text-3xl md:text-4xl font-black text-zinc-900 tracking-tight">
          Comment ça marche ?
        </h1>
        <p className="text-lg text-zinc-500 max-w-xl mx-auto leading-relaxed">
          Seer est une plateforme de marchés de prédiction. Pariez sur des
          événements réels et gagnez si votre prédiction est correcte.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-6">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={s.step}
              className="flex items-start gap-5 bg-white border border-zinc-200 rounded-2xl p-6 hover:border-zinc-300 transition-all duration-300"
            >
              <div className="shrink-0 flex items-center justify-center h-12 w-12 rounded-xl bg-blue-50 text-blue-600">
                <Icon className="h-6 w-6" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                    Étape {s.step}
                  </span>
                  <h3 className="text-base font-semibold text-zinc-900">{s.title}</h3>
                </div>
                <p className="text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Example */}
      <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-8 space-y-5">
        <h2 className="text-xl font-bold text-zinc-900">Exemple concret</h2>
        <div className="space-y-4 text-sm text-zinc-600 leading-relaxed">
          <p>
            Imaginons un marché :{" "}
            <span className="font-semibold text-zinc-900">
              « Est-ce qu'il va pleuvoir à Antananarivo demain ? »
            </span>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <span className="font-semibold text-zinc-900">Vous pariez OUI</span>
              </div>
              <p className="text-zinc-500">
                Vous misez <span className="font-bold text-zinc-700">10 000 MGA</span> sur
                OUI à une cote de 65%.
              </p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="font-semibold text-zinc-900">Il pleut !</span>
              </div>
              <p className="text-zinc-500">
                Vous recevez <span className="font-bold text-emerald-600">15 385 MGA</span> —
                un gain net de <span className="font-bold text-emerald-600">5 385 MGA</span>.
              </p>
            </div>
          </div>
          <p className="text-zinc-500">
            Si il ne pleut pas, vous perdez votre mise de 10 000 MGA. C'est aussi
            simple que ça.
          </p>
        </div>
      </div>

      {/* Features */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold text-zinc-900 text-center">
          Pourquoi Seer ?
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="bg-white border border-zinc-200 rounded-2xl p-6 space-y-3 text-center hover:border-zinc-300 transition"
              >
                <div className="mx-auto flex items-center justify-center h-10 w-10 rounded-xl bg-blue-50 text-blue-600">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-zinc-900">{f.title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center space-y-4 pb-8">
        <h2 className="text-xl font-bold text-zinc-900">Prêt à prédire ?</h2>
        <div className="flex items-center justify-center gap-4">
          <Link
            to="/register"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 text-sm font-bold rounded-full transition duration-200"
          >
            Créer un compte <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition"
          >
            Explorer les marchés
          </Link>
        </div>
      </div>
    </div>
  );
}
