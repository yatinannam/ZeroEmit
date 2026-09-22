export type IconName = "pin" | "user" | "bolt" | "arrow" | "arrow-left" | "close" | "tree" | "fire" | "clock" | "home" | "chart" | "history" | "award";

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    bolt: <path d="m13 2-8 11h6l-1 9 8-11h-6l1-9Z"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    "arrow-left": <path d="M19 12H5m6-6-6 6 6 6"/>,
    close: <path d="M6 6 18 18M18 6 6 18"/>,
    tree: <><path d="M12 21V10"/><path d="m7 14 5-4 5 4"/><path d="m8 9 4-4 4 4"/><path d="M5 21h14"/></>,
    fire: <path d="M12 22c4.4 0 7-3 7-7 0-3.5-2.1-6.2-5-9 .1 2.1-1 3.4-2.2 4.3C11.8 7.5 10.6 5.7 11 3 7.8 5.2 5 9.2 5 14c0 4.5 2.8 8 7 8Z"/>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-6h6v6"/></>,
    chart: <><path d="M4 19V5M4 19h17M7 15l4-4 3 2 5-6"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></>,
    award: <><circle cx="12" cy="8" r="5"/><path d="m9 13-1 8 4-2 4 2-1-8"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}
