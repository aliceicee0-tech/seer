// Petits utilitaires de présentation partagés par les pages admin.
import type {
  DepositStatus, MarketStatus, MarketStatus as MS, WithdrawStatus,
} from "../api/types";
import { Badge } from "./ui";

const MARKET_TONE: Record<MarketStatus, "neutral" | "yes" | "no" | "warn" | "info"> = {
  DRAFT: "neutral",
  OPEN: "yes",
  LOCKED: "warn",
  RESOLVING: "info",
  RESOLVED: "neutral",
  CANCELLED: "no",
  FROZEN: "no",
};

const MARKET_LABEL: Record<MarketStatus, string> = {
  DRAFT: "Brouillon",
  OPEN: "Ouvert",
  LOCKED: "Clôturé",
  RESOLVING: "Résolution",
  RESOLVED: "Résolu",
  CANCELLED: "Annulé",
  FROZEN: "Gelé",
};

// Tons visuels par statut de dépôt : vert si approuvé, rouge si rejeté, ambre sinon.
const DEPOSIT_TONE: Record<DepositStatus, "yes" | "no" | "warn"> = {
  PENDING: "warn",
  APPROVED: "yes",
  REJECTED: "no",
};

// Tons visuels par statut de retrait : vert si payé, rouge si rejeté, ambre sinon.
const WITHDRAW_TONE: Record<WithdrawStatus, "yes" | "no" | "warn"> = {
  PENDING: "warn",
  PAID: "yes",
  REJECTED: "no",
};

export function MarketStatusBadge({ status }: { status: MS }) {
  return <Badge tone={MARKET_TONE[status]}>{MARKET_LABEL[status]}</Badge>;
}

export function DepositStatusBadge({
  status, label,
}: {
  status: DepositStatus; label: string;
}) {
  return <Badge tone={DEPOSIT_TONE[status]}>{label}</Badge>;
}

export function WithdrawStatusBadge({
  status, label,
}: {
  status: WithdrawStatus; label: string;
}) {
  return <Badge tone={WITHDRAW_TONE[status]}>{label}</Badge>;
}
