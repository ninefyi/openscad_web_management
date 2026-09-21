import { useState } from "react";
import type { Template } from "./types/template";
import { Gallery } from "./components/Gallery/Gallery";
import { CustomizeView } from "./components/Customize/CustomizeView";

export default function App() {
  const [selected, setSelected] = useState<Template | null>(null);

  if (selected) {
    return <CustomizeView template={selected} onBack={() => setSelected(null)} />;
  }

  return <Gallery onSelect={setSelected} />;
}
