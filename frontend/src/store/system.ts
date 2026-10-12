import { create } from "zustand";
import { fetchSystem, type SystemInfo } from "../api/endpoints";

interface SystemState {
  info: SystemInfo | null;
  load: () => void;
}

let started = false;

/** This PC's hardware, fetched once (it cannot change while Accio runs). Used for size warnings and the Settings card. */
export const useSystem = create<SystemState>((set) => ({
  info: null,
  load: () => {
    if (started) return;
    started = true;
    fetchSystem()
      .then((info) => set({ info }))
      .catch(() => {
        started = false; // try again next time something asks
      });
  },
}));
