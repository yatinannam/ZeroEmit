"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react";
import gsap from "gsap";
import { Icon } from "./icon-set";
import { lockScroll, reducedMotion, unlockScroll } from "./motion";
import { openSheet, type SheetEntry } from "./sheet-history";

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

// Passing `onSubmit` renders the box itself as the <form>, so the submit
// button inside `children` submits it. Focus moves to the dialog (not the
// first input, which would pop the keyboard open on phones), Tab stays inside
// it, Escape closes it, and focus returns to whatever opened it. A tap on the
// backdrop closes it too, except for a form: a stray tap there would throw
// away what was typed (the close button and Escape still work). Back closes
// it rather than leaving the page (see sheet-history.ts).
// `initialFocus` is a selector for a field inside the dialog to focus instead,
// for when the user opened it to type into that field (e.g. "Add your name").
// A field's value as typed. A number field holding what isn't a number ("1e",
// "-") reads as blank, so it comes back as "NaN" instead: never taken for a
// field left empty (a blank price, say, means "use the typical one").
export function typedValue(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLInputElement)) return "";
  return field.validity.badInput ? "NaN" : field.value;
}

// Puts the cursor in a form's field, for the first one that needs fixing.
export function focusField(form: HTMLFormElement, name: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLElement) field.focus();
}

export function Modal({ title, onClose, onSubmit, initialFocus, children }: { title: string; onClose: () => void; onSubmit?: (event: FormEvent<HTMLFormElement>) => void; initialFocus?: string; children: ReactNode }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useEffectEvent(onClose);
  const focusTarget = useEffectEvent(() => initialFocus);
  const entry = useRef<SheetEntry | null>(null);
  // Closed with its own controls: its history entry comes off too.
  const dismiss = () => { entry.current?.dismiss(); onClose(); };
  const dismissOnKey = useEffectEvent(() => { entry.current?.dismiss(); onClose(); });

  useEffect(() => {
    const sheet = openSheet(() => close());
    entry.current = sheet;
    return () => { sheet.release(); entry.current = null; };
  }, []);

  // The page behind stays put while the sheet is open (see lockScroll).
  useLayoutEffect(() => {
    lockScroll();
    return unlockScroll;
  }, []);

  // The sheet rises from the bottom over a fading backdrop. Opacity, not
  // visibility: the dialog takes focus right after mounting, and a hidden
  // element can't.
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop || reducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(backdrop, { backgroundColor: "rgba(0,0,0,0)", duration: 0.25, ease: "power1.out", clearProps: "backgroundColor" });
      gsap.from(".modal", { y: 48, opacity: 0, duration: 0.4, ease: "power3.out", clearProps: "transform,opacity" });
    }, backdrop);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = backdropRef.current?.querySelector<HTMLElement>(".modal");
    const selector = focusTarget();
    const field = selector ? box?.querySelector<HTMLElement>(selector) : null;
    (field ?? box)?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); dismissOnKey(); return; }
      if (event.key !== "Tab" || !box) return;
      // Only what Tab can reach: a roving tabindex (Appearance's theme
      // options) parks the unselected buttons at -1, and hidden ones have no box.
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !items.includes(active);
      if (event.shiftKey && (outside || active === first)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (outside || active === last)) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    // preventScroll: the page is put back where it was (unlockScroll); a plain focus() then jumped to the button.
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus({ preventScroll: true }); };
  }, []);

  const head = <div className="modal-head"><h2 id={titleId}>{title}</h2><button type="button" className="modal-close" aria-label="Close" onClick={dismiss}><Icon name="close" size={18}/></button></div>;
  const boxProps = { role: "dialog", "aria-modal": true, "aria-labelledby": titleId, tabIndex: -1, onClick: (event: React.MouseEvent) => event.stopPropagation() } as const;

  return <div ref={backdropRef} className="modal-backdrop" role="presentation" onClick={onSubmit ? undefined : dismiss}>
    {onSubmit
      ? <form {...boxProps} className="modal charge-form" onSubmit={onSubmit}>{head}{children}</form>
      : <section {...boxProps} className="modal">{head}{children}</section>}
  </div>;
}
