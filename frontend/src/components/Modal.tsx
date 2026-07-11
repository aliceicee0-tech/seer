import { type ReactNode, useEffect, useState } from "react";
import { cx } from "../lib/format";

/**
 * Modal réutilisable — remplace les dialogs natifs (alert/confirm/prompt)
 * bloquants et non-stylables. Accessible : fermeture par Esc + clic overlay.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={cx(
          "w-full rounded-2xl border border-zinc-200 bg-white shadow-2xl",
          size === "sm" ? "max-w-sm" : "max-w-md",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="border-b border-zinc-150 px-5 py-4">
            <h2 className="text-sm font-black uppercase tracking-tight text-zinc-900">{title}</h2>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Dialog de confirmation — remplace `confirm()`. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirmer",
  danger = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-zinc-650 leading-relaxed">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="btn bg-white hover:bg-zinc-50 text-zinc-600 border border-zinc-200 px-3.5 py-2 text-xs font-bold uppercase tracking-wider"
        >
          Annuler
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={cx(
            "px-3.5 py-2 text-xs font-bold uppercase tracking-wider",
            danger
              ? "btn bg-rose-600 hover:bg-rose-500 text-white"
              : "btn-primary",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Dialog avec saisie texte — remplace `prompt()`. */
export function PromptDialog({
  open,
  onClose,
  onSubmit,
  title,
  message,
  defaultValue = "",
  placeholder,
  submitLabel = "Valider",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: ReactNode;
  message: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  submitLabel?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  // Réinitialise la valeur à l'ouverture du dialog.
  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-zinc-650 leading-relaxed whitespace-pre-line">{message}</p>
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(value);
          onClose();
        }}
      >
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn bg-white hover:bg-zinc-50 text-zinc-600 border border-zinc-200 px-3.5 py-2 text-xs font-bold uppercase tracking-wider"
          >
            Annuler
          </button>
          <button type="submit" className="btn-primary px-3.5 py-2 text-xs font-bold uppercase tracking-wider">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
