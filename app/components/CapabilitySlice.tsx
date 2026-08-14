import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { capabilitiesById } from "../../lib/capabilities";

export function CapabilitySlice({ eyebrow, title, intro, ids, light = false }: { eyebrow: string; title: string; intro: string; ids: string[]; light?: boolean }) {
  const items = ids.map((id) => capabilitiesById[id]).filter(Boolean);
  return (
    <section className={`capability-slice${light ? " capability-slice-light" : ""}`} aria-label={`${title} capabilities`}>
      <div className="capability-slice-heading">
        <span className="section-number">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{intro}</p>
      </div>
      <div className="capability-slice-grid">
        {items.map((item) => <Link href={`/capabilities#${item.id}`} key={item.id}><span>{item.surface}</span><h3>{item.title}</h3><p>{item.summary}</p><strong>See proof + boundary <ArrowRight size={14} /></strong></Link>)}
      </div>
      <Link className="capability-slice-all" href="/capabilities">Browse the full Capability Atlas <ArrowRight size={15} /></Link>
    </section>
  );
}
