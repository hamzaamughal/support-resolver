import Console from "./console";
import { getStore } from "@/lib/stores";

export default function Home() {
  const { name, tagline, examples } = getStore();
  return <Console store={{ name, tagline, examples }} />;
}
