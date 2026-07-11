import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";

export default function LoginPage() {
  const { login, loading, error, clearError } = useAuth();
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(phone, password);
      nav("/");
    } catch {
      /* erreur affichée via le store */
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-black uppercase tracking-tight text-zinc-900">Connexion</h1>
      <p className="mb-6 text-xs font-bold uppercase tracking-wider text-zinc-500">
        Accédez à vos paris et votre wallet
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Numéro de téléphone</label>
          <input
            className="input"
            inputMode="tel"
            placeholder="034 12 345 67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Mot de passe</label>
          <input
            className="input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-xs font-semibold text-rose-600">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs font-bold uppercase tracking-wider text-zinc-500">
        Pas encore de compte ?{" "}
        <Link to="/register" onClick={clearError} className="text-blue-600 hover:underline pl-1.5 font-black">
          Créer un compte
        </Link>
      </p>

      <div className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 text-xs text-zinc-500 space-y-1">
        <p className="font-bold text-zinc-700 uppercase tracking-wider text-[10px]">Compte démo</p>
        <p className="leading-relaxed">Téléphone : 0341234567 • Mot de passe : demo1234</p>
      </div>
    </div>
  );
}
