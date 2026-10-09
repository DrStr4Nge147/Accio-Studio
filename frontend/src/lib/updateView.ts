import type { UpdateInfo } from "../api/endpoints";

export interface UpdateView {
  /** Main line, e.g. "Version 0.1.0 · update 0.1.1 is available". */
  title: string;
  /** Small explanatory line under it, or null. */
  hint: string | null;
  /** Show the "Update now" button. */
  canApply: boolean;
  /** Show a link to the release notes. */
  showNotes: boolean;
  /** Show "Check again". */
  canRecheck: boolean;
}

/** What the Updates section shows for a given server answer. Pure, so it is unit-tested. */
export function updateView(info: UpdateInfo): UpdateView {
  const version = `Version ${info.current}`;
  if (!info.enabled) {
    return { title: version, hint: "Update checks are switched off (check_updates in settings.json).", canApply: false, showNotes: false, canRecheck: false };
  }
  if (info.available && info.latest) {
    return {
      title: `${version} · update ${info.latest} is available`,
      hint: info.can_apply ? "Your history, password and models are kept." : "Run Update.bat on the PC that runs Accio to install it.",
      canApply: info.can_apply,
      showNotes: !!info.notes_url,
      canRecheck: false,
    };
  }
  if (info.error) return { title: version, hint: info.error, canApply: false, showNotes: false, canRecheck: true };
  return { title: `${version} · up to date`, hint: null, canApply: false, showNotes: false, canRecheck: true };
}
