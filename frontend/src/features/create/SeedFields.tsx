import { Dices } from "lucide-react";
import { IconButton, Label, Toggle, inputCls } from "../../components/ui/controls";
import { useJobs } from "../../store/jobs";
import { TIPS } from "./tips";
import { useCreate, type Seeds } from "./store";

const MAX_SEED = Number.MAX_SAFE_INTEGER; // 2^53 - 1, the server's limit
const randomSeed = () => Math.floor(Math.random() * 2 ** 53);

function SeedInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-1">
        <input
          inputMode="numeric"
          aria-label={label}
          value={value ?? ""}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            onChange(digits ? Math.min(Number(digits), MAX_SEED) : null);
          }}
          className={`${inputCls} font-mono`}
        />
        <IconButton label={`Randomize ${label.toLowerCase()}`} onClick={() => onChange(randomSeed())}>
          <Dices size={20} strokeWidth={1.7} />
        </IconButton>
      </div>
    </div>
  );
}

/** Lock seed: while on, the three seeds below are sent instead of fresh random ones. */
export function SeedFields() {
  const { variant, seedVariance, lockSeed, seeds, patch } = useCreate();
  const last = useJobs((s) => s.order.map((id) => s.jobs[id]).find((j) => j.mode === "create" && Object.keys(j.seeds).length));
  const detailed = variant === "detailed";
  const set = (k: keyof Seeds) => (v: number | null) => patch({ seeds: { ...seeds, [k]: v } });

  const toggle = (on: boolean) => {
    if (!on) return patch({ lockSeed: false });
    // Start from the seeds of the latest image so "lock" means "do that again", else fresh ones.
    const from = last?.seeds ?? {};
    patch({
      lockSeed: true,
      seeds: {
        main: seeds.main ?? from.main ?? from.pass1 ?? randomSeed(),
        pass2: seeds.pass2 ?? from.pass2 ?? randomSeed(),
        variance: seeds.variance ?? from.variance ?? randomSeed(),
      },
    });
  };

  return (
    <div>
      <Toggle
        on={lockSeed}
        onChange={toggle}
        label="Lock seed"
        tip={TIPS.lockSeed}
        sub={
          !lockSeed && last ? (
            <span className="font-mono">last: {Object.values(last.seeds).join(" · ")}</span>
          ) : (
            "Same seeds again for the same settings"
          )
        }
      />
      {lockSeed && (
        <div className="mt-2 grid gap-2">
          <SeedInput label={detailed ? "Pass 1 seed" : "Seed"} value={seeds.main} onChange={set("main")} />
          {detailed && <SeedInput label="Pass 2 seed" value={seeds.pass2} onChange={set("pass2")} />}
          {seedVariance && <SeedInput label="Variance seed" value={seeds.variance} onChange={set("variance")} />}
        </div>
      )}
    </div>
  );
}
