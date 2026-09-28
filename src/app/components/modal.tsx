"use client";

import { useEffect, useEffectEvent, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Icon } from "./icon-set";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

// Passing `onSubmit` renders the box itself as the <form>, so the submit
// button inside `children` submits it. Focus moves to the dialog (not the
// first input, which would pop the keyboard open on phones), Tab stays inside
// it, Escape closes it, and focus returns to whatever opened it.
export function Modal({ title, onClose, onSubmit, children }: { title: string; onClose: () => void; onSubmit?: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = backdropRef.current?.querySelector<HTMLElement>(".modal");
    box?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !items.includes(active);
      if (event.shiftKey && (outside || active === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (outside || active === last)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, []);

  const head = <div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="modal-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18}/></button></div>;
  const boxProps = { role: "dialog", "aria-modal": true, "aria-labelledby": titleId, tabIndex: -1, onClick: (event: React.MouseEvent) => event.stopPropagation() } as const;

  return <div ref={backdropRef} className="modal-backdrop" role="presentation" onClick={onClose}>
    {onSubmit
      ? <form {...boxProps} className="modal charge-form" onSubmit={onSubmit}>{head}{children}</form>
      : <section {...boxProps} className="modal">{head}{children}</section>}
  </div>;
}
