import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../store/auth";
import { mga } from "../lib/format";
import { cx } from "../lib/format";
import { BarChart3, Layers, Wallet, User, HelpCircle, Search, Globe, CloudSun, Share2, TrendingUp, Trophy } from "lucide-react";
import type { ComponentType } from "react";
import type { User as AuthUser } from "../api/types";

const NAV = [
  { to: "/", label: "Marchés", icon: BarChart3 },
  { to: "/bets", label: "Mes positions", icon: Layers, auth: true },
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

const isActive = (to: string, pathname: string) =>
  pathname === to || (to !== "/" && pathname.startsWith(to));

// --------------------------------------------------------------------------
// Header (barre supérieure)
// --------------------------------------------------------------------------
function Header({ user }: { user: AuthUser | null }) {
  const loc = useLocation();
  const authItems = NAV.filter((n) => n.auth);

  return (
    <header className="sticky top-0 z-20 w-full border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-[1400px] w-full flex items-center justify-between px-4 md:px-8 h-14">
        <div className="flex items-center gap-5">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <img src="/favicon.svg" alt="" className="h-7 w-7 filter invert" />
            <span className="text-[17px] font-black tracking-tight text-zinc-900">Nexus</span>
          </Link>
          <div className="hidden lg:flex items-center gap-2.5 bg-zinc-100 border border-zinc-200/60 rounded-full px-4 py-2 w-[380px]">
            <Search className="h-4 w-4 text-zinc-400 shrink-0" />
            <span className="text-sm text-zinc-400 font-normal select-none">Search nexus...</span>
            <span className="ml-auto shrink-0 bg-white border border-zinc-200 px-1.5 py-0.5 rounded text-[10px] text-zinc-400 font-mono leading-none">/</span>
          </div>
        </div>

        <div className="flex items-center gap-5">
          <Link to="/how-it-works" className="hidden md:flex items-center gap-1.5 text-sm font-medium text-zinc-700 hover:text-zinc-900 transition">
            <HelpCircle className="h-4 w-4 text-blue-600" />
            <span>Comment ça marche</span>
          </Link>

          {user ? (
            <div className="flex items-center gap-3">
              {authItems.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cx(
                    "hidden md:inline text-sm font-medium transition",
                    isActive(n.to, loc.pathname) ? "text-zinc-900 font-semibold" : "text-zinc-600 hover:text-zinc-900"
                  )}
                >
                  {n.label}
                </Link>
              ))}
              <Link to="/wallet" className="rounded-full bg-blue-50 border border-blue-100 px-4 py-1.5 text-sm font-bold text-blue-600 hover:bg-blue-100 transition duration-200">
                {mga(user.available_balance)} MGA
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Link to="/login" className="text-sm font-medium text-zinc-700 hover:text-zinc-900 transition">Connexion</Link>
              <Link to="/register" className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 text-sm font-bold rounded-full transition duration-200">S'inscrire</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// --------------------------------------------------------------------------
// Barre de catégories
// --------------------------------------------------------------------------
function CategoryBar() {
  const loc = useLocation();
  return (
    <div className="w-full border-b border-zinc-200 bg-white">
      <div className="mx-auto max-w-[1400px] w-full flex items-center overflow-x-auto scrollbar-none px-4 md:px-8 h-10">
        {CATS.map((c, i) => {
          const active = loc.pathname === "/" && (loc.search === `?cat=${c.key}` || (!c.key && !loc.search));
          return (
            <div key={c.key || "all"} className="flex items-center shrink-0">
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
  );
}

// --------------------------------------------------------------------------
// Footer
// --------------------------------------------------------------------------
const FOOTER_COLUMNS = [
  {
    title: "Produit",
    links: [
      { label: "Marchés", to: "/" },
      { label: "Mes paris", to: "/bets" },
      { label: "Portefeuille", to: "/wallet" },
      { label: "Déposer", to: "/wallet/deposit" },
      { label: "Retirer", to: "/wallet/withdraw" },
    ],
  },
  {
    title: "Ressources",
    links: [
      { label: "Comment ça marche", to: "/how-it-works" },
      { label: "Mon compte", to: "/account" },
    ],
  },
];

function FooterLink({ label, to }: { label: string; to: string }) {
  const isInternal = to.startsWith("/");
  const cls = "text-sm text-zinc-500 hover:text-zinc-900 transition";
  return isInternal ? (
    <li><Link to={to} className={cls}>{label}</Link></li>
  ) : (
    <li><a href={to} className={cls}>{label}</a></li>
  );
}

function Footer() {
  return (
    <footer className="hidden md:block w-full border-t border-zinc-200 bg-white mt-16">
      <div className="mx-auto max-w-[1400px] w-full px-4 md:px-8 py-12">
        <div className="grid grid-cols-2 gap-12 max-w-md">
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold text-zinc-900 mb-5">{col.title}</h4>
              <ul className="space-y-3">
                {col.links.map((l) => <FooterLink key={l.label} label={l.label} to={l.to} />)}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-zinc-100 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-5 w-5 filter invert opacity-30" />
            <span className="text-sm font-semibold text-zinc-400">Nexus</span>
            <span className="text-sm text-zinc-400">© {new Date().getFullYear()}</span>
          </div>
          <p className="text-sm text-zinc-400">Plateforme de prédiction en Ariary. Tous droits réservés.</p>
        </div>
      </div>
    </footer>
  );
}

// --------------------------------------------------------------------------
// Navigation mobile
// --------------------------------------------------------------------------
function MobileNav({ items }: { items: typeof NAV }) {
  const loc = useLocation();
  return (
    <nav className="md:hidden fixed bottom-0 left-1/2 z-20 flex w-full max-w-md -translate-x-1/2 items-stretch justify-around border-t border-zinc-200 bg-white/95 backdrop-blur py-1.5">
      {items.map((n) => {
        const Icon = n.icon as ComponentType<{ className?: string }>;
        const active = isActive(n.to, loc.pathname);
        return (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={cx(
              "flex flex-1 flex-col items-center gap-1 py-1 text-[10px] font-bold tracking-wide uppercase transition",
              active ? "text-blue-600" : "text-zinc-400 hover:text-zinc-650"
            )}
          >
            <Icon className={cx("h-5 w-5 transition", active ? "stroke-[2.5px] text-blue-600" : "stroke-[1.8px] text-zinc-400")} />
            {n.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

// --------------------------------------------------------------------------
// Layout principal — assemblage
// --------------------------------------------------------------------------
export default function Layout() {
  const { user } = useAuth();
  const items = NAV.filter((n) => !n.auth || user);

  return (
    <div className="min-h-full flex flex-col bg-slate-50 text-zinc-900">
      <Header user={user} />
      <CategoryBar />
      <main className="mx-auto max-w-[1400px] w-full flex-1 pb-28 md:pb-8 pt-6 px-4 md:px-8">
        <Outlet />
      </main>
      <Footer />
      {user && <MobileNav items={items} />}
    </div>
  );
}
