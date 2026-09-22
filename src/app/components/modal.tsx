"use client";

import { Icon } from "./icon-set";

// The form-as-modal cases (edit profile, log a charge) render <form
// className="modal charge-form"> as the box itself, since onSubmit needs to
// wrap the submit button too — a genuinely different shape, so only the
// static/read-only modals (location, info, confirm) share this wrapper.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="modal-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18}/></button></div>
      {children}
    </section>
  </div>;
}
