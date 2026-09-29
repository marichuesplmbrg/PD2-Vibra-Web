import React from "react";

/* Each member is one "page" in the stack (see .team-stack in styles.css).
   Pages overlap left to right; hovering or tabbing to a page brings it to
   the front. `tab` is the name printed up the page's visible edge. */
const teamMembers = [
  { name: "Marichu Espelimbergo", tab: "Marichu", role: "Frontend Developer", image: "/members/marichu.jpg" },
  { name: "Missy Anne Jhelzshir Espiritu", tab: "Missy", role: "Frontend Developer", image: "/members/missy.jpg" },
  { name: "Khlowee Mendoza", tab: "Khlowee", role: "Backend Developer", image: "/members/khlowee.jpg" },
  { name: "Julian Vincent Quibral", tab: "Julian", role: "Backend Developer", image: "/members/juliann.jpg" },
  { name: "Lance Gebrielle Santos", tab: "Lance", role: "Frontend Developer", image: "/members/lance.jpg" },
];

export default function Team() {
  return (
    <div className="team-page">
      <div className="team-header">
        <h1>Meet Our Team</h1>
        <p>The people behind the development and success of our application.</p>
      </div>

      <div className="team-stack" role="list">
        {teamMembers.map((member) => (
          <article
            className="team-page-card"
            key={member.name}
            role="listitem"
            tabIndex={0}
            aria-label={`${member.name}, ${member.role}`}
          >
            <div className="team-page-photo">
              <img src={member.image} alt={member.name} />
            </div>

            <div className="team-page-info">
              <h3>{member.name}</h3>
              <p>{member.role}</p>
            </div>

            <span className="team-page-tab" aria-hidden="true">{member.tab}</span>
          </article>
        ))}
      </div>
    </div>
  );
}