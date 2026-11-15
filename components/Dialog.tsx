"use client";

import { useEffect, useRef, type ReactNode } from "react";

let openDialogs = 0;
let originalOverflow = "";
const dialogTriggers = new WeakMap<HTMLDialogElement, HTMLElement>();

type Props = {
  children: ReactNode;
  className: string;
  label?: string;
  labelledBy?: string;
  variant?: "modal" | "drawer" | "navigation";
  dismissible?: boolean;
  onCloseAction: () => void;
};

/** Native modal dialogs isolate focus and background content, including nested dialogs. */
export default function Dialog({ children, className, label, labelledBy, variant = "modal", dismissible = true, onCloseAction }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (trigger) dialogTriggers.set(dialog, trigger);
    dialog.showModal();
    if (openDialogs++ === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = originalOverflow;
      let restore = trigger;
      // The originating policy drawer can disappear while its edit dialog remains.
      // Walk back to a connected opener instead of focusing a removed subtree.
      while (restore) {
        const parentDialog = restore.closest("dialog");
        if (!parentDialog || parentDialog.open) break;
        restore = dialogTriggers.get(parentDialog) ?? null;
      }
      if (restore?.isConnected && !dialog.contains(restore)) restore.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`app-dialog app-dialog--${variant}`}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dismissible) onCloseAction();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && dismissible) onCloseAction();
      }}
    >
      <div className={className} tabIndex={-1}>{children}</div>
    </dialog>
  );
}
