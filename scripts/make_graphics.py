# Generates the README graphics for Inkline (docs/images/*.svg).
import os, random, sys
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "docs", "images")
os.makedirs(OUT, exist_ok=True)

SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
SERIF = "Georgia, 'Times New Roman', serif"
C = dict(bg='#f5f4f0', card='#ffffff', paper='#faf9f6', ink='#1b1b19', muted='#5f5e57', faint='#8a897f',
         border='#e4e2dc', accent='#1a7f5a', accentDark='#146448', soft='#e3f1ea', red='#c8382a', redSoft='#fbe4df',
         gray='#c9c7bf')

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
def text(x, y, s, size=16, weight=400, fill=C['ink'], family=SANS, anchor='start', extra=''):
    return f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {extra}>{esc(s)}</text>'
def svg(w, h, body, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{esc(label)}">\n'
            f'<rect width="{w}" height="{h}" rx="28" fill="{C["bg"]}"/>\n{body}\n</svg>\n')
def bar(x, base, w, h, fill, r=4):
    if h < r * 2: r = h / 2
    return f'<path d="M{x},{base} V{base-h+r} Q{x},{base-h} {x+r},{base-h} H{x+w-r} Q{x+w},{base-h} {x+w},{base-h+r} V{base} Z" fill="{fill}"/>'

# ---------------------------------------------------------------- hero (animated)
DUR = 12.0
kt = lambda t: f'{t / DUR:.4f}'
def reveal(cid, x, y, w, t0, t1):
    return (f'<clipPath id="{cid}"><rect x="{x}" y="{y}" height="40" width="0">'
            f'<animate attributeName="width" dur="{DUR}s" repeatCount="indefinite" values="0;0;{w};{w}" keyTimes="0;{kt(t0)};{kt(t1)};1"/></rect></clipPath>')
def appear(t, until=DUR):  # discrete opacity on [t, until)
    if until >= DUR:
        return f'<animate attributeName="opacity" dur="{DUR}s" repeatCount="indefinite" calcMode="discrete" values="0;1" keyTimes="0;{kt(t)}"/>'
    return f'<animate attributeName="opacity" dur="{DUR}s" repeatCount="indefinite" calcMode="discrete" values="0;1;0" keyTimes="0;{kt(t)};{kt(until)}"/>'
def caret(base, keys, show, hide):
    xs = ';'.join(str(x) for _, x in keys)
    ts = ';'.join(kt(t) for t, _ in keys)
    return (f'<rect y="{base - 17}" width="2" height="22" rx="1" fill="{C["accent"]}" x="{keys[0][1]}" opacity="0">'
            f'<animate attributeName="x" dur="{DUR}s" repeatCount="indefinite" values="{xs}" keyTimes="{ts}"/>{appear(show, hide)}</rect>')

W = dict(T1=352.4, T2=382.8, T3=381.8, A=174.4, B=77.3, C=103.6, T5=271.8, T6=273.1, chip=104.1)
X = 688
y1, y2, y3, y4, y5, y6 = 172, 222, 256, 290, 338, 372
xB = X + W['A']
chipW = W['chip'] + 20
x5 = X + chipW + 10

hero = []
hero.append(f'<defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="135%"><feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#1b1b19" flood-opacity="0.08"/></filter>')
hero.append(reveal('c1', X, y1 - 26, W['T1'] + 2, 0.3, 1.6))
hero.append(reveal('c2', X, y2 - 26, W['T2'] + 2, 2.0, 3.6))
hero.append(reveal('c3', X, y3 - 26, W['T3'] + 2, 3.7, 5.3))
hero.append(reveal('c4a', X, y4 - 26, W['A'] + 1, 5.4, 6.3))
hero.append(reveal('c4b', xB, y4 - 26, W['B'] + 2, 6.3, 6.9))
hero.append(reveal('c4c', xB, y4 - 26, W['C'] + 2, 8.1, 8.9))
hero.append('</defs>')

# Left column
hero.append(f'<rect x="80" y="128" width="236" height="32" rx="16" fill="{C["soft"]}"/>')
hero.append(text(98, 149, 'Writing history for students', 14, 600, C['accentDark']))
hero.append(text(76, 246, 'Inkline', 78, 700, C['ink'], extra='letter-spacing="-2.5"'))
hero.append(f'<circle cx="305" cy="238" r="8.5" fill="{C["accent"]}"/>')
hero.append(text(80, 298, 'Show how your writing came together.', 25, 500, C['ink']))
hero.append(text(80, 332, 'Every edit, played back as a timelapse.', 25, 400, C['muted']))
for i, item in enumerate(['Records Google Docs automatically', 'Stays on your device, about 7 KB an hour', 'Exports a video anyone can watch']):
    y = 404 + i * 38
    hero.append(f'<circle cx="91" cy="{y - 6}" r="11" fill="{C["soft"]}"/>')
    hero.append(f'<path d="M86,{y - 6} l3.5,3.5 l6.5,-7" fill="none" stroke="{C["accent"]}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>')
    hero.append(text(112, y, item, 17, 400, C['muted']))

# Window
hero.append(f'<g filter="url(#shadow)"><rect x="640" y="64" width="568" height="472" rx="18" fill="{C["card"]}" stroke="{C["border"]}"/></g>')
for i in range(3):
    hero.append(f'<circle cx="{668 + i * 18}" cy="89" r="5" fill="{C["border"]}"/>')
hero.append(text(924, 94, 'Essay draft · History 101', 14, 600, C['ink'], anchor='middle'))
hero.append(f'<line x1="640" y1="114" x2="1208" y2="114" stroke="{C["border"]}"/>')

doc = []
doc.append(f'<g clip-path="url(#c1)">{text(X, y1, "Why the printing press mattered", 21, 700, C["ink"], SERIF)}</g>')
doc.append(f'<g clip-path="url(#c2)">{text(X, y2, "The printing press changed how ideas moved.", 19, 400, C["ink"], SERIF)}</g>')
doc.append(f'<g clip-path="url(#c3)">{text(X, y3, "Before it, a book was copied by hand, and one", 19, 400, C["ink"], SERIF)}</g>')
doc.append(f'<g clip-path="url(#c4a)">{text(X, y4, "slip could live on for ", 19, 400, C["ink"], SERIF)}</g>')
# "centuries": typed, then deleted (red strikethrough, fades), then replaced
doc.append(f'<g clip-path="url(#c4b)"><g>'
           f'<animate attributeName="opacity" dur="{DUR}s" repeatCount="indefinite" values="1;1;1;0;0" keyTimes="0;{kt(7.4)};{kt(7.7)};{kt(8.05)};1"/>'
           f'<rect x="{xB - 2}" y="{y4 - 18}" width="{W["B"] + 4}" height="24" rx="4" fill="{C["redSoft"]}" opacity="0">{appear(7.3, 8.05)}</rect>'
           f'<text x="{xB}" y="{y4}" font-family="{SERIF}" font-size="19" fill="{C["ink"]}">centuries'
           f'<animate attributeName="fill" dur="{DUR}s" repeatCount="indefinite" calcMode="discrete" values="{C["ink"]};{C["red"]};{C["ink"]}" keyTimes="0;{kt(7.3)};{kt(8.05)}"/></text>'
           f'<rect x="{xB}" y="{y4 - 7}" width="{W["B"]}" height="1.6" fill="{C["red"]}" opacity="0">{appear(7.3, 8.05)}</rect>'
           f'</g></g>')
doc.append(f'<g clip-path="url(#c4c)">{text(xB, y4, "generations.", 19, 400, C["ink"], SERIF)}</g>')
# Paste: appears all at once, highlighted and labelled
paste = [f'<rect x="{x5 - 4}" y="{y5 - 19}" width="{W["T5"] + 8}" height="26" rx="4" fill="{C["soft"]}"/>',
         f'<rect x="{X - 4}" y="{y6 - 19}" width="{W["T6"] + 8}" height="26" rx="4" fill="{C["soft"]}"/>',
         f'<rect x="{X}" y="{y5 - 16}" width="{chipW}" height="22" rx="11" fill="{C["accent"]}"/>',
         text(X + 10, y5 - 1, 'Pasted · 112 chars', 12, 600, '#ffffff'),
         text(x5, y5, '“The art of printing preserves all', 19, 400, C['ink'], SERIF),
         text(X, y6, 'other arts,” as one printer wrote.', 19, 400, C['ink'], SERIF)]
doc.append(f'<g opacity="0">{appear(9.4)}{"".join(paste)}</g>')
# Carets
doc.append(caret(y1, [(0, X), (0.3, X), (1.6, X + W['T1'] + 2), (DUR, X + W['T1'] + 2)], 0.3, 1.95))
doc.append(caret(y2, [(0, X), (2.0, X), (3.6, X + W['T2'] + 2), (DUR, X + W['T2'] + 2)], 1.95, 3.65))
doc.append(caret(y3, [(0, X), (3.7, X), (5.3, X + W['T3'] + 2), (DUR, X + W['T3'] + 2)], 3.65, 5.35))
e = xB + W['B'] + 1
doc.append(caret(y4, [(0, X), (5.4, X), (6.3, xB), (6.9, e), (7.3, e), (8.05, xB), (8.1, xB), (8.9, xB + W['C'] + 1), (DUR, xB + W['C'] + 1)], 5.35, 9.4))
doc.append(caret(y6, [(0, X + W['T6'] + 2), (DUR, X + W['T6'] + 2)], 9.4, 11.6))
hero.append(f'<g><animate attributeName="opacity" dur="{DUR}s" repeatCount="indefinite" values="1;1;0;0" keyTimes="0;{kt(11.3)};{kt(11.8)};1"/>{"".join(doc)}</g>')

# Player controls
hero.append(f'<line x1="640" y1="466" x2="1208" y2="466" stroke="{C["border"]}"/>')
hero.append(f'<circle cx="684" cy="501" r="18" fill="{C["accent"]}"/>')
hero.append(f'<rect x="678" y="493" width="4" height="16" rx="1" fill="#fff"/><rect x="686" y="493" width="4" height="16" rx="1" fill="#fff"/>')
hero.append(f'<rect x="718" y="494" width="380" height="4" rx="2" fill="{C["border"]}"/>')
hero.append(f'<rect x="718" y="494" width="0" height="4" rx="2" fill="{C["accent"]}"><animate attributeName="width" dur="{DUR}s" repeatCount="indefinite" values="0;380;380" keyTimes="0;{kt(11.3)};1"/></rect>')
hero.append(text(718, 520, 'Session 3 of 7 · idle time skipped', 12, 400, C['faint']))
hero.append(text(1176, 501, '12×', 14, 600, C['ink'], anchor='end'))
hero.append(text(1176, 520, 'speed', 12, 400, C['faint'], anchor='end'))

open(f'{OUT}/hero.svg', 'w').write(svg(1280, 600, '\n'.join(hero), 'Inkline: a writing timelapse playing back an essay being typed, revised and partly pasted'))

# ---------------------------------------------------------------- how it works
how = []
cards = [
    ('1', 'Write like you normally do', ['Type in Google Docs, or on any site', 'you switch on. Nothing to start.']),
    ('2', 'Every edit is logged', ['Inserts, deletes and pastes, with', 'timestamps. Text only, on device.']),
    ('3', 'Share the timelapse', ['Export a video for your teacher,', 'or the full history as a file.']),
]
for i, (n, title, body) in enumerate(cards):
    x = 64 + i * 400
    how.append(f'<rect x="{x}" y="56" width="352" height="320" rx="18" fill="{C["card"]}" stroke="{C["border"]}"/>')
    how.append(f'<circle cx="{x + 46}" cy="104" r="18" fill="{C["soft"]}"/>')
    how.append(text(x + 46, 110, n, 16, 700, C['accentDark'], anchor='middle'))
    how.append(text(x + 28, 164, title, 20, 600))
    for j, line in enumerate(body):
        how.append(text(x + 28, 194 + j * 22, line, 15, 400, C['muted']))
    ix, iy = x + 28, 250
    how.append(f'<rect x="{ix}" y="{iy}" width="296" height="96" rx="12" fill="{C["paper"]}" stroke="{C["border"]}"/>')
    if n == '1':
        for k, (w, y) in enumerate([(220, 274), (250, 296), (180, 318)]):
            how.append(f'<rect x="{ix + 20}" y="{y - 5}" width="{w}" height="8" rx="4" fill="{C["gray"]}" opacity="{0.9 - k * 0.15}"/>')
        how.append(f'<rect x="{ix + 204}" y="{309}" width="2" height="18" rx="1" fill="{C["accent"]}"/>')
    elif n == '2':
        rows = [('+', C['accent'], 'insert', '"because"', '0:05.2'),
                ('−', C['red'], 'delete', '4 chars', '0:06.9'),
                ('□', C['ink'], 'paste', '112 chars', '0:09.1')]
        for k, (sym, col, op, what, t) in enumerate(rows):
            y = iy + 30 + k * 24
            how.append(text(ix + 18, y, sym, 14, 700, col, MONO))
            how.append(text(ix + 38, y, op, 13, 400, C['ink'], MONO))
            how.append(text(ix + 106, y, what, 13, 400, C['muted'], MONO))
            how.append(text(ix + 278, y, t, 13, 400, C['faint'], MONO, 'end'))
    else:
        how.append(f'<rect x="{ix + 12}" y="{iy + 12}" width="128" height="72" rx="8" fill="{C["ink"]}"/>')
        for k, w in enumerate([84, 100, 62]):
            how.append(f'<rect x="{ix + 24}" y="{iy + 26 + k * 12}" width="{w}" height="5" rx="2.5" fill="#ffffff" opacity="0.25"/>')
        how.append(f'<circle cx="{ix + 76}" cy="{iy + 48}" r="15" fill="{C["accent"]}"/>')
        how.append(f'<path d="M{ix + 71},{iy + 40} L{ix + 84},{iy + 48} L{ix + 71},{iy + 56} Z" fill="#ffffff"/>')
        for k, name in enumerate(['essay.mp4', 'essay.inkline']):
            y = iy + 20 + k * 34
            how.append(f'<rect x="{ix + 154}" y="{y}" width="128" height="26" rx="13" fill="{C["card"]}" stroke="{C["border"]}"/>')
            how.append(text(ix + 218, y + 18, name, 13, 500, C['ink'], MONO, 'middle'))
    if i < 2:
        ax = x + 376
        how.append(f'<path d="M{ax - 6},206 l8,10 l-8,10" fill="none" stroke="{C["faint"]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')
open(f'{OUT}/how-it-works.svg', 'w').write(svg(1280, 432, '\n'.join(how), 'How Inkline works: write normally, every edit is logged on your device, then share a timelapse video or history file'))

# ---------------------------------------------------------------- evidence
ev = []
stats = [('Active writing time', '3h 42m', 'Pauses over 3 s not counted'),
         ('Typed', '14,206', '2,931 deleted along the way'),
         ('Pasted', '2%', 'Two quotes, 312 chars'),
         ('Sessions', '7', 'Oct 2 – Oct 9')]
for i, (label, value, note) in enumerate(stats):
    x = 64 + i * 292
    ev.append(f'<rect x="{x}" y="56" width="276" height="128" rx="16" fill="{C["card"]}" stroke="{C["border"]}"/>')
    ev.append(text(x + 24, 92, label, 14, 400, C['muted']))
    ev.append(text(x + 24, 136, value, 34, 650, C['ink'], extra='letter-spacing="-0.8"'))
    ev.append(text(x + 24, 164, note, 13, 400, C['faint']))

ev.append(f'<rect x="64" y="208" width="1152" height="428" rx="16" fill="{C["card"]}" stroke="{C["border"]}"/>')
ev.append(text(96, 250, 'Characters added, every 10 minutes', 17, 600))
ev.append(text(1184, 250, 'Same scale for both', 13, 400, C['faint'], anchor='end'))

random.seed(7)
counts = [6, 9, 5, 8, 7, 10, 6]
days = ['Oct 2', 'Oct 3', 'Oct 4', 'Oct 6', 'Oct 7', 'Oct 8', 'Oct 9']
BW, GAP = 10, 2
inner = sum(counts) * (BW + GAP) - GAP * len(counts)
sgap = (1088 - inner) / (len(counts) - 1)
SCALE = 90 / 420  # px per char
baseA = 420
ev.append(text(96, 294, 'Drafted over a week', 15, 600))
ev.append(text(1184, 294, '7 sessions, revisions throughout', 13, 400, C['muted'], anchor='end'))
ev.append(f'<line x1="96" y1="{baseA}" x2="1184" y2="{baseA}" stroke="{C["border"]}"/>')
x = 96
paste_marks = {(1, 4), (5, 7)}
for s, n in enumerate(counts):
    start = x
    for b in range(n):
        chars = random.randint(60, 400)
        h = chars * SCALE
        ev.append(bar(x, baseA, BW, h, C['accent']))
        if (s, b) in paste_marks:
            cx = x + BW / 2
            my = baseA - 106
            ev.append(f'<line x1="{cx}" y1="{my + 6}" x2="{cx}" y2="{baseA - h - 3}" stroke="{C["faint"]}" stroke-width="1" stroke-dasharray="2 3"/>')
            ev.append(f'<circle cx="{cx}" cy="{my}" r="5" fill="#ffffff" stroke="{C["ink"]}" stroke-width="2"/>')
            ev.append(text(cx + 11, my + 4, 'quote pasted', 12, 500, C['muted']))
        x += BW + GAP
    ev.append(text((start + x - GAP) / 2, baseA + 22, days[s], 12, 400, C['faint'], anchor='middle'))
    x += sgap - GAP

baseB = 592
ev.append(f'<line x1="96" y1="{baseA + 44}" x2="1184" y2="{baseA + 44}" stroke="{C["border"]}" stroke-dasharray="2 4"/>')
ev.append(text(96, 500, 'Pasted in one go', 15, 600))
ev.append(text(1184, 500, '1 session, one paste of 4,812 chars', 13, 400, C['muted'], anchor='end'))
ev.append(f'<line x1="96" y1="{baseB}" x2="1184" y2="{baseB}" stroke="{C["border"]}"/>')
xb = 1184 - BW
for k, chars in enumerate([40, 25]):
    ev.append(bar(xb - (2 - k) * (BW + GAP), baseB, BW, chars * SCALE, C['gray']))
ev.append(bar(xb, baseB, BW, 58, C['gray']))
ev.append(f'<path d="M{xb - 2},{baseB - 64} l7,-6 l7,6" fill="none" stroke="{C["muted"]}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')
ev.append(text(xb - 44, baseB - 24, '4,812 chars at once (off scale)', 12, 500, C['muted'], anchor='end'))
ev.append(text(xb + BW / 2, baseB + 22, 'Oct 9', 12, 400, C['faint'], anchor='middle'))
open(f'{OUT}/evidence.svg', 'w').write(svg(1280, 692, '\n'.join(ev), 'Example Inkline stats and activity: an essay drafted over seven sessions compared with one pasted all at once'))
print('ok')
