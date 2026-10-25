"""アプリ内ライブラリの MusicXML を生成する。

使い方: python3 scripts/gen_library.py
音符は "音名[#|b]オクターブ:長さ" で書く（例: C4, F#4:h, Bb3:q.）。
長さ: w=全, h=2分, q=4分, e=8分, s=16分（省略時は q）。末尾の "." は付点。
和音は "+" でつなぐ（例: C4+E4+G4:h）。休符は "R:長さ"。小節は "|" で区切る。
"""
import json
import os
import re
from xml.sax.saxutils import escape

DIV = 4  # 4分音符あたりの divisions
LEN = {"w": 16, "h": 8, "q": 4, "e": 2, "s": 1}
TYPE = {"w": "whole", "h": "half", "q": "quarter", "e": "eighth", "s": "16th"}
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


# ---- 初級の追加曲（民謡・パブリックドメイン。左手はこのアプリで付けた伴奏） ----
SONGS += [
    {
        "id": "frere-jacques",
        "title": "かねがなる（フレール・ジャック）",
        "composer": "フランス民謡",
        "tempo": 100,
        "rh": "C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4:h | E4 F4 G4:h"
              " | G4:e A4:e G4:e F4:e E4 C4 | G4:e A4:e G4:e F4:e E4 C4 | C4 G3 C4:h | C4 G3 C4:h",
        "lh": "C3:w | C3:w | C3:w | C3:w | C3:h G2:h | C3:h G2:h | C3:w | C3:w",
    },
    {
        "id": "london-bridge",
        "title": "ロンドン橋",
        "composer": "イギリス民謡",
        "tempo": 100,
        "rh": "G4:q. A4:e G4 F4 | E4 F4 G4:h | D4 E4 F4:h | E4 F4 G4:h"
              " | G4:q. A4:e G4 F4 | E4 F4 G4:h | D4:h G4:h | E4 C4:h.",
        "lh": "C3:w | C3:w | G2:w | C3:w | C3:w | C3:w | G2:w | C3:w",
    },
    {
        "id": "au-clair-de-la-lune",
        "title": "月の光に",
        "composer": "フランス民謡",
        "tempo": 100,
        "rh": "C4 C4 C4 D4 | E4:h D4:h | C4 E4 D4 D4 | C4:w"
              " | C4 C4 C4 D4 | E4:h D4:h | C4 E4 D4 D4 | C4:w"
              " | D4 D4 D4 D4 | A3:h A3:h | D4 C4 B3 A3 | G3:w"
              " | C4 C4 C4 D4 | E4:h D4:h | C4 E4 D4 D4 | C4:w",
        "lh": "C3:w | C3:h G2:h | C3:h G2:h | C3:w | C3:w | C3:h G2:h | C3:h G2:h | C3:w"
              " | G2:w | D3:w | D3:w | G2:w | C3:w | C3:h G2:h | C3:h G2:h | C3:w",
    },
    {
        "id": "hot-cross-buns",
        "title": "ホット・クロス・バンズ",
        "composer": "イギリス民謡",
        "tempo": 100,
        "rh": "E4 D4 C4:h | E4 D4 C4:h | C4:e C4:e C4:e C4:e D4:e D4:e D4:e D4:e | E4 D4 C4:h",
        "lh": "C3:w | C3:w | C3:h G2:h | C3:w",
    },
]

# ---- 中級の追加曲 ----

# メヌエット ト長調（C. ペツォールト、伝 J. S. バッハ。パブリックドメイン）。左手はこのアプリで付けた伴奏（CC0）
_MINUET_RH = [
    "D5 G4:e A4:e B4:e C5:e", "D5 G4 G4", "E5 C5:e D5:e E5:e F#5:e", "G5 G4 G4",
    "C5 D5:e C5:e B4:e A4:e", "B4 C5:e B4:e A4:e G4:e", "F#4 G4:e A4:e B4:e G4:e", "A4:h.",
    "D5 G4:e A4:e B4:e C5:e", "D5 G4 G4", "E5 C5:e D5:e E5:e F#5:e", "G5 G4 G4",
    "C5 D5:e C5:e B4:e A4:e", "B4 C5:e B4:e A4:e G4:e", "A4 B4:e A4:e G4:e F#4:e", "G4:h.",
]
_MINUET_LH_CHORD = {"G": "G2:h D3", "C": "C3:h E3", "Am": "A2:h E3", "D": "D3:h F#3"}
_MINUET_LH = [_MINUET_LH_CHORD[c] for c in "G G C G Am G D D G G C G Am G D G".split()]
_MINUET_LH[7] = "D3:h."
_MINUET_LH[15] = "G2:h."
SONGS.append({
    "id": "minuet-in-g",
    "title": "メヌエット ト長調",
    "composer": "C. ペツォールト（伴奏：このアプリ）",
    "level": "中級",
    "license": "Public Domain（伴奏は CC0）",
    "tempo": 100,
    "time": (3, 4),
    "fifths": 1,
    # 原曲どおり16小節をくり返す
    "rh": " | ".join(_MINUET_RH * 2),
    "lh": " | ".join(_MINUET_LH * 2),
})

# 左手のメロディ（このアプリのオリジナル、CC0）。旋律は左手、右手は裏拍の和音
_LH_MELODY_CHORDS = {
    "C": "E4+G4+C5", "F": "F4+A4+C5", "G": "D4+G4+B4", "Am": "E4+A4+C5",
    "Dm": "F4+A4+D5", "G7": "D4+F4+B4", "Em": "E4+G4+B4",
}
_LH_MELODY_HARMONY = "C F G C Am Dm G7 C C Em F C F G G7 C".split()
_LH_MELODY = [
    "C3 E3 G3 E3", "F3 A3 C4 A3", "G3 F3 E3 D3", "C3:h G2:h",
    "A2 C3 E3 A3", "F3 E3 D3 F3", "G3:q. F3:e E3 D3", "C3:w",
    "E3:e F3:e G3 C4 G3", "B2 E3 G3 B3", "A3 G3 F3 A3", "G3:h E3:h",
    "F3 A3 C4 F3", "G3 B3 D4 B3", "F3:q. E3:e D3 B2", "C3:w",
]
_LH_MELODY_RH = [
    f"{_LH_MELODY_CHORDS[c]}:w" if i % 4 == 3 else f"R:q {_LH_MELODY_CHORDS[c]} R:q {_LH_MELODY_CHORDS[c]}"
    for i, c in enumerate(_LH_MELODY_HARMONY)
]
SONGS.append({
    "id": "left-hand-melody",
    "title": "左手のメロディ",
    "composer": "オリジナル（このアプリ用）",
    "level": "中級",
    "license": "CC0",
    "tempo": 90,
    "rh": " | ".join(_LH_MELODY_RH),
    "lh": " | ".join(_LH_MELODY),
})

# ---- 上級 ----

# エリーゼのために（L. v. ベートーヴェン、パブリックドメイン）。冒頭の主題部分をこのアプリで短くまとめた（CC0）
_ELISE_LH_AM = "A2:s E3:s A3:s R:s R:e"
_ELISE_LH_E = "E2:s E3:s G#3:s R:s R:e"
_ELISE_THEME = [  # 主題（2〜8小節目）: (右手, 左手)
    ("E5:s D#5:s E5:s B4:s D5:s C5:s", "R:q."),
    ("A4:e R:s C4:s E4:s A4:s", _ELISE_LH_AM),
    ("B4:e R:s E4:s G#4:s B4:s", _ELISE_LH_E),
    ("C5:e R:s E4:s E5:s D#5:s", _ELISE_LH_AM),
    ("E5:s D#5:s E5:s B4:s D5:s C5:s", "R:q."),
    ("A4:e R:s C4:s E4:s A4:s", _ELISE_LH_AM),
    ("B4:e R:s E4:s C5:s B4:s", _ELISE_LH_E),
]
_ELISE = (
    [("R:q E5:s D#5:s", "R:q.")]
    + _ELISE_THEME
    + [("A4:e R:e E5:s D#5:s", _ELISE_LH_AM)]
    + _ELISE_THEME
    + [
        ("A4:e R:s B4:s C5:s D5:s", _ELISE_LH_AM),
        ("E5:e. G4:s F5:s E5:s", "C3:s G3:s C4:s R:s R:e"),
        ("D5:e. F4:s E5:s D5:s", "G2:s G3:s B3:s R:s R:e"),
        ("C5:e. E4:s D5:s C5:s", _ELISE_LH_AM),
        ("B4:e R:s E4:s E5:s D#5:s", _ELISE_LH_E),
    ]
    + _ELISE_THEME
    + [("A4:q.", "A2+A3:q.")]
)
SONGS.append({
    "id": "fur-elise",
    "title": "エリーゼのために（冒頭）",
    "composer": "L. v. ベートーヴェン（編曲：このアプリ）",
    "level": "上級",
    "license": "Public Domain（編曲は CC0）",
    "tempo": 60,
    "time": (3, 8),
    "rh": " | ".join(r for r, _ in _ELISE),
    "lh": " | ".join(l for _, l in _ELISE),
})

# アルペジオのエチュード（このアプリのオリジナル、CC0）。ニ長調。
# 前半は右手のアルペジオと左手のオクターブ、後半は右手の和音と左手のアルペジオ
_ARP_RH = {
    "D": "D4:e F#4:e A4:e D5:e F#5:e D5:e A4:e F#4:e",
    "Bm": "D4:e F#4:e B4:e D5:e F#5:e D5:e B4:e F#4:e",
    "G": "D4:e G4:e B4:e D5:e G5:e D5:e B4:e G4:e",
    "A7": "C#4:e E4:e G4:e A4:e C#5:e A4:e G4:e E4:e",
    "F#m": "C#4:e F#4:e A4:e C#5:e F#5:e C#5:e A4:e F#4:e",
    "Em": "E4:e G4:e B4:e E5:e G5:e E5:e B4:e G4:e",
}
_ARP_LH_OCTAVES = {
    "D": "D2+D3:h A1+A2:h", "Bm": "B1+B2:h F#2+F#3:h", "G": "G1+G2:h D2+D3:h",
    "A7": "A1+A2:h E2+E3:h", "F#m": "F#1+F#2:h C#2+C#3:h", "Em": "E1+E2:h B1+B2:h",
}
_ARP_RH_CHORDS = {
    "D": "F#5+A5+D6", "Bm": "F#5+B5+D6", "G": "G5+B5+D6",
    "A7": "E5+G5+A5+C#6", "F#m": "F#5+A5+C#6", "Em": "E5+G5+B5",
}
_ARP_LH = {
    "D": "D2:e A2:e D3:e F#3:e A3:e F#3:e D3:e A2:e",
    "Bm": "B1:e F#2:e B2:e D3:e F#3:e D3:e B2:e F#2:e",
    "G": "G1:e D2:e G2:e B2:e D3:e B2:e G2:e D2:e",
    "A7": "A1:e E2:e A2:e C#3:e G3:e C#3:e A2:e E2:e",
    "F#m": "F#1:e C#2:e F#2:e A2:e C#3:e A2:e F#2:e C#2:e",
    "Em": "E1:e B1:e E2:e G2:e B2:e G2:e E2:e B1:e",
}
_ARP_HARMONY = "D Bm G A7 D G A7 D F#m Bm Em A7 D G A7 D".split()
SONGS.append({
    "id": "arpeggio-etude",
    "title": "アルペジオのエチュード",
    "composer": "オリジナル（このアプリ用）",
    "level": "上級",
    "license": "CC0",
    "tempo": 72,
    "fifths": 2,
    "rh": " | ".join([_ARP_RH[c] for c in _ARP_HARMONY]
                     + [f"{_ARP_RH_CHORDS[c]}:h {_ARP_RH_CHORDS[c]} {_ARP_RH_CHORDS[c]}" for c in _ARP_HARMONY[:-1]]
                     + ["F#5+A5+D6:w"]),
    "lh": " | ".join([_ARP_LH_OCTAVES[c] for c in _ARP_HARMONY]
                     + [_ARP_LH[c] for c in _ARP_HARMONY[:-1]]
                     + ["D2+A2+D3:w"]),
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
