import type { ReactNode } from "react";
import type { ClubContactData } from "@/lib/intelligence/club-contact-data";

const priorityMeaning: Record<string, string> = {
  A: "Key contact",
  B: "Secondary contact",
  C: "Technical/supporting contact",
};

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

export function ClubIntelligence({ data }: { data: ClubContactData | null }) {
  if (!data) return <section className="club-intelligence-section" aria-labelledby="club-intelligence-title">
    <header className="club-section-heading"><div><h2 id="club-intelligence-title">Club intelligence</h2><p>Key people, decision-makers and official club contacts</p></div></header>
    <p className="club-intelligence-empty">No verified club intelligence is available for this club yet.</p>
  </section>;

  return <section className="club-intelligence-section" aria-labelledby="club-intelligence-title">
    <header className="club-section-heading"><div><h2 id="club-intelligence-title">Club intelligence</h2><p>Key people, decision-makers and official club contacts</p></div></header>
    {data.contacts.length > 0 && <div className="club-contact-grid">
      {data.contacts.map((contact, index) => <article className="club-contact-card" key={`${contact.name}-${contact.role}-${index}`}>
        <div className="club-contact-card-top"><span className={`club-contact-priority club-contact-priority-${contact.priority}`}>Priority {contact.priority}</span><span>{priorityMeaning[contact.priority] ?? "Club contact"}</span></div>
        <h3>{contact.name}</h3><p>{contact.role}</p>
        <dl><div><dt>Confidence</dt><dd>{contact.confidence}</dd></div>{contact.profile_type && <div><dt>Reference</dt><dd>{contact.profile_url ? <ExternalLink href={contact.profile_url}>{contact.profile_type}</ExternalLink> : contact.profile_type}</dd></div>}</dl>
      </article>)}
    </div>}
    <article className="club-official-contact-card"><h3>Official club contacts</h3><dl className="club-official-contact-list">
      <div><dt>City</dt><dd>{data.city ?? "Not publicly verified"}</dd></div>
      <div><dt>Website</dt><dd>{data.official_website ? <ExternalLink href={data.official_website}>Official website</ExternalLink> : "Not publicly verified"}</dd></div>
      <div><dt>PFL page</dt><dd>{data.pfl_page ? <ExternalLink href={data.pfl_page}>PFL club page</ExternalLink> : "Not publicly verified"}</dd></div>
      <div><dt>Direct email</dt><dd>{data.direct_email ? <a href={`mailto:${data.direct_email}`}>{data.direct_email}</a> : "Not publicly verified"}</dd></div>
      <div><dt>Direct phone</dt><dd>{data.direct_phone ? <a href={`tel:${data.direct_phone.replace(/\s/g, "")}`}>{data.direct_phone}</a> : "Not publicly verified"}</dd></div>
    </dl></article>
  </section>;
}
