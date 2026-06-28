import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../store/auth";
import { mga } from "../lib/format";
import { cx } from "../lib/format";
import { BarChart3, Ticket, Wallet, User, HelpCircle, Search, Globe, CloudSun, Share2, TrendingUp, Trophy } from "lucide-react";

const NAV = [
  { to: "/", label: "Marchés", icon: BarChart3 },
  { to: "/bets", label: "Mes paris", icon: Ticket, auth: true },
  { to: "/wallet", label: "Wallet", icon: Wallet, auth: true },
  { to: "/account", label: "Compte", icon: User, auth: true },
];

const CATS = [
  { key: "", label: "Tous", icon: Globe },
  { key: "SPORTS", label: "Sport", icon: Trophy },
  { key: "WEATHER", label: "Météo", icon: CloudSun },
  { key: "SOCIAL", label: "Réseaux", icon: Share2 },
  { key: "TRENDING", label: "Tendances", icon: TrendingUp },
];

export default function Layout() {
  const { user } = useAuth();
  const loc = useLocation();

  // NB : le profil est désormais rechargé au démarrage (App.Bootstrapper),
  // pas besoin de fetchMe() ici.

  const items = NAV.filter((n) => !n.auth || user);

  return (
    <div className="min-h-full flex flex-col bg-slate-50 text-zinc-900">
      {/* ═══ Header Row 1 ═══ */}
      <header className="sticky top-0 z-20 w-full border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-[1400px] w-full flex items-center justify-between px-4 md:px-8 h-14">
          {/* Left cluster */}
          <div className="flex items-center gap-5">
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <img src="/favicon.svg" alt="" className="h-7 w-7 filter invert" />
              <span className="text-[17px] font-black tracking-tight text-zinc-900">Seer</span>
            </Link>

            {/* Search bar — wide like Polymarket */}
            <div className="hidden lg:flex items-center gap-2.5 bg-zinc-100 border border-zinc-200/60 rounded-full px-4 py-2 w-[380px]">
              <Search className="h-4 w-4 text-zinc-400 shrink-0" />
              <span className="text-sm text-zinc-400 font-normal select-none">Search seer...</span>
              <span className="ml-auto shrink-0 bg-white border border-zinc-200 px-1.5 py-0.5 rounded text-[10px] text-zinc-400 font-mono leading-none">/</span>
            </div>
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-5">
            <Link
              to="/how-it-works"
              className="hidden md:flex items-center gap-1.5 text-sm font-medium text-zinc-700 hover:text-zinc-900 transition"
            >
              <HelpCircle className="h-4 w-4 text-blue-600" />
              <span>Comment ça marche</span>
            </Link>

            {user ? (
              <div className="flex items-center gap-3">
                {items.filter(n => n.auth).map((n) => {
                  const isActive = loc.pathname === n.to || (n.to !== "/" && loc.pathname.startsWith(n.to));
                  return (
                    <Link
                      key={n.to}
                      to={n.to}
                      className={cx(
                        "hidden md:inline text-sm font-medium transition",
                        isActive ? "text-zinc-900 font-semibold" : "text-zinc-600 hover:text-zinc-900"
                      )}
                    >
                      {n.label}
                    </Link>
                  );
                })}
                <Link
                  to="/wallet"
                  className="rounded-full bg-blue-50 border border-blue-100 px-4 py-1.5 text-sm font-bold text-blue-600 hover:bg-blue-100 transition duration-200"
                >
                  {mga(user.available_balance)} MGA
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <Link to="/login" className="text-sm font-medium text-zinc-700 hover:text-zinc-900 transition">
                  Connexion
                </Link>
                <Link to="/register" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-sm font-bold rounded-full transition duration-200">
                  S'inscrire
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ═══ Header Row 2 — Categories ═══ */}
      <div className="w-full border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-[1400px] w-full flex items-center overflow-x-auto scrollbar-none px-4 md:px-8 h-10">
          {CATS.map((c, i) => {
            const active = loc.pathname === "/" && (loc.search === `?cat=${c.key}` || (!c.key && !loc.search));
            return (
              <div key={c.key} className="flex items-center shrink-0">
                {i > 0 && <span className="text-zinc-300 mx-3 select-none">|</span>}
                <Link
                  to={c.key ? `/?cat=${c.key}` : "/"}
                  className={cx(
                    "text-sm whitespace-nowrap transition-colors duration-200",
                    active ? "text-zinc-900 font-semibold" : "text-zinc-500 hover:text-zinc-900 font-normal"
                  )}
                >
                  {c.label}
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      {/* Contenu */}
      <main className="mx-auto max-w-[1400px] w-full flex-1 pb-28 md:pb-8 pt-6 px-4 md:px-8">
        <Outlet />
      </main>

      {/* ═══ Footer ═══ */}
      <footer className="hidden md:block w-full border-t border-zinc-200 bg-white mt-16">
        <div className="mx-auto max-w-[1400px] w-full px-4 md:px-8 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
            {/* Colonne 1 */}
            <div>
              <h4 className="text-sm font-semibold text-zinc-900 mb-5">Produit</h4>
              <ul className="space-y-3">
                <li><Link to="/" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Marchés</Link></li>
                <li><Link to="/bets" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Mes paris</Link></li>
                <li><Link to="/wallet" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Portefeuille</Link></li>
                <li><Link to="/wallet/deposit" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Déposer</Link></li>
                <li><Link to="/wallet/withdraw" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Retirer</Link></li>
              </ul>
            </div>

            {/* Colonne 2 */}
            <div>
              <h4 className="text-sm font-semibold text-zinc-900 mb-5">Ressources</h4>
              <ul className="space-y-3">
                <li><Link to="/how-it-works" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Comment ça marche</Link></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">FAQ</a></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Blog</a></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">API</a></li>
              </ul>
            </div>

            {/* Colonne 3 */}
            <div>
              <h4 className="text-sm font-semibold text-zinc-900 mb-5">Légal</h4>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Conditions d'utilisation</a></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Politique de confidentialité</a></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Règles de résolution</a></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Responsabilité</a></li>
              </ul>
            </div>

            {/* Colonne 4 */}
            <div>
              <h4 className="text-sm font-semibold text-zinc-900 mb-5">Communauté</h4>
              <ul className="space-y-3">
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Telegram</a></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Twitter / X</a></li>
                <li><a href="#" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Discord</a></li>
                <li><Link to="/account" className="text-sm text-zinc-500 hover:text-zinc-900 transition">Mon compte</Link></li>
              </ul>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="mt-12 pt-6 border-t border-zinc-100 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <img src="/favicon.svg" alt="" className="h-5 w-5 filter invert opacity-30" />
              <span className="text-sm font-semibold text-zinc-400">Seer</span>
              <span className="text-sm text-zinc-400">© {new Date().getFullYear()}</span>
            </div>
            <p className="text-sm text-zinc-400">
              Plateforme de prédiction en Ariary. Tous droits réservés.
            </p>
          </div>
        </div>
      </footer>

      {/* Barre de navigation inférieure (mobile-first, cache sur desktop) */}
      {user && (
        <nav className="md:hidden fixed bottom-0 left-1/2 z-20 flex w-full max-w-md -translate-x-1/2 items-stretch justify-around border-t border-zinc-200 bg-white/95 backdrop-blur py-1.5">
          {items.map((n) => {
            const Icon = n.icon;
            const isActive = loc.pathname === n.to || (n.to !== "/" && loc.pathname.startsWith(n.to));
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={() =>
                  cx(
                    "flex flex-1 flex-col items-center gap-1 py-1 text-[10px] font-bold tracking-wide uppercase transition",
                    isActive ? "text-blue-600" : "text-zinc-400 hover:text-zinc-650"
                  )
                }
              >
                <Icon className={cx("h-5 w-5 transition", isActive ? "stroke-[2.5px] text-blue-600" : "stroke-[1.8px] text-zinc-400")} />
                {n.label}
              </NavLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}
