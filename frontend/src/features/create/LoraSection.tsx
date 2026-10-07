import { LoraList } from "../../components/LoraList";
import { useCreate } from "./store";

/** Create's LoRAs: files in loras/krea2 first, then shared/unsorted. loras/qwen is Edit-only (spec 6.6). */
export function LoraSection() {
  const { loras, variant, loraLastMode, patch } = useCreate();
  return <LoraList mode="create" loras={loras} loraLastMode={loraLastMode} passes={variant === "detailed"} onChange={(next) => patch({ loras: next })} />;
}
