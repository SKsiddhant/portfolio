export const PROFILE = {
  name: 'Siddhant Kothiya',
  role: 'Full-stack · Data · Accessibility Engineer',
  // TODO: edit to your voice
  intro:
    'I build software that turns rough ideas into things people can use — trading systems, ' +
    'scientific tooling, and accessible, multilingual interfaces. I care about clean APIs, ' +
    'careful edge cases, and experiences that work for everyone.',
  github: 'https://github.com/SKsiddhant',
  // TODO: replace with real links
  linkedin: 'https://www.linkedin.com/in/your-handle',
  email: 'you@example.com',
  leetcode: 'https://github.com/SKsiddhant/leetcode_questions',
};

// Links are relative to the Pages root (/portfolio/) for the on-site pages,
// and absolute to GitHub for source.
export const PROJECTS = [
  {
    id: 'quantforge',
    featured: true,
    kicker: 'Flagship · Algorithmic Trading',
    name: 'QuantForge',
    desc:
      'A trading engine that runs live intraday paper trading on Zerodha Kite (NSE) and backtests strategies with walk-forward and Monte Carlo analysis. Python core, browser demo with a replayable session.',
    tech: ['Python', 'Zerodha Kite', 'Backtesting', 'Monte Carlo', 'Walk-forward'],
    live: 'quantforge/demo/#live',
    liveLabel: 'Watch it trade',
    code: 'https://github.com/SKsiddhant/portfolio/tree/main/quantforge',
  },
  {
    id: 'accessible-portal',
    kicker: 'Accessibility · i18n',
    name: 'Accessible Student Help Portal',
    desc:
      'A multilingual help desk (English, हिन्दी, ગુજરાતી) with a rule-based chatbot, read-aloud, an on-screen keyboard, and large-text / high-contrast modes.',
    tech: ['JavaScript', 'a11y', 'i18n', 'Web Speech'],
    live: 'accessible-portal/',
    liveLabel: 'Open demo',
    code: 'https://github.com/SKsiddhant/portfolio/tree/main/accessible-portal',
  },
  {
    id: 'lab-inventory',
    kicker: 'Full-stack · Auth',
    name: 'Lab Inventory System',
    desc:
      'Lab asset tracking with token auth, item CRUD, issue/return transactions and CSV import/export — an Express + SQLite API with a React client.',
    tech: ['Node', 'Express', 'SQLite', 'JWT', 'React'],
    code: 'https://github.com/SKsiddhant/portfolio/tree/main/lab-inventory',
  },
  {
    id: 'petition-platform',
    kicker: 'Real-time · SSE',
    name: 'Petition Platform',
    desc:
      'Campus petitions with domain-restricted sign-ups, duplicate-signature guards and a live counter streamed over server-sent events. Express + SQLite.',
    tech: ['Node', 'Express', 'SQLite', 'SSE'],
    code: 'https://github.com/SKsiddhant/portfolio/tree/main/petition-platform',
  },
  {
    id: 'solar-flare-detector',
    kicker: 'Data / Science',
    name: 'Solar Flare Detector',
    desc:
      'Detects and classifies solar X-ray bursts (GOES A–X classes) in a light curve using Gaussian smoothing, peak finding and curve fitting. Flask + NumPy/SciPy.',
    tech: ['Python', 'Flask', 'NumPy', 'SciPy'],
    code: 'https://github.com/SKsiddhant/portfolio/tree/main/solar-flare-detector',
  },
];
