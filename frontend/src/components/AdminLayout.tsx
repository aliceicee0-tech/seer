import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { cx } from "../lib/format";
import { BarChart3, ArrowDownCircle, ArrowUpCircle, Gavel, ArrowLeft } from "lucide-react";

const ADMIN_NAV = [
  { to: "/admin", label: "Accueil", icon: BarChart3, end: true },
  { to: "/admin/deposits", label: "Dépôts", icon: ArrowDownCircle },
  { to: "/admin/withdrawals", label: "Retraits", icon: ArrowUpCircle },
  { to: "/admin/markets", label: "Marchés", icon: Gavel },
];

export default function AdminLayout() {
  const loc = useLocation();
  return (
    <div className="mx-auto flex min-h-full max-w-7xl w-full flex-col bg-slate-50 text-zinc-900 px-4 md:px-8">
      {/* Header admin — distinct du header joueur */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white/90 py-3.5 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link to="/admin" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-7 w-7 filter invert" />
            <span className="rounded bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 text-[10px] font-mono font-bold text-zinc-650">
              ADMIN
            </span>
            <span className="text-lg font-extrabold tracking-tight text-zinc-900">Seer</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {ADMIN_NAV.map((n) => {
              const isActive = n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={cx(
                    "text-xs font-bold uppercase tracking-wider transition",
                    isActive ? "text-blue-600" : "text-zinc-500 hover:text-zinc-900"
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <Link to="/" className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="h-3 w-3" /> Vue joueur
        </Link>
      </header>

      <main className="flex-1 pb-28 md:pb-8 pt-6">
        <Outlet />
      </main>

      {/* Barre de navigation admin */}
      <nav className="md:hidden fixed bottom-0 left-1/2 z-20 flex w-full max-w-md -translate-x-1/2 items-stretch justify-around border-t border-zinc-200 bg-white/95 backdrop-blur py-1.5">
        {ADMIN_NAV.map((n) => {
          const Icon = n.icon;
          const isActive = n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to);
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
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
    </div>
  );
}
