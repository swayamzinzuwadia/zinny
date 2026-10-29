"""
Rebuilds the Lexend subsets embedded in fonts.ts (invoice PDFs).

    python3 -m venv /tmp/fv && /tmp/fv/bin/pip install fonttools brotli
    /tmp/fv/bin/python -I src/modules/payments/pdf/build-fonts.py \
        node_modules/@fontsource-variable/lexend/files /tmp/lexend-out

Then base64 the two LexendInvoice-*.ttf files into fonts.ts. Uses only the font files
already in node_modules (no downloads). Lexend is licensed under the SIL Open Font
License 1.1.

Steps: instance the variable latin and latin-ext files at wght 400 and 600, merge them,
and keep Basic Latin, Latin-1, Latin Extended-A, common punctuation and the rupee sign.
"""
import sys

from fontTools import subset
from fontTools.merge import Merger
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

src, out = sys.argv[1], sys.argv[2]

KEEP = (
    list(range(0x20, 0x7F))  # Basic Latin
    + list(range(0xA0, 0x17F))  # Latin-1 Supplement and Latin Extended-A
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20B9]  # punctuation, rupee
)

for weight, name in [(400, "Regular"), (600, "SemiBold")]:
    parts = []
    for part in ["latin", "latin-ext"]:
        font = instancer.instantiateVariableFont(TTFont(f"{src}/lexend-{part}-wght-normal.woff2"), {"wght": weight})
        font.flavor = None
        for table in ["STAT", "fvar", "gvar", "avar", "HVAR", "MVAR"]:
            if table in font:
                del font[table]
        path = f"{out}/part-{part}-{name}.ttf"
        font.save(path)
        parts.append(path)
    merged = f"{out}/merged-{name}.ttf"
    Merger().merge(parts).save(merged)

    opts = subset.Options()
    opts.layout_features = ["kern", "liga"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = TTFont(merged)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=KEEP)
    sub.subset(font)
    font.save(f"{out}/LexendInvoice-{name}.ttf")
    print(name, len(font.getGlyphOrder()), "glyphs")
