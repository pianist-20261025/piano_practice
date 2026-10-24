"""public/samples の動作確認用 MusicXML を作る（要 music21）。

    python3 tools/make_samples.py public/samples
"""
import copy, re, sys
from music21 import bar, chord, clef, corpus, duration, key, layout, meter, metadata, note, stream, tempo

out = sys.argv[1]

def seq(spec):
    """'D5:q G4:e ...' や '[G3,B3,D4]:h' を音符列にする。q=4分, e=8分, h=2分, h.=付点2分"""
    lens = {'q': 1.0, 'e': 0.5, 'h': 2.0, 'h.': 3.0}
    items = []
    for tok in spec.split():
        p, d = tok.rsplit(':', 1)
        if p.startswith('['):
            n = chord.Chord(p[1:-1].split(','))
        else:
            n = note.Note(p)
        n.duration = duration.Duration(lens[d])
        items.append(n)
    return items

def write(score, path):
    """書き出し、曲名が二重に表示されないよう <work>（work-title）を除く"""
    score.write('musicxml', fp=path)
    with open(path, encoding='utf-8') as f:
        xml = f.read()
    with open(path, 'w', encoding='utf-8') as f:
        f.write(re.sub(r'\s*<work>.*?</work>', '', xml, flags=re.S))

# メヌエット ト長調 BWV Anh. 114（前半16小節。終わりに反復記号）
rh = [
    'D5:q G4:e A4:e B4:e C5:e', 'D5:q G4:q G4:q', 'E5:q C5:e D5:e E5:e F#5:e', 'G5:q G4:q G4:q',
    'C5:q D5:e C5:e B4:e A4:e', 'B4:q C5:e B4:e A4:e G4:e', 'F#4:q G4:e A4:e B4:e G4:e', 'A4:h.',
    'D5:q G4:e A4:e B4:e C5:e', 'D5:q G4:q G4:q', 'E5:q C5:e D5:e E5:e F#5:e', 'G5:q G4:q G4:q',
    'C5:q D5:e C5:e B4:e A4:e', 'B4:q C5:e B4:e A4:e G4:e', 'A4:q B4:e A4:e G4:e F#4:e', 'G4:h.',
]
lh = [
    '[G3,B3,D4]:h A3:q', 'B3:h.', 'C4:h.', 'B3:h.', 'A3:h.', 'G3:h.', 'D4:q B3:q G3:q', 'D4:q D3:e C4:e B3:e A3:e',
    'B3:h A3:q', 'G3:q B3:q G3:q', 'C4:h.', 'B3:q C4:e B3:e A3:e G3:e', 'A3:h F#3:q', 'G3:h B3:q', 'C4:q D4:q D3:q', 'G3:h G2:q',
]

def piano_score(title, composer, upper_measures, lower_measures, ks, ts, bpm, repeat_end=False):
    s = stream.Score()
    s.metadata = metadata.Metadata(title=title, composer=composer)
    staves = []
    for i, (ms, c) in enumerate([(upper_measures, clef.TrebleClef()), (lower_measures, clef.BassClef())]):
        ps = stream.PartStaff()
        for n, m in enumerate(ms, start=1):
            meas = stream.Measure(number=n)
            if n == 1:
                meas.append([c, key.KeySignature(ks), meter.TimeSignature(ts)])
                if i == 0 and bpm:
                    meas.insert(0, tempo.MetronomeMark(number=bpm, referent=duration.Duration(1.0)))
            meas.append(m)
            if repeat_end and n == len(ms):
                meas.rightBarline = bar.Repeat(direction='end')
            ps.append(meas)
        staves.append(ps)
    for ps in staves:
        s.insert(0, ps)
    s.insert(0, layout.StaffGroup(staves, symbol='brace', barTogether=True))
    return s

minuet = piano_score('Menuet G-Dur BWV Anh. 114', 'Christian Petzold (attr.)', [seq(m) for m in rh], [seq(m) for m in lh], 1, '3/4', 100, repeat_end=True)
write(minuet, f'{out}/minuet-g-bwv-anh114.musicxml')

# コラール BWV 66.6 を S+A / T+B の2段にまとめたもの（タイ・持続音の確認用）
ch = corpus.parse('bach/bwv66.6')
sop, alto, ten, bass = ch.parts

def merge(a, b):
    pair = stream.Score([copy.deepcopy(a), copy.deepcopy(b)]).chordify()
    measures = []
    for m in pair.getElementsByClass(stream.Measure):
        items = []
        for el in m.notesAndRests:
            el = copy.deepcopy(el)
            if isinstance(el, chord.Chord) and len(el.pitches) == 1:
                n = note.Note(el.pitches[0]); n.duration = el.duration; n.tie = el.tie; el = n
            items.append(el)
        measures.append((m, items))
    return measures

upper, lower = merge(sop, alto), merge(ten, bass)
s = stream.Score()
s.metadata = metadata.Metadata(title='Choral "Christ unser Herr" BWV 66.6 (2段譜)', composer='J. S. Bach')
staves = []
for i, (ms, c) in enumerate([(upper, clef.TrebleClef()), (lower, clef.BassClef())]):
    ps = stream.PartStaff()
    for n, (src, items) in enumerate(ms):
        meas = stream.Measure(number=src.number)
        if n == 0:
            meas.append([c, key.KeySignature(3), meter.TimeSignature('4/4')])
            if i == 0:
                meas.insert(0, tempo.MetronomeMark(number=72, referent=duration.Duration(1.0)))
        if src.paddingLeft:
            meas.paddingLeft = src.paddingLeft
        meas.append(items)
        ps.append(meas)
    staves.append(ps)
for ps in staves:
    s.insert(0, ps)
s.insert(0, layout.StaffGroup(staves, symbol='brace', barTogether=True))
write(s, f'{out}/chorale-bwv66-6.musicxml')
print('ok')
