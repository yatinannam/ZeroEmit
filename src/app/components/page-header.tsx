export function PageHeader({ eyebrow, title, intro }: { eyebrow: string; title: string; intro: string }) {
  return <section className="page-header">
    <p className="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p className="secondary-intro">{intro}</p>
  </section>;
}
