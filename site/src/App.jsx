import { useEffect, useRef, useState } from 'react';
import { PaperTexture } from '@paper-design/shaders-react';
import { PROFILE, PROJECTS } from './data.js';

/* build a radial normal map for the water-drop refraction (encodes x/y displacement) */
function lensMapDataURL(size = 240) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - r) / r, dy = (y - r) / r;
      const d = Math.hypot(dx, dy);
      let nx = 0, ny = 0, a = 0;
      if (d < 1) {
        const ease = Math.pow(d, 2.2) * (1 - d) * 4.2; // rim-weighted refraction
        nx = (dx / (d || 1)) * ease;
        ny = (dy / (d || 1)) * ease;
        a = 1;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, 128 + nx * 127));
      img.data[i + 1] = Math.max(0, Math.min(255, 128 + ny * 127));
      img.data[i + 2] = 128;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function Drops() {
  const feRef = useRef(null);
  const dropRef = useRef(null);
  const map = useRef('');
  const pos = useRef({ x: -999, y: -999, tx: -999, ty: -999 });
  const SIZE = 230;
  useEffect(() => {
    map.current = lensMapDataURL(SIZE);
    if (feRef.current) feRef.current.setAttribute('href', map.current);
    const onMove = (e) => { pos.current.tx = e.clientX; pos.current.ty = e.clientY; };
    window.addEventListener('pointermove', onMove);
    let raf;
    const loop = () => {
      const p = pos.current;
      p.x += (p.tx - p.x) * 0.18; p.y += (p.ty - p.y) * 0.18;
      if (feRef.current) { feRef.current.setAttribute('x', p.x - SIZE / 2); feRef.current.setAttribute('y', p.y - SIZE / 2); }
      if (dropRef.current) dropRef.current.style.transform = `translate(${p.x - SIZE / 2}px, ${p.y - SIZE / 2}px)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(raf); };
  }, []);
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <filter id="dropFilter" filterUnits="userSpaceOnUse" x="0" y="0" width="6000" height="6000">
          <feImage ref={feRef} x="-999" y="-999" width={SIZE} height={SIZE} result="lmap" preserveAspectRatio="none" />
          <feDisplacementMap in="SourceGraphic" in2="lmap" scale="46" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div id="lens" />
      <div className="drop" ref={dropRef} style={{ width: SIZE, height: SIZE, left: 0, top: 0 }} />
      {/* idle decorative drops */}
      <div className="drop" style={{ width: 90, height: 90, left: '12%', top: '30%' }} />
      <div className="drop" style={{ width: 54, height: 54, left: '82%', top: '22%' }} />
      <div className="drop" style={{ width: 120, height: 120, left: '74%', top: '68%' }} />
    </>
  );
}

function useReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }),
      { threshold: 0.1 }
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function WorkRow({ p, i, open, onToggle }) {
  return (
    <div className={`wrow ${open ? 'open' : ''}`} onClick={onToggle}>
      <span className="no">{String(i + 1).padStart(2, '0')}</span>
      <span className="nm">{p.name}{p.featured && <span className="feat">FLAGSHIP</span>}</span>
      <span className="role">{p.kicker}</span>
      <span className="plus">+</span>
      <div className="detail">
        <p>{p.desc}</p>
        <div className="tags">{p.tech.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
        <div className="links" onClick={(e) => e.stopPropagation()}>
          {p.live && <a className="dlink" href={p.live}>{p.liveLabel || 'Open'} ↗</a>}
          <a className="dlink" href={p.code} target="_blank" rel="noopener">Source ↗</a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [open, setOpen] = useState(0); // first (QuantForge) open by default
  useReveal();
  return (
    <>
      <div id="bg">
        <PaperTexture
          style={{ width: '100%', height: '100%' }}
          colorBack="#efeadd"
          colorPaper="#f6f3ea"
          colorShadow="#d8d2c2"
          roughness={0.5}
          fiber={0.45}
          folds={0.5}
          wrinkles={0.6}
          crumples={0.25}
          crumpleCount={6}
          scale={0.9}
          minPixelRatio={1}
        />
      </div>
      <Drops />

      <nav>
        <div className="in">
          <a href="#top" className="brand">SIDDHANT KOTHIYA</a>
          <div className="right">
            <a className="nl" href="#work">WORK</a>
            <a className="nl" href="#about">ABOUT</a>
            <a className="nl" href="#contact">CONTACT</a>
            <a className="src" href={PROFILE.github} target="_blank" rel="noopener">GITHUB ↗</a>
          </div>
        </div>
      </nav>

      <div className="content">
        {/* hero */}
        <section className="hero" id="top">
          <div className="wrap">
            <p className="kick reveal">{PROFILE.role}</p>
            <div className="bigword reveal">
              <span className="blk" />
              <h1>Siddhant</h1>
            </div>
            <div className="sub">
              <p className="lead reveal">{PROFILE.intro}</p>
              <p className="meta reveal">BASED IN INDIA<br />FULL-STACK · DATA · A11Y<br />AVAILABLE FOR WORK</p>
            </div>
          </div>
        </section>

        {/* marquee */}
        <div className="marquee" aria-hidden="true">
          <div className="track">
            {Array.from({ length: 2 }).map((_, k) => (
              <span key={k}>Selected Work <span className="st">Selected Work</span> Selected Work <span className="st">Selected Work</span>{' '}</span>
            ))}
          </div>
        </div>

        {/* work */}
        <section id="work">
          <div className="wrap">
            <div className="sec-head">
              <span className="lbl">— Selected Work</span>
              <span className="count">{String(PROJECTS.length).padStart(2, '0')} Projects</span>
            </div>
            <div className="wlist">
              {PROJECTS.map((p, i) => (
                <WorkRow key={p.id} p={p} i={i} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
              ))}
            </div>
          </div>
        </section>

        {/* about */}
        <section className="about" id="about">
          <div className="wrap">
            <div className="sec-head"><span className="lbl">— About</span></div>
            <p className="statement reveal">I build software that turns rough ideas into things people can actually <em>use.</em></p>
            <div className="row">
              <div className="reveal">
                <div className="k">Focus</div>
                <p>Trading systems, APIs, scientific tooling, and accessible, multilingual interfaces. I care about clean contracts and careful edge cases.</p>
              </div>
              <div className="reveal">
                <div className="k">Toolkit</div>
                <p>Python · Node · Express · React · SQLite · NumPy / SciPy · a11y / i18n</p>
                <div className="k" style={{ marginTop: 18 }}>Also</div>
                <a href={PROFILE.leetcode} target="_blank" rel="noopener">LeetCode solutions ↗</a>
              </div>
            </div>
          </div>
        </section>

        {/* contact */}
        <section className="contact" id="contact">
          <div className="wrap">
            <div className="sec-head"><span className="lbl">— Contact</span></div>
            <h2 className="big reveal">Let's talk.</h2>
            <a className="mail reveal" href={`mailto:${PROFILE.email}`}>{PROFILE.email} ↗</a>
          </div>
        </section>

        <footer>
          <div className="wrap">
            <div className="cols">
              <div className="col">
                <div className="h">Index</div>
                <a href="#work">Work</a><a href="#about">About</a><a href="#contact">Contact</a>
              </div>
              <div className="col">
                <div className="h">Elsewhere</div>
                <a href={PROFILE.github} target="_blank" rel="noopener">GitHub ↗</a>
                <a href={PROFILE.linkedin} target="_blank" rel="noopener">LinkedIn ↗</a>
                <a href={PROFILE.leetcode} target="_blank" rel="noopener">LeetCode ↗</a>
              </div>
              <div className="col">
                <div className="h">Contact</div>
                <a href={`mailto:${PROFILE.email}`}>{PROFILE.email}</a>
              </div>
              <div className="col">
                <div className="h">Status</div>
                <p>Open for work</p><p>{new Date().getFullYear()}</p>
              </div>
            </div>
            <div className="brandbig">Siddhant Kothiya</div>
            <div className="fine">© {new Date().getFullYear()} SIDDHANT KOTHIYA · BUILT WITH PAPER SHADERS (APACHE-2.0) · NO TRACKERS</div>
          </div>
        </footer>
      </div>
    </>
  );
}
