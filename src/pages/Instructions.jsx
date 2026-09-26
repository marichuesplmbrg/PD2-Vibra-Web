import React from "react";
import { Cpu, RotateCw, Globe } from "lucide-react";

const css = `
.vibra-instructions {
  --card-bg: #111725;
  --card-border: rgba(255,255,255,0.07);
  --card-border-hover: rgba(255,255,255,0.14);
  --text: #e7eaf0;
  --heading: #ffffff;
  --muted: #7c8697;
  --muted-2: #5f6a7c;
  --grad: linear-gradient(120deg, #f6a34b 0%, #d267c9 55%, #a866f2 100%);
  --grad-soft: linear-gradient(120deg, rgba(246,163,75,0.16), rgba(168,102,242,0.16));
  --orange: #f6a34b;

  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  /* Matches .vwrap in styles.css so the title lands in the same spot as on
     every other page. */
  padding: 26px 34px 40px;
  min-width: 0;
}
.vibra-instructions * { box-sizing: border-box; }

/* Matches .vhead h1 / .vhead .sub in styles.css. */
.vibra-instructions .page-head { max-width: 1080px; }
.vibra-instructions .page-head h1 { margin: 0 0 4px; font-size: 30px; font-weight: 800; color: var(--heading); letter-spacing: -.4px; }
.vibra-instructions .page-head p { margin: 0 0 18px; color: #8b90a4; font-size: 15px; }

.vibra-instructions .grid {
  margin-top: 0; display: grid;
  grid-template-columns: repeat(2, minmax(0,1fr));
  gap: 20px; max-width: 1080px;
}
.vibra-instructions .card {
  background: var(--card-bg); border: 1px solid var(--card-border);
  border-radius: 16px; padding: 26px 26px 28px;
  position: relative; overflow: hidden;
  transition: border-color .2s ease;
}
.vibra-instructions .card:hover { border-color: var(--card-border-hover); }
.vibra-instructions .card.wide { grid-column: 1 / -1; }
.vibra-instructions .card::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0;
  width: 3px; background: var(--grad); opacity: .9;
}
.vibra-instructions .card-head { display: flex; align-items: center; gap: 13px; margin-bottom: 6px; }
.vibra-instructions .card-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: var(--grad-soft); border: 1px solid var(--card-border);
  display: grid; place-items: center; flex-shrink: 0; color: var(--orange);
}
.vibra-instructions .card-head h2 { margin: 0; font-size: 18px; font-weight: 700; color: var(--heading); letter-spacing: -0.01em; }
.vibra-instructions .tag {
  margin-left: auto; font-size: 11px; font-weight: 600;
  color: var(--muted); background: rgba(255,255,255,0.04);
  border: 1px solid var(--card-border); padding: 4px 9px; border-radius: 999px;
  white-space: nowrap;
}
.vibra-instructions .lead { color: var(--muted); font-size: 14px; line-height: 1.55; margin: 4px 0 20px; max-width: 60ch; }

.vibra-instructions .group + .group { margin-top: 22px; }
.vibra-instructions .group-title { font-size: 14px; font-weight: 700; color: var(--heading); margin: 0 0 12px; }

.vibra-instructions .steps { list-style: none; display: flex; flex-direction: column; gap: 14px; padding: 0; margin: 0; }
.vibra-instructions .steps li { display: flex; gap: 13px; align-items: flex-start; }
.vibra-instructions .num {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 7px;
  background: rgba(255,255,255,0.05); border: 1px solid var(--card-border);
  color: var(--text); font-size: 12px; font-weight: 700;
  display: grid; place-items: center; margin-top: 1px;
}
.vibra-instructions .steps .stepbody { font-size: 14px; line-height: 1.5; color: var(--text); }
.vibra-instructions .steps .sub { color: var(--muted); }
.vibra-instructions .steps b { font-weight: 700; }

.vibra-instructions .options { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-direction: column; gap: 6px; }
.vibra-instructions .options li { color: var(--muted); font-size: 13.5px; line-height: 1.5; }
.vibra-instructions .options b { color: var(--text); font-weight: 600; }

.vibra-instructions .note {
  margin-top: 20px; padding: 12px 14px; border-radius: 10px;
  background: rgba(255,255,255,0.03); border: 1px solid var(--card-border);
  font-size: 13.5px; line-height: 1.5; color: var(--muted);
}
.vibra-instructions .note b { color: var(--text); font-weight: 600; }

.vibra-instructions .footnote { max-width: 1080px; margin-top: 20px; font-size: 13px; color: var(--muted-2); line-height: 1.5; }
.vibra-instructions .footnote b { color: var(--muted); font-weight: 600; }

@media (max-width: 880px) {
  .vibra-instructions .grid { grid-template-columns: 1fr; }
  .vibra-instructions { padding: 22px 20px 40px; }
}
`;

/* Numbered step list. Steps are real sequences, so the numbers carry meaning. */
function Steps({ items }) {
  return (
    <ol className="steps">
      {items.map((body, i) => (
        <li key={i}>
          <span className="num">{i + 1}</span>
          <span className="stepbody">{body}</span>
        </li>
      ))}
    </ol>
  );
}

export default function Instructions() {
  return (
    <>
      <style>{css}</style>
      <div className="vibra-instructions">
        <header className="page-head">
          <h1>Instructions</h1>
          <p>How to set up both prototypes and use the web application</p>
        </header>

        <section className="grid">

          {/* Main prototype */}
          <article className="card">
            <div className="card-head">
              <span className="card-icon"><Cpu size={20} strokeWidth={2} /></span>
              <h2>Main prototype</h2>
              <span className="tag">Raspberry Pi</span>
            </div>
            <p className="lead">
              Measures the room with the LiDAR and ultrasonic sensor, then saves,
              uploads or classifies the data.
            </p>

            <Steps items={[
              <>Plug in the prototype.</>,
              <>Open the <b>PDT6</b> folder.</>,
              <>Launch <b>Vibra.exe</b>.</>,
              <>
                <b>Page 1</b> shows the live readings: width and length from the LiDAR,
                and height from the ultrasonic sensor.
              </>,
              <>
                <b>Page 2</b> gives three options:
                <ul className="options">
                  <li><b>Save locally.</b> Downloads the gathered data to the prototype.</li>
                  <li><b>Upload.</b> Sends the gathered data straight to the Google Sheets database.</li>
                  <li>
                    <b>Classify.</b> Downloads the reverberation values from Google Sheets,
                    classifies them, then uploads the classified data back to the sheet.
                  </li>
                </ul>
              </>,
            ]} />
          </article>

          {/* Pole prototype */}
          <article className="card">
            <div className="card-head">
              <span className="card-icon"><RotateCw size={20} strokeWidth={2} /></span>
              <h2>Pole prototype</h2>
              <span className="tag">ESP32 S3 + Arduino Uno</span>
            </div>
            <p className="lead">
              Rotates the sound sensor around the room to measure reverberation.
              Set up both parts before starting a run.
            </p>

            <div className="group">
              <h3 className="group-title">Sound sensor (ICS)</h3>
              <Steps items={[
                <>Insert the two 3.7 V batteries.</>,
                <>Turn on the battery holder module.</>,
                <>Connect the battery holder power cable to the ESP32 S3.</>,
                <>Press the reset button to start or restart it.</>,
              ]} />
            </div>

            <div className="group">
              <h3 className="group-title">Stepper motor</h3>
              <Steps items={[
                <>Plug in the main extension.</>,
                <>Plug the Arduino Uno into the main extension.</>,
                <>Plug the 5 V 10 A power supply into the main extension.</>,
                <>Turn on the main switch above the main extension.</>,
              ]} />
            </div>

            <div className="note">
              <b>To start a run:</b> once both parts are set up, press reset on the
              sound sensor first, then turn on the main switch for the stepper motor.
            </div>
          </article>

          {/* Web application */}
          <article className="card wide">
            <div className="card-head">
              <span className="card-icon"><Globe size={20} strokeWidth={2} /></span>
              <h2>Web application</h2>
              <span className="tag">Browser</span>
            </div>
            <p className="lead">
              Turns the uploaded scan into a digital twin of the room and recommends
              how to treat it.
            </p>

            <Steps items={[
              <>Open the <b>Parameters Table</b> page.</>,
              <>Click <b>Import</b>, then <b>Import cloud (Google Sheets)</b> to fetch the latest values from the database.</>,
              <>Click <b>Deploy</b> to build the digital twin from the detected values.</>,
              <>On the <b>Simulation</b> page, turn on <b>Imbalanced sound</b> to see where hotspots and deadspots were detected in the room.</>,
              <>Scroll down to the <b>Recommendations</b> and pick the best option for the room.</>,
              <>
                Apply that treatment in the real room, then scan it again and deploy the new
                values. <span className="sub">The twin shows whether the room is now treated.</span>
              </>,
            ]} />
          </article>

        </section>

        <p className="footnote">
          <b>Order of use:</b> scan the room with both prototypes and upload the data to
          Google Sheets first. The web application can only show what is already in the sheet.
        </p>
      </div>
    </>
  );
}