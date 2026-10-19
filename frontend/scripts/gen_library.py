"""アプリ内ライブラリの MusicXML を生成する。

使い方: python3 scripts/gen_library.py
音符は "音名[#|b]オクターブ:長さ" で書く（例: C4, F#4:h, Bb3:q.）。
長さ: w=全, h=2分, q=4分, e=8分（省略時は q）。末尾の "." は付点。
和音は "+" でつなぐ（例: C4+E4+G4:h）。休符は "R:長さ"。小節は "|" で区切る。
"""
import json
import os
import re
from xml.sax.saxutils import escape

DIV = 4  # 4分音符あたりの divisions
LEN = {"w": 16, "h": 8, "q": 4, "e": 2}
TYPE = {"w": "whole", "h": "half", "q": "quarter", "e": "eighth"}
STEPS = "CDEFGAB"
SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# 調号（シャープ/フラットの数）で変化する音の順番
SHARP_ORDER = "FCGDAEB"
FLAT_ORDER = "BEADGCF"
ACCIDENTAL = {-1: "flat", 0: "natural", 1: "sharp"}
PITCH_RE = re.compile(r"^([A-G])([#b]?)(-?\d)$")

SONGS = [
    {
        "id": "twinkle",
        "title": "きらきら星",
        "composer": "フランス民謡",
        "tempo": 100,
        "rh": "C4 C4 G4 G4 | A4 A4 G4:h | F4 F4 E4 E4 | D4 D4 C4:h | G4 G4 F4 F4 | E4 E4 D4:h | G4 G4 F4 F4 | E4 E4 D4:h"
              " | C4 C4 G4 G4 | A4 A4 G4:h | F4 F4 E4 E4 | D4 D4 C4:h",
        "lh": "C3:w | F3:h C3:h | G2:h C3:h | G2:h C3:h | C3:h G2:h | C3:h G2:h | C3:h G2:h | C3:h G2:h"
              " | C3:w | F3:h C3:h | F3:h C3:h | G2:h C3:h",
    },
    {
        "id": "mary",
        "title": "メリーさんのひつじ",
        "composer": "アメリカ民謡",
        "tempo": 100,
        "rh": "E4 D4 C4 D4 | E4 E4 E4:h | D4 D4 D4:h | E4 G4 G4:h | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:w",
        "lh": "C3:w | C3:w | G2:w | C3:w | C3:w | C3:w | G2:w | C3:w",
    },
    {
        "id": "ode-to-joy",
        "title": "喜びの歌",
        "composer": "L. v. ベートーヴェン",
        "tempo": 100,
        "rh": "E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:q. D4:e D4:h"
              " | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:q. C4:e C4:h",
        "lh": "C3:w | G2:w | C3:w | G2:w | C3:w | G2:w | C3:h G2:h | C3:w",
    },
    {
        "id": "lightly-row",
        "title": "ちょうちょう",
        "composer": "ドイツ民謡",
        "tempo": 108,
        "rh": "G4 E4 E4:h | F4 D4 D4:h | C4 D4 E4 F4 | G4 G4 G4:h | G4 E4 E4 E4 | F4 D4 D4 D4 | C4 E4 G4 G4 | E4 E4 E4:h",
        "lh": "C3:w | G2:w | C3:w | C3:w | C3:w | G2:w | C3:h G2:h | C3:w",
    },
    {
        "id": "frog-song",
        "title": "かえるのがっしょう",
        "composer": "ドイツ民謡",
        "tempo": 100,
        "rh": "C4 D4 E4 F4 | E4 D4 C4:h | E4 F4 G4 A4 | G4 F4 E4:h | C4:h C4:h | C4:h C4:h"
              " | C4:e C4:e D4:e D4:e E4:e E4:e F4:e F4:e | E4 D4 C4:h",
        "lh": "C3:w | C3:w | C3:h F3:h | C3:w | C3:w | C3:w | C3:h F3:h | G2:h C3:h",
    },
]


def key_alters(fifths):
    order = SHARP_ORDER if fifths >= 0 else FLAT_ORDER
    sign = 1 if fifths >= 0 else -1
    return {step: sign for step in order[: abs(fifths)]}


def parse_pitch(text):
    m = PITCH_RE.match(text)
    assert m, f"音名が不正: {text}"
    step, acc, octave = m.groups()
    return step, {"": 0, "#": 1, "b": -1}[acc], int(octave)


def parse_voice(text, measure_length):
    """小節ごとに [(音のリスト, 長さ, 種類, 付点)] を返す。音のリストが空なら休符"""
    measures = []
    for m in text.split("|"):
        events = []
        for tok in m.split():
            pitches, _, length = tok.partition(":")
            length = length or "q"
            dotted = length.endswith(".")
            base = length.rstrip(".")
            dur = LEN[base] * (3 if dotted else 2) // 2
            notes = [] if pitches == "R" else [parse_pitch(p) for p in pitches.split("+")]
            events.append((notes, dur, TYPE[base], dotted))
        assert sum(e[1] for e in events) == measure_length, f"小節の長さが不正: {m}"
        measures.append(events)
    return measures


def transpose_octave(text, octaves):
    """音名のオクターブだけをずらす（和音・休符・長さはそのまま）"""
    return re.sub(r"([A-G][#b]?)(-?\d)", lambda m: f"{m.group(1)}{int(m.group(2)) + octaves}", text)


def event_xml(event, staff, voice, alters):
    notes, dur, typ, dotted = event
    dot = "<dot/>" if dotted else ""
    tail = f"<duration>{dur}</duration><voice>{voice}</voice><type>{typ}</type>{dot}"
    if not notes:
        return f"<note><rest/>{tail}<staff>{staff}</staff></note>"
    xml = []
    for i, (step, alter, octave) in enumerate(notes):
        chord = "<chord/>" if i > 0 else ""
        alter_xml = f"<alter>{alter}</alter>" if alter else ""
        accidental = f"<accidental>{ACCIDENTAL[alter]}</accidental>" if alter != alters.get(step, 0) else ""
        xml.append(
            f"<note>{chord}<pitch><step>{step}</step>{alter_xml}<octave>{octave}</octave></pitch>"
            f"{tail}{accidental}<staff>{staff}</staff></note>"
        )
    return "".join(xml)


def song_xml(song):
    beats, beat_type = song.get("time", (4, 4))
    fifths = song.get("fifths", 0)
    measure_length = beats * DIV * 4 // beat_type
    alters = key_alters(fifths)
    rh = parse_voice(song["rh"], measure_length)
    lh = parse_voice(song["lh"], measure_length)
    assert len(rh) == len(lh), song["id"]
    measures = []
    for i, (r, l) in enumerate(zip(rh, lh)):
        parts = [f'<measure number="{i + 1}">']
        if i == 0:
            parts.append(
                f"<attributes><divisions>{DIV}</divisions><key><fifths>{fifths}</fifths></key>"
                f"<time><beats>{beats}</beats><beat-type>{beat_type}</beat-type></time><staves>2</staves>"
                '<clef number="1"><sign>G</sign><line>2</line></clef>'
                '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
                '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                f'<per-minute>{song["tempo"]}</per-minute></metronome></direction-type>'
                f'<sound tempo="{song["tempo"]}"/></direction>'
            )
        parts += [event_xml(e, 1, 1, alters) for e in r]
        parts.append(f"<backup><duration>{measure_length}</duration></backup>")
        parts += [event_xml(e, 2, 5, alters) for e in l]
        if i == len(rh) - 1:
            parts.append('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
        parts.append("</measure>")
        measures.append("".join(parts))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
        '"http://www.musicxml.org/dtds/partwise.dtd">\n'
        '<score-partwise version="4.0">'
        f'<work><work-title>{escape(song["title"])}</work-title></work>'
        f'<identification><creator type="composer">{escape(song["composer"])}</creator>'
        f'<rights>{escape(song.get("license", "Public Domain"))}</rights></identification>'
        '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
        '<part id="P1">' + "\n".join(measures) + "</part></score-partwise>\n"
    )


# ---- 中級：両手の和音・広い音域・長い曲 ----

# きよしこの夜（F. グルーバー作曲、パブリックドメイン）。両手で和音を弾く形にこのアプリで編曲（CC0）
_SILENT_NIGHT_RH = [
    "G4:q. A4:e G4:q", "C4+E4:h.", "G4:q. A4:e G4:q", "C4+E4:h.",
    "B4+D5:h B4+D5:q", "G4+B4:h.", "G4+C5:h G4+C5:q", "E4+G4:h.",
    "F4+A4:h F4+A4:q", "A4+C5:q. B4:e A4:q", "E4+G4:q. A4:e G4:q", "C4+E4:h.",
    "F4+A4:h F4+A4:q", "A4+C5:q. B4:e A4:q", "E4+G4:q. A4:e G4:q", "C4+E4:h.",
    "B4+D5:h B4+D5:q", "B4+F5:q. D5:e B4:q", "E4+G4+C5:h.", "G4+C5+E5:h.",
    "C5:q. G4:e E4:q", "G4:q. F4:e D4:q", "C4:h.", "R:h.",
]
_SILENT_NIGHT_HARMONY = "C C C C G G C C F F C C F F C C G G C C C G C".split()
_WALTZ_1 = {"C": "C3:q E3+G3 E3+G3", "G": "G2:q F3+B3 F3+B3", "F": "F2:q A3+C4 A3+C4"}
_WALTZ_2 = {"C": "C2+C3:q E3+G3 E3+G3", "G": "G2+G3:q F3+B3 F3+B3", "F": "F2+F3:q A3+C4 A3+C4"}
SONGS.append({
    "id": "silent-night",
    "title": "きよしこの夜",
    "composer": "F. グルーバー（編曲：このアプリ）",
    "level": "中級",
    "license": "Public Domain（編曲は CC0）",
    "tempo": 84,
    "time": (3, 4),
    # 1番はそのまま、2番は右手を1オクターブ上げ、左手をオクターブの低音にする
    "rh": " | ".join(_SILENT_NIGHT_RH + [transpose_octave(m, 1) for m in _SILENT_NIGHT_RH[:23]] + ["E5+G5+C6:h."]),
    "lh": " | ".join([_WALTZ_1[c] for c in _SILENT_NIGHT_HARMONY] + ["C3+G3:h."]
                     + [_WALTZ_2[c] for c in _SILENT_NIGHT_HARMONY] + ["C2+C3+G3:h."]),
})

# 和音のエチュード（このアプリのオリジナル、CC0）。ト長調、3音の和音と広い音域の左手
_ETUDE_RH = [
    "G4+B4+D5:h G4+B4+D5:h", "G4+B4+E5:q G4+B4+E5:q G4+B4+E5:h", "G4+C5+E5:h E5:q D5:q", "F#4+C5+D5:h. R:q",
    "B4+D5+G5:h B4+D5+G5:h", "C5+E5+G5:q C5+E5+G5:q C5+E5+G5:h",
    "F#4+A4+D5:q F#4+C5+D5:q F#4+C5+D5:h", "B4+D5+G5:w",
    "E5:q D5:q G4+B4+E5:h", "F#4+B4+D5:h B4:q D5:q", "G4+C5+E5:q. D5:e C5:h", "B4+D5:h. R:q",
    "A4+C5+E5:h A4+C5+E5:q B4:q", "F#4+C5+D5:h F#4+A4+C5:h", "G4+B4+D5:q B4+D5+G5:q D5+G5+B5:h", "D5+G5+B5:w",
]
_ETUDE_LH = [
    "G2+G3:h D3+B3:h", "E2+E3:h B2+G3:h", "C3+C4:h G3+E4:h", "D2+D3:h. R:q",
    "G2+G3:q D3:q B3:q D3:q", "C3:q G3:q E4:q G3:q", "D3:q A3:q C4:q A3:q", "G2+D3+G3:w",
    "E2+E3:h B2+B3:h", "B1+B2:h F#2+F#3:h", "C3+C4:h G2+G3:h", "G2+G3:h. R:q",
    "A2+A3:h E3+C4:h", "D2+D3:h F#3+C4:h", "G2:q B2:q D3:q G3:q", "G1+G2:w",
]
SONGS.append({
    "id": "chord-etude",
    "title": "和音のエチュード",
    "composer": "オリジナル（このアプリ用）",
    "level": "中級",
    "license": "CC0",
    "tempo": 80,
    "fifths": 1,
    # 前半16小節のあと、右手を1オクターブ上げてくり返す
    "rh": " | ".join(_ETUDE_RH + [transpose_octave(m, 1) for m in _ETUDE_RH[:15]] + ["G5+B5+D6:w"]),
    "lh": " | ".join(_ETUDE_LH + _ETUDE_LH[:15] + ["G1+G2+D3:w"]),
})


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "library")
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for song in SONGS:
        with open(os.path.join(out_dir, f"{song['id']}.musicxml"), "w", encoding="utf-8") as f:
            f.write(song_xml(song))
        index.append({
            "id": song["id"],
            "title": song["title"],
            "composer": song["composer"],
            "level": song.get("level", "初級"),
            "license": song.get("license", "Public Domain"),
            "file": f"{song['id']}.musicxml",
        })
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
