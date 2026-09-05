import React from "react";
import { Code2, Globe, Link2 } from "lucide-react";

const css = `
.vibra-instructions {
  --card-bg: #111725;
  --card-border: rgba(255,255,255,0.07);
  --card-border-hover: rgba(255,255,255,0.14);
  --text: #e7eaf0;
  --heading: #ffffff;
  --muted: #7c8697;
  --muted-2: #5f6a7c;
  --code-bg: #0a0f1a;
  --code-border: rgba(255,255,255,0.06);
  --grad: linear-gradient(120deg, #f6a34b 0%, #d267c9 55%, #a866f2 100%);
  --grad-soft: linear-gradient(120deg, rgba(246,163,75,0.16), rgba(168,102,242,0.16));
  --orange: #f6a34b;
  --purple: #b06cf0;

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
  transition: border-color .2s ease, transform .2s ease;
}
.vibra-instructions .card:hover { border-color: var(--card-border-hover); transform: translateY(-2px); }
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
  margin-left: auto; font-size: 11px; font-weight: 700; letter-spacing: .06em;
  color: var(--muted); background: rgba(255,255,255,0.04);
  border: 1px solid var(--card-border); padding: 4px 9px; border-radius: 999px;
}
.vibra-instructions .lead { color: var(--muted); font-size: 14px; line-height: 1.55; margin: 4px 0 20px; max-width: 46ch; }

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

.vibra-instructions code.inline {
  font-family: "SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;
  font-size: 12.5px; background: var(--code-bg); border: 1px solid var(--code-border);
  color: #e6d0a8; padding: 1px 6px; border-radius: 6px; white-space: nowrap;
}
.vibra-instructions .snippet {
  margin-top: 18px; background: var(--code-bg); border: 1px solid var(--code-border);
  border-radius: 10px; padding: 13px 15px; display: flex; flex-direction: column; gap: 6px;
  font-family: "SF Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace; font-size: 12.5px;
}
.vibra-instructions .snippet .line { color: #cdd5e2; }
.vibra-instructions .snippet .prompt { color: var(--orange); user-select: none; }
.vibra-instructions .snippet .cmt { color: var(--muted-2); }

.vibra-instructions .link-row {
  margin-top: 18px; display: flex; align-items: center; gap: 10px;
  background: var(--code-bg); border: 1px solid var(--code-border);
  border-radius: 10px; padding: 11px 14px;
}
.vibra-instructions .link-row a { color: #d8b3ff; text-decoration: none; font-size: 13.5px; font-weight: 600; }
.vibra-instructions .link-row a:hover { text-decoration: underline; }
.vibra-instructions .copy {
  margin-left: auto; font-size: 12px; color: var(--muted);
  border: 1px solid var(--card-border); background: rgba(255,255,255,0.03);
  border-radius: 7px; padding: 4px 10px; cursor: pointer;
  transition: color .15s ease, border-color .15s ease;
}
.vibra-instructions .copy:hover { color: var(--text); border-color: var(--card-border-hover); }

.vibra-instructions .footnote { max-width: 1080px; margin-top: 20px; font-size: 13px; color: var(--muted-2); }
.vibra-instructions .footnote b { color: var(--muted); font-weight: 600; }

@media (max-width: 880px) {
  .vibra-instructions .grid { grid-template-columns: 1fr; }
  .vibra-instructions { padding: 22px 20px 40px; }
}
`;

export default function Instructions() {
  const copyUrl = (e) => {
    if (navigator.clipboard) navigator.clipboard.writeText("https://app.vibra.io");
    e.currentTarget.textContent = "Copied";
  };

  return (
    <>
      <style>{css}</style>
      <div className="vibra-instructions">
        <header className="page-head">
          <h1>Instructions</h1>
          <p>How to run the prototype and read the dashboard</p>
        </header>

        <section className="grid">
          {/* Prototype */}
          <article className="card">
            <div className="card-head">
              <span className="card-icon">
                <Code2 size={20} strokeWidth={2} />
              </span>
              <h2>Prototype</h2>
              <span className="tag">LOCAL</span>
            </div>
            <p className="lead">
              Run the interactive prototype on your own machine when you want to change
              parameters or test the simulation offline.
            </p>

            <ol className="steps">
              <li>
                <span className="num">1</span>
                <span className="stepbody">Clone the repo and enter the folder.</span>
              </li>
              <li>
                <span className="num">2</span>
                <span className="stepbody">
                  Install dependencies with <code className="inline">npm install</code>.
                </span>
              </li>
              <li>
                <span className="num">3</span>
                <span className="stepbody">Start the dev server, then open the local URL it prints.</span>
              </li>
              <li>
                <span className="num">4</span>
                <span className="stepbody">
                  Edit values in <b>Parameters table</b> and press <b>Run</b> to re-simulate.{" "}
                  <span className="sub">Changes are not saved to the cloud.</span>
                </span>
              </li>
            </ol>

            <div className="snippet">
              <div className="line">
                <span className="prompt">$ </span>git clone https://github.com/vibra/app.git
              </div>
              <div className="line">
                <span className="prompt">$ </span>cd app &amp;&amp; npm install
              </div>
              <div className="line">
                <span className="prompt">$ </span>npm run dev{" "}
                <span className="cmt"># → http://localhost:5173</span>
              </div>
            </div>
          </article>

          {/* Web application */}
          <article className="card">
            <div className="card-head">
              <span className="card-icon">
                <Globe size={20} strokeWidth={2} />
              </span>
              <h2>Web application</h2>
              <span className="tag">HOSTED</span>
            </div>
            <p className="lead">
              Use the deployed app for the live dashboard with your team&apos;s saved data —
              no setup needed, just sign in from any browser.
            </p>

            <ol className="steps">
              <li>
                <span className="num">1</span>
                <span className="stepbody">Open the app URL below and sign in with your work email.</span>
              </li>
              <li>
                <span className="num">2</span>
                <span className="stepbody">
                  Pick your workspace, then land on the <b>Dashboard</b>.
                </span>
              </li>
              <li>
                <span className="num">3</span>
                <span className="stepbody">
                  Read live results and browse past runs under <b>History</b>.
                </span>
              </li>
              <li>
                <span className="num">4</span>
                <span className="stepbody">
                  Invite teammates from <b>Team</b> so everyone shares the same data.{" "}
                  <span className="sub">Edits sync automatically.</span>
                </span>
              </li>
            </ol>

            <div className="link-row">
              <Link2 size={16} strokeWidth={2} color="#b06cf0" />
              <a href="https://app.vibra.io" target="_blank" rel="noopener noreferrer">
                app.vibra.io
              </a>
              <button className="copy" onClick={copyUrl}>
                Copy
              </button>
            </div>
          </article>
        </section>

        <p className="footnote">
          <b>Not sure which to use?</b> Reach for the web application day to day. Run the
          prototype only when you need to tinker locally without touching shared data.
        </p>
      </div>
    </>
  );
}