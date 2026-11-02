import { useEffect, useRef, useState } from 'react';
import { MeshGradient } from '@paper-design/shaders-react';
import { PROFILE, PROJECTS } from './data.js';

function GitIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
const Arrow = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M7 17L17 7M8 7h9v9" /></svg>;

function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }),
      { threshold: 0.12 }
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

export default function App() {
  const [scrolled, setScrolled] = useState(false);
  const featured = PROJECTS.find((p) => p.featured);
  const rest = PROJECTS.filter((p) => !p.featured);
  useReveal();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on(); addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);

  return (
    <>
      <div id="bg">
        <MeshGradient
          style={{ width: '100%', height: '100%' }}
          colors={['#f3ecdd', '#e7d3b6', '#c57b4e', '#2c2a4a']}
          distortion={0.9}
          swirl={0.35}
          speed={0.25}
          minPixelRatio={1}
        />
      </div>
      <div className="grain" />

      <nav className={scrolled ? 'scrolled' : ''}>
        <div className="in">
          <a href="#top" className="brand">Siddhant Kothiya</a>
          <div className="links">
            <a href="#about">About</a>
            <a href="#work">Work</a>
            <a href="#contact">Contact</a>
            <a className="gh" href={PROFILE.github} target="_blank" rel="noopener">GitHub</a>
          </div>
        </div>
      </nav>

      <div className="content">
        {/* hero */}
        <section className="hero" id="top">
          <div className="wrap">
            <p className="eyebrow reveal">{PROFILE.role}</p>
            <h1 className="reveal">Building software that <em>works for everyone</em>.</h1>
            <p className="lead reveal">{PROFILE.intro}</p>
            <div className="cta reveal">
              <a className="btn primary" href="#work">View work</a>
              <a className="btn ghost" href={PROFILE.github} target="_blank" rel="noopener"><GitIcon /> GitHub</a>
            </div>
          </div>
          <div className="scrollcue">↓ SCROLL</div>
        </section>

        {/* about */}
        <section className="about" id="about">
          <div className="wrap">
            <p className="sec-label reveal">About</p>
            <div className="cols">
              <p className="reveal">Full-stack builder with a soft spot for data, finance tooling and accessible design.</p>
              <div className="facts">
                <div className="fact reveal"><div className="k">Focus</div><div className="v">Trading systems, APIs, accessible UIs</div></div>
                <div className="fact reveal"><div className="k">Stack</div><div className="v">Python · Node · React · SQLite · NumPy/SciPy</div></div>
                <div className="fact reveal"><div className="k">Also</div><div className="v"><a className="link" href={PROFILE.leetcode} target="_blank" rel="noopener">LeetCode solutions →</a></div></div>
              </div>
            </div>
          </div>
        </section>

        {/* work */}
        <section id="work">
          <div className="wrap">
            <p className="sec-label reveal">Selected Work</p>
            <h2 className="sec-title reveal">Things I've built</h2>

            {featured && (
              <article className="feature reveal">
                <div className="kick">{featured.kicker}</div>
                <h3>{featured.name}</h3>
                <p>{featured.desc}</p>
                <div className="tags">{featured.tech.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                <div className="links">
                  <a className="btn primary" href={featured.live}>{featured.liveLabel} <Arrow /></a>
                  <a className="btn ghost" href={featured.code} target="_blank" rel="noopener">Source</a>
                </div>
              </article>
            )}

            <div className="grid">
              {rest.map((p) => (
                <article className="card reveal" key={p.id}>
                  <div className="kick">{p.kicker}</div>
                  <h4>{p.name}</h4>
                  <p>{p.desc}</p>
                  <div className="tags">{p.tech.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
                  <div className="links">
                    {p.live && <a className="link" href={p.live}>{p.liveLabel || 'Open'} <Arrow /></a>}
                    <a className="link muted" href={p.code} target="_blank" rel="noopener">Source</a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* contact */}
        <section className="contact" id="contact">
          <div className="wrap">
            <p className="sec-label reveal" style={{ justifyContent: 'center' }}>Contact</p>
            <h2 className="reveal">Let's make <em>something</em>.</h2>
            <p className="reveal">Open to internships, projects and collaboration. Email is the fastest way to reach me.</p>
            <div className="links reveal">
              <a className="btn primary" href={`mailto:${PROFILE.email}`}>Say hello</a>
              <a className="btn ghost" href={PROFILE.github} target="_blank" rel="noopener"><GitIcon /> GitHub</a>
              <a className="btn ghost" href={PROFILE.linkedin} target="_blank" rel="noopener">LinkedIn</a>
            </div>
          </div>
        </section>

        <footer>
          <div className="in">
            <span>© {new Date().getFullYear()} {PROFILE.name}</span>
            <span>Built with Paper shaders · React</span>
          </div>
        </footer>
      </div>
    </>
  );
}
