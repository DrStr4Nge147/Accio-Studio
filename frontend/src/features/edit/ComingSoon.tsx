import { Ring } from "../../components/Wordmark";

/** Edit (phase 5) and Gallery (phase 6) are not built yet; say so plainly. */
export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-xs">
        <Ring className="mx-auto h-12 w-12 text-text-3" spark={false} />
        <h2 className="serif mt-4 text-[22px] font-medium">{title}</h2>
        <p className="mt-2 text-[14px] text-text-2">{text}</p>
      </div>
    </div>
  );
}

export const EditSoon = () => (
  <ComingSoon title="Edit is coming next" text="Multi-edit, inpaint and outpaint arrive in the next phase. Create is ready to use." />
);
export const GallerySoon = () => (
  <ComingSoon title="Gallery is coming" text="The full gallery arrives in a later phase. Recent images are under Create for now." />
);
