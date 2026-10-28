import Console from "./console";
import { getStore } from "@/lib/stores";

export default function Home() {
  const { name, tagline, examples, exampleTags, knowledge, escalateDistance } = getStore();
  return (
    <Console
      store={{
        name,
        tagline,
        examples: examples.map((text, i) => ({ text, tag: exampleTags?.[i] ?? "" })),
        knowledge,
        escalateDistance,
      }}
    />
  );
}
