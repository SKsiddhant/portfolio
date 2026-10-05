// Pure logic: translations, chatbot, notifications. No DOM, so it is unit-testable.
export const STRINGS = {
  en: { title: 'Student Help Portal', ask: 'Ask a question', send: 'Send', read: 'Read aloud', notices: 'Notices', hello: 'Hello! Ask about fees, timetable, exams or library.' },
  hi: { title: 'छात्र सहायता पोर्टल', ask: 'अपना प्रश्न पूछें', send: 'भेजें', read: 'पढ़कर सुनाएँ', notices: 'सूचनाएँ', hello: 'नमस्ते! फीस, समय-सारणी, परीक्षा या पुस्तकालय के बारे में पूछें।' },
  gu: { title: 'વિદ્યાર્થી સહાય પોર્ટલ', ask: 'તમારો પ્રશ્ન પૂછો', send: 'મોકલો', read: 'વાંચી સંભળાવો', notices: 'સૂચનાઓ', hello: 'નમસ્તે! ફી, સમયપત્રક, પરીક્ષા કે પુસ્તકાલય વિશે પૂછો.' },
};
export const LANGS = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' };
export function t(lang, key) { return (STRINGS[lang] ?? STRINGS.en)[key] ?? STRINGS.en[key] ?? key; }

const RULES = [
  { topic: 'fees', words: ['fee', 'fees', 'payment', 'फीस', 'ફી'], en: 'Fees are due by the 10th of each month at the accounts office or online.', hi: 'फीस हर महीने की 10 तारीख तक जमा करनी है।', gu: 'ફી દર મહિનાની 10 તારીખ સુધી ભરવાની છે.' },
  { topic: 'timetable', words: ['timetable', 'schedule', 'class', 'समय', 'સમય'], en: 'The timetable is on the notice board and updated every Monday.', hi: 'समय-सारणी नोटिस बोर्ड पर है और हर सोमवार अपडेट होती है।', gu: 'સમયપત્રક નોટિસ બોર્ડ પર છે અને દર સોમવારે અપડેટ થાય છે.' },
  { topic: 'exam', words: ['exam', 'test', 'परीक्षा', 'પરીક્ષા'], en: 'Exam dates are listed under Notices. Bring your ID card.', hi: 'परीक्षा की तिथियाँ सूचनाओं में हैं। पहचान पत्र लाएँ।', gu: 'પરીક્ષાની તારીખો સૂચનાઓમાં છે. ઓળખપત્ર લાવો.' },
  { topic: 'library', words: ['library', 'book', 'पुस्तकालय', 'પુસ્તકાલય'], en: 'The library is open 9am to 5pm, Monday to Saturday.', hi: 'पुस्तकालय सोमवार से शनिवार, सुबह 9 से शाम 5 बजे तक खुला है।', gu: 'પુસ્તકાલય સોમવારથી શનિવાર, સવારે 9 થી સાંજે 5 સુધી ખુલ્લું છે.' },
];
const FALLBACK = { en: "Sorry, I don't know that yet. Please ask the office.", hi: 'क्षमा करें, मुझे अभी यह नहीं पता। कृपया कार्यालय से पूछें।', gu: 'માફ કરશો, મને હજી ખબર નથી. કૃપા કરી ઓફિસને પૂછો.' };

export function reply(text, lang = 'en') {
  const s = String(text).toLowerCase();
  const hit = RULES.find((r) => r.words.some((w) => s.includes(w)));
  return { topic: hit?.topic ?? null, text: hit ? hit[lang] ?? hit.en : FALLBACK[lang] ?? FALLBACK.en };
}

// Notices become "due soon" within `days` days; past ones are hidden.
export function upcoming(notices, now, days = 7) {
  const DAY = 86400000;
  return notices
    .map((n) => ({ ...n, in: Math.ceil((new Date(n.date) - now) / DAY) }))
    .filter((n) => n.in >= 0)
    .sort((a, b) => a.in - b.in)
    .map((n) => ({ ...n, soon: n.in <= days }));
}

export const KEYBOARD = {
  en: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  hi: ['कखगघचछजझ', 'टठडढतथदध', 'नपफबभमयर', 'लवशसहािीुूेैोौं'],
  gu: ['કખગઘચછજઝ', 'ટઠડઢતથદધ', 'નપફબભમયર', 'લવશસહાિીુૂેૈોૌં'],
};
export function typeKey(value, key) {
  if (key === 'BACK') return [...value].slice(0, -1).join('');
  if (key === 'SPACE') return value + ' ';
  return value + key;
}
