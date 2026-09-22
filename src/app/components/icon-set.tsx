export type IconName = "pin" | "user" | "bolt" | "arrow" | "arrow-left" | "close" | "tree" | "fire" | "clock" | "home" | "chart" | "history" | "award" | "chevron-right" | "bell" | "shield" | "info" | "trash";

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    pin: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></>,
    bolt: <path d="m13 2-8 11h6l-1 9 8-11h-6l1-9Z"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    "arrow-left": <path d="M19 12H5m6-6-6 6 6 6"/>,
    close: <path d="M6 6 18 18M18 6 6 18"/>,
    tree: <path d="M12 3 4 15h5l-3 6h12l-3-6h5L12 3Z"/>,
    fire: <path d="M12 22c4.4 0 7-3 7-7 0-3.5-2.1-6.2-5-9 .1 2.1-1 3.4-2.2 4.3C11.8 7.5 10.6 5.7 11 3 7.8 5.2 5 9.2 5 14c0 4.5 2.8 8 7 8Z"/>,
    clock: <><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></>,
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-6h6v6"/></>,
    chart: <><path d="M4 19V5M4 19h17M7 15l4-4 3 2 5-6"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5M12 7v5l3 2"/></>,
    award: <><circle cx="12" cy="8" r="5"/><path d="m9 13-1 8 4-2 4 2-1-8"/></>,
    "chevron-right": <path d="m9 6 6 6-6 6"/>,
    bell: <><path d="M6 8a6 6 0 0 1 12 0c0 3.5 1 5.5 2 7H4c1-1.5 2-3.5 2-7Z"/><path d="M10 19a2 2 0 0 0 4 0"/></>,
    shield: <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/>,
    info: <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 8v.01"/></>,
    trash: <><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}
