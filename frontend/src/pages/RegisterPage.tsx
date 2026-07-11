import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";

export default function RegisterPage() {
  const { register, loading, error, clearError } = useAuth();
  const nav = useNavigate();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await register(phone, password, name);
      nav("/");
    } catch {
      /* erreur gérée via le store */
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-1 text-2xl font-black uppercase tracking-tight text-zinc-900">Créer un compte</h1>
      <p className="mb-6 text-xs font-bold uppercase tracking-wider text-zinc-500">
        Inscrivez-vous avec votre numéro Mobile Money
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Numéro de téléphone (Mobile Money)</label>
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
          <label className="label">Nom affiché (optionnel)</label>
          <input
            className="input"
            placeholder="Votre pseudo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Mot de passe</label>
          <input
            className="input"
            type="password"
            placeholder="6 caractères minimum"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 px-3.5 py-2.5 text-xs font-semibold text-rose-600">
            {error}
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? "Création…" : "S'inscrire"}
        </button>
      </form>

      <p className="mt-6 text-center text-xs font-bold uppercase tracking-wider text-zinc-500">
        Déjà inscrit ?{" "}
        <Link to="/login" onClick={clearError} className="text-blue-600 hover:underline pl-1.5 font-black">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
