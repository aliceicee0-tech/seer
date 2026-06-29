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

export function MarketStatusBadge({ status }: { status: MS }) {
  return <Badge tone={MARKET_TONE[status]}>{MARKET_LABEL[status]}</Badge>;
}

export function DepositStatusBadge({
  status, label,
}: {
  status: DepositStatus; label: string;
}) {
  const tone =
    status === "APPROVED" ? "yes" :
    status === "REJECTED" ? "no" : "warn";
  return <Badge tone={tone as "yes" | "no" | "warn"}>{label}</Badge>;
}

export function WithdrawStatusBadge({
  status, label,
}: {
  status: WithdrawStatus; label: string;
}) {
  const tone =
    status === "PAID" ? "yes" :
    status === "REJECTED" ? "no" : "warn";
  return <Badge tone={tone as "yes" | "no" | "warn"}>{label}</Badge>;
}
