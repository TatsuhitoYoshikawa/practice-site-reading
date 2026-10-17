"""アプリ内ライブラリ（パブリックドメイン曲）の MusicXML を生成する。

使い方: python3 scripts/gen_library.py
音符は "音名オクターブ:長さ" で書く。長さ: w=全, h=2分, q=4分, e=8分。末尾の "." は付点。
"""
import json
import os
from xml.sax.saxutils import escape

DIV = 4  # 4分音符あたりの divisions
LEN = {"w": 16, "h": 8, "q": 4, "e": 2}
TYPE = {"w": "whole", "h": "half", "q": "quarter", "e": "eighth"}

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


def parse_voice(text):
    measures = []
    for m in text.split("|"):
        notes = []
        for tok in m.split():
            pitch, _, length = tok.partition(":")
            length = length or "q"
            dotted = length.endswith(".")
            base = length.rstrip(".")
            dur = LEN[base] * (3 if dotted else 2) // 2
            notes.append((pitch[:-1], int(pitch[-1]), dur, TYPE[base], dotted))
        assert sum(n[2] for n in notes) == 4 * DIV, f"小節の長さが不正: {m}"
        measures.append(notes)
    return measures


def note_xml(step, octave, dur, typ, dotted, staff, voice):
    dot = "<dot/>" if dotted else ""
    return (
        f"<note><pitch><step>{step}</step><octave>{octave}</octave></pitch>"
        f"<duration>{dur}</duration><voice>{voice}</voice><type>{typ}</type>{dot}"
        f"<staff>{staff}</staff></note>"
    )


def song_xml(song):
    rh = parse_voice(song["rh"])
    lh = parse_voice(song["lh"])
    assert len(rh) == len(lh), song["id"]
    measures = []
    for i, (r, l) in enumerate(zip(rh, lh)):
        parts = [f'<measure number="{i + 1}">']
        if i == 0:
            parts.append(
                f"<attributes><divisions>{DIV}</divisions><key><fifths>0</fifths></key>"
                "<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>"
                '<clef number="1"><sign>G</sign><line>2</line></clef>'
                '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
                '<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                f'<per-minute>{song["tempo"]}</per-minute></metronome></direction-type>'
                f'<sound tempo="{song["tempo"]}"/></direction>'
            )
        parts += [note_xml(*n, 1, 1) for n in r]
        parts.append(f"<backup><duration>{4 * DIV}</duration></backup>")
        parts += [note_xml(*n, 2, 5) for n in l]
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
        "<rights>Public Domain</rights></identification>"
        '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
        '<part id="P1">' + "\n".join(measures) + "</part></score-partwise>\n"
    )


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
            "license": "Public Domain",
            "file": f"{song['id']}.musicxml",
        })
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
