import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";
import { dateFr } from "../lib/format";
import { Settings, LogOut, ShieldCheck } from "lucide-react";

export default function AccountPage() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-black uppercase tracking-tight text-white">Mon compte</h1>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-950 border border-zinc-800 text-lg font-black text-white">
            {(user.display_name || user.phone).charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-white text-base">{user.display_name || "Joueur"}</p>
            <p className="text-xs text-zinc-550 font-semibold">{user.phone}</p>
          </div>
        </div>
        <div className="border-t border-zinc-850 pt-3 text-xs text-zinc-500 font-semibold uppercase tracking-wider space-y-1">
          <p>Membre depuis le {dateFr(user.date_joined)}</p>
          {user.is_platform_admin && (
            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-zinc-300 font-bold bg-zinc-950 border border-zinc-850 px-2 py-0.5 rounded">
              <ShieldCheck className="h-3.5 w-3.5" /> Administrateur
            </p>
          )}
        </div>
      </div>

      {user.is_platform_admin && (
        <Link to="/admin" className="btn-secondary w-full flex items-center justify-center gap-2 py-3">
          <Settings className="h-4 w-4" /> Dashboard administrateur
        </Link>
      )}

      <button
        onClick={() => {
          logout();
          nav("/");
        }}
        className="btn-primary w-full flex items-center justify-center gap-2 py-3 bg-white text-black hover:bg-zinc-200"
      >
        <LogOut className="h-4 w-4" /> Se déconnecter
      </button>

      <p className="pt-4 text-center text-[10px] font-bold uppercase tracking-widest text-zinc-650">
        Seer v1.0 • Prédictions Madagascar
      </p>
    </div>
  );
}
