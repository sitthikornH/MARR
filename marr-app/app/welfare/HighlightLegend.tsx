/** Colour key for the day highlights on the printable forms (see lib/dayHighlight.ts). */
export default function HighlightLegend() {
  return (
    <div className="flex gap-4 text-[10px]">
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-5 border border-gray-800 bg-rose-100" /> Company holiday
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-5 border border-gray-800 bg-sky-100" /> Leave
      </span>
    </div>
  );
}
