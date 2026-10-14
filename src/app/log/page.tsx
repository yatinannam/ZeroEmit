import { LogScreen } from "../components/log-screen";

export default async function LogPage({ searchParams }: PageProps<"/log">) {
  const { quick } = await searchParams;
  return <LogScreen quick={quick === "1"}/>;
}
