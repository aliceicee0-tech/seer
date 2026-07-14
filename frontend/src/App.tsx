import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import AdminLayout from "./components/AdminLayout";
import { useAuth } from "./store/auth";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import MarketsPage from "./pages/MarketsPage";
import MarketDetailPage from "./pages/MarketDetailPage";
import MyBetsPage from "./pages/MyBetsPage";
import WalletPage from "./pages/WalletPage";
import DepositPage from "./pages/DepositPage";
import WithdrawPage from "./pages/WithdrawPage";
import AccountPage from "./pages/AccountPage";
import HistoryPage from "./pages/HistoryPage";
import HowItWorksPage from "./pages/HowItWorksPage";
import ReferralPage from "./pages/ReferralPage";
import AdminOverviewPage from "./pages/admin/AdminOverviewPage";
import AdminDepositsPage from "./pages/admin/AdminDepositsPage";
import AdminWithdrawalsPage from "./pages/admin/AdminWithdrawalsPage";
import AdminMarketsPage from "./pages/admin/AdminMarketsPage";
import AdminUsersPage from "./pages/admin/AdminUsersPage";
import AdminLedgerPage from "./pages/admin/AdminLedgerPage";

function Bootstrapper({ children }: { children: React.ReactNode }) {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);
  return <>{children}</>;
}

/**
 * Attend que l'authentification soit initialisée (profil rechargé depuis le
 * token persistant) avant de décider. Sans ça, un rafraîchissement direct sur
 * une route protégée redirige vers /login parce que `user` est encore null.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth();
  if (!initialized) return <BootSplash />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth();
  if (!initialized) return <BootSplash />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.is_platform_admin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function BootSplash() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-brand-400" />
    </div>
  );
}

export default function App() {
  return (
    <Bootstrapper>
      <Routes>
        {/* Section joueur */}
        <Route element={<Layout />}>
          <Route path="/" element={<MarketsPage />} />
          <Route path="/markets/:id" element={<MarketDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />

          <Route
            path="/bets"
            element={<RequireAuth><MyBetsPage /></RequireAuth>}
          />
          <Route
            path="/referral"
            element={<RequireAuth><ReferralPage /></RequireAuth>}
          />
          <Route
            path="/wallet"
            element={<RequireAuth><WalletPage /></RequireAuth>}
          />
          <Route
            path="/wallet/deposit"
            element={<RequireAuth><DepositPage /></RequireAuth>}
          />
          <Route
            path="/wallet/withdraw"
            element={<RequireAuth><WithdrawPage /></RequireAuth>}
          />
          <Route
            path="/history"
            element={<RequireAuth><HistoryPage /></RequireAuth>}
          />
          <Route
            path="/account"
            element={<RequireAuth><AccountPage /></RequireAuth>}
          />
        </Route>

        {/* Section administrateur (staff only) */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<RequireAdmin><AdminOverviewPage /></RequireAdmin>} />
          <Route path="/admin/deposits" element={<RequireAdmin><AdminDepositsPage /></RequireAdmin>} />
          <Route path="/admin/withdrawals" element={<RequireAdmin><AdminWithdrawalsPage /></RequireAdmin>} />
          <Route path="/admin/markets" element={<RequireAdmin><AdminMarketsPage /></RequireAdmin>} />
          <Route path="/admin/users" element={<RequireAdmin><AdminUsersPage /></RequireAdmin>} />
          <Route path="/admin/ledger" element={<RequireAdmin><AdminLedgerPage /></RequireAdmin>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Bootstrapper>
  );
}
