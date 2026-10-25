import { Segmented, Toggle, inputCls } from "../../components/ui/controls";
import { SectionTitle } from "../../components/ui/SettingsCard";
import { playSound } from "../../lib/notify";
import { SOUNDS } from "../../lib/sounds";
import { useUi, type Theme } from "../../store/ui";

const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

/** Theme, and the chime that plays when an image is ready. */
export function AppearanceSection() {
  const theme = useUi((s) => s.theme);
  const notifyOnDone = useUi((s) => s.notifyOnDone);
  const notifySound = useUi((s) => s.notifySound);
  const set = useUi((s) => s.set);
  return (
    <div>
      <SectionTitle>Theme</SectionTitle>
      <div className="mt-1.5">
        <Segmented<Theme> label="Theme" value={theme} options={THEMES} onChange={(t) => set({ theme: t })} />
      </div>
      <div className="mt-2">
        <Toggle
          on={notifyOnDone}
          onChange={(on) => set({ notifyOnDone: on })}
          label="Sound when finished"
          sub="Plays a chime when an image is ready, even if this tab is in the background"
        />
        {notifyOnDone && (
          <div className="mt-1 flex gap-2">
            <select
              aria-label="Finish sound"
              value={notifySound}
              onChange={(e) => {
                set({ notifySound: e.target.value });
                playSound(e.target.value);
              }}
              className={inputCls}
            >
              {SOUNDS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => playSound(notifySound)} className="h-11 flex-none rounded-s border border-line px-4 text-[14px] text-text-2">
              Play
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
