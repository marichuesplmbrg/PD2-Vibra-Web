import React from "react";
import "../styles.css";

const teamMembers = [
  {
    name: "Marichu Espelimbergo",
    role: "Frontend Developer",
    image: "/members/marichu.jpg",
  },
  {
    name: "Missy Anne Jhelzshir Espiritu",
    role: "Frontend Developer",
    image: "/members/missy.jpg",
  },
  {
    name: "Khlowee Mendoza",
    role: "Backend Developer",
    image: "/members/khlowee.jpg",
  },
  {
    name: "Julian Vincent Quibral",
    role: "Backend Developer",
    image: "/members/juliann.jpg",
  },
  {
    name: "Lance Gebrielle Santos",
    role: "Frontend Developer",
    image: "/members/lance.jpg",
  },
];

export default function Team() {
  return (
    <div className="team-page">
      <div className="team-header">
        <h1>Meet Our Team</h1>
        <p>
          The people behind the development and success of our application.
        </p>
      </div>

      <div className="team-grid">
        {teamMembers.map((member) => (
          <div className="team-card" key={member.name}>
            <div className="member-image">
              <img src={member.image} alt={member.name} />
            </div>

            <div className="member-info">
              <h3>{member.name}</h3>
              <p>{member.role}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}