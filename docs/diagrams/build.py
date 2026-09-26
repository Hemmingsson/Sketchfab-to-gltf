#!/usr/bin/env python3
"""Build the README pipeline diagram with HyperWeave's default primer theme.

Run from the repo root:
    python3 docs/diagrams/build.py

Edit pipeline.spec.json, then run this script. Never hand-edit the SVG.

HyperWeave has no Sketchfab / file-archive glyphs, so those nodes render
with a core glyph and this script replaces them after compose. Export-path
wires use --primary (tokens.css).
GLB / glTF cards are rewritten to icon-only (matched size, black glyphs).

file / file-archive / glb / gltf: Lucide + FileIcon.svelte paths.
webassembly: Simple Icons (CC0).
"""

import json
import re
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = "pipeline"

# Match src/shared/tokens.css
PRIMARY = "#1CAAD9"

# node label -> (kind, file, stroke). stroke=None keeps the SVG's own color.
ICONS = {
    "Read public viewer": ("fill", "sketchfab.svg", None),
    "Decode mesh": ("stroke", "lock-open.svg", "var(--dna-ink-icon, var(--dna-ink-primary))"),
    "GLB file": ("fill", "glb.svg", None),
    "glTF ZIP": ("fill", "gltf.svg", None),
}

# Icon-only export cards (labels stay in the spec for a11y / wires).
ICON_ONLY = ("GLB file", "glTF ZIP")
ICON_ONLY_SCALE = 2.5
ICON_VIEW = 24  # glb.svg / gltf.svg viewBox
ICON_ONLY_PAD = 12
ICON_ONLY_FILL = "#0F172A"  # black ink (matches primer bright ink)


def compose(spec: Path, out: Path):
    subprocess.run(["hyperweave", "validate", str(spec)], check=True)
    subprocess.run(
        [
            "hyperweave", "compose", "diagram",
            "--spec-file", str(spec),
            "-g", "primer",
            "--surface", "inlay",
            "-o", str(out),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def glyph_span(svg, label):
    """(start, end, x, y, scale) of the glyph group drawn for a node label."""
    m = re.search(
        r'<text [^>]*class="hw-[0-9a-f]+-(?:h|m)?name">' + re.escape(label) + "</text>",
        svg,
    )
    if not m:
        raise SystemExit(f"node label not found: {label}")
    start = svg.rfind('<g aria-hidden="true" transform="translate(', 0, m.start())
    end = svg.find("</g>", start) + len("</g>")
    t = re.match(
        r'<g aria-hidden="true" transform="translate\(([\d.]+),([\d.]+)\) scale\(([\d.]+)\)',
        svg[start:],
    )
    if start < 0 or not t or end > m.start():
        raise SystemExit(f"glyph group not found for: {label}")
    return start, end, float(t[1]), float(t[2]), float(t[3])


def icon_markup(kind, file, stroke, x, y, scale, fill=None):
    inner = re.search(r"<svg[^>]*>(.*)</svg>", (HERE / "icons" / file).read_text(), re.S)[1].strip()
    if fill is not None:
        inner = re.sub(r'fill="[^"]*"', f'fill="{fill}"', inner)
    if kind == "fill":
        return f'<g aria-hidden="true" transform="translate({x},{y}) scale({scale})">{inner}</g>'
    stroke_attr = stroke or "currentColor"
    return (
        f'<g aria-hidden="true" transform="translate({x},{y}) scale({scale})" '
        f'fill="none" stroke="{stroke_attr}" stroke-width="2" '
        f'stroke-linecap="round" stroke-linejoin="round">{inner}</g>'
    )


def color_export_wires(svg):
    """Paint export-path connectors and markers with the product primary."""
    replacements = (
        (r"(\.hw-[0-9a-f]+-connmuted\s*\{\s*stroke:\s*)[^;}]+", rf"\g<1>{PRIMARY}"),
        (r"(\.hw-[0-9a-f]+-connmutedf\s*\{\s*fill:\s*)[^;}]+", rf"\g<1>{PRIMARY}"),
        (r"(\.hw-[0-9a-f]+-fl\d+\s*\{\s*stroke:\s*)[^;}]+", rf"\g<1>{PRIMARY}"),
        (r"(\.hw-[0-9a-f]+-flp\d+\s*\{\s*fill:\s*)[^;}]+", rf"\g<1>{PRIMARY}"),
        (r"(\.hw-[0-9a-f]+-flps\s*\{\s*fill:\s*)[^;}]+", rf"\g<1>{PRIMARY}"),
        (r"(\.hw-[0-9a-f]+-fls\s*\{\s*stroke:\s*)[^;}]+", rf"\g<1>{PRIMARY}"),
    )
    for pattern, repl in replacements:
        svg, _n = re.subn(pattern, repl, svg)
    return svg


def _fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else str(n)


def card_box(svg, label):
    """(x, y, w, h) of the card rect drawn for a node label."""
    text = re.search(
        r'<text [^>]*class="hw-[0-9a-f]+-(?:h|m)?name">' + re.escape(label) + "</text>",
        svg,
    )
    if not text:
        raise SystemExit(f"card label not found: {label}")
    glyph = svg.rfind('<g aria-hidden="true" transform="translate(', 0, text.start())
    rect = None
    for m in re.finditer(r"<rect [^/]*/>", svg[max(0, glyph - 600) : glyph]):
        rect = m
    if not rect:
        raise SystemExit(f"card rect not found for: {label}")
    attrs = rect.group(0)
    return (
        float(re.search(r'\bx="([^"]+)"', attrs).group(1)),
        float(re.search(r'\by="([^"]+)"', attrs).group(1)),
        float(re.search(r'\bwidth="([^"]+)"', attrs).group(1)),
        float(re.search(r'\bheight="([^"]+)"', attrs).group(1)),
    )


def seat_materials_chip(svg, orientation: str):
    """Run Materials+scene through the gap between Decode mesh and Descramble textures."""
    mesh = card_box(svg, "Decode mesh")
    textures = card_box(svg, "Descramble textures")
    viewer = card_box(svg, "Read public viewer")
    convert = card_box(svg, "Build glTF")

    chip = re.search(
        r'(<rect aria-hidden="true" )([^>]*class="hw-[0-9a-f]+-chipbg"/>)\s*'
        r'(<text )([^>]*>Materials \+ scene</text>)',
        svg,
    )
    if not chip:
        raise SystemExit("materials chip not found")
    chip_w = float(re.search(r'\bwidth="([^"]+)"', chip.group(2)).group(1))
    chip_h = float(re.search(r'\bheight="([^"]+)"', chip.group(2)).group(1))

    # Longest branch is the viewer→convert skip HyperWeave parks on the far channel.
    wires = list(
        re.finditer(
            r'(<path id="hw-[0-9a-f]+-c\d+" d=")([^"]+)(" class="hw-[0-9a-f]+-branch hw-[0-9a-f]+-fl\d+"[^/]*/>)'
            r'(\s*<path d="[^"]+" class="hw-[0-9a-f]+-mk hw-[0-9a-f]+-flp\d+"[^/]*/>)?',
            svg,
        )
    )
    if not wires:
        raise SystemExit("materials skip wire not found")
    wire = max(wires, key=lambda m: len(m.group(2)))
    marker_cls = (
        re.search(r'class="[^"]+"', wire.group(4)).group(0) if wire.group(4) else None
    )

    if orientation == "horizontal":
        mid_y = (mesh[1] + mesh[3] + textures[1]) / 2
        mid_x = mesh[0] + mesh[2] / 2
        x0 = viewer[0] + viewer[2]
        x1 = convert[0]
        new_d = f"M {_fmt(x0)},{_fmt(mid_y)} L {_fmt(x1)},{_fmt(mid_y)}"
        tip_x, tip_y = x1, mid_y
        marker = (
            f'<path d="M {_fmt(tip_x - 8)},{_fmt(tip_y - 4.6)} '
            f"L {_fmt(tip_x)},{_fmt(tip_y)} "
            f'L {_fmt(tip_x - 8)},{_fmt(tip_y + 4.6)} Z" {marker_cls}/>'
            if marker_cls
            else ""
        )
    else:
        mid_x = (mesh[0] + mesh[2] + textures[0]) / 2
        mid_y = mesh[1] + mesh[3] / 2
        y0 = viewer[1] + viewer[3]
        y1 = convert[1]
        new_d = f"M {_fmt(mid_x)},{_fmt(y0)} L {_fmt(mid_x)},{_fmt(y1)}"
        tip_x, tip_y = mid_x, y1
        marker = (
            f'<path d="M {_fmt(tip_x - 4.6)},{_fmt(tip_y - 8)} '
            f"L {_fmt(tip_x)},{_fmt(tip_y)} "
            f'L {_fmt(tip_x + 4.6)},{_fmt(tip_y - 8)} Z" {marker_cls}/>'
            if marker_cls
            else ""
        )

    chip_x = mid_x - chip_w / 2
    chip_y = mid_y - chip_h / 2
    text_x = mid_x
    text_y = mid_y + 7.07  # matches HyperWeave's chip baseline offset

    new_wire = wire.group(1) + new_d + wire.group(3)
    if marker:
        new_wire += "\n  " + marker
    svg = svg[: wire.start()] + new_wire + svg[wire.end() :]

    chip = re.search(
        r'(<rect aria-hidden="true" )([^>]*class="hw-[0-9a-f]+-chipbg"/>)\s*'
        r'(<text )([^>]*>Materials \+ scene</text>)',
        svg,
    )
    rect_attrs = re.sub(r'\bx="[^"]+"', f'x="{_fmt(chip_x)}"', chip.group(2), count=1)
    rect_attrs = re.sub(r'\by="[^"]+"', f'y="{_fmt(chip_y)}"', rect_attrs, count=1)
    text_rest = re.sub(r'\bx="[^"]+"', f'x="{_fmt(text_x)}"', chip.group(4), count=1)
    text_rest = re.sub(r'\by="[^"]+"', f'y="{_fmt(text_y)}"', text_rest, count=1)
    return (
        svg[: chip.start()]
        + chip.group(1)
        + rect_attrs
        + "\n  "
        + chip.group(3)
        + text_rest
        + svg[chip.end() :]
    )


PHASE_INK = "#808080"
PHASE_BORDER = "rgba(128,128,128,0.5)"  # PHASE_INK at 50%


def outline_regions(svg):
    """Stage bands: border only; border + phase titles in PHASE_INK."""
    svg = re.sub(
        r"(\.hw-[0-9a-f]+-laneband \{ fill: )[^;]+(;\s*stroke:\s*)[^;}]+",
        rf"\1none\2{PHASE_BORDER}",
        svg,
    )
    svg = re.sub(
        r"(\.hw-[0-9a-f]+-rcnt \{ fill: )[^;}]+",
        rf"\1{PHASE_INK}",
        svg,
    )
    return svg


def _path_end(d: str):
    nums = [float(x) for x in re.findall(r"-?\d+\.?\d*", d)]
    return nums[-2], nums[-1]


def _arrow(tip_x, tip_y, orientation: str, cls: str):
    if orientation == "horizontal":
        # Point right into the card's left edge.
        return (
            f'<path d="M {_fmt(tip_x - 8)},{_fmt(tip_y - 4.6)} '
            f"L {_fmt(tip_x)},{_fmt(tip_y)} "
            f'L {_fmt(tip_x - 8)},{_fmt(tip_y + 4.6)} Z" {cls}/>'
        )
    # Point down into the card's top edge.
    return (
        f'<path d="M {_fmt(tip_x - 4.6)},{_fmt(tip_y - 8)} '
        f"L {_fmt(tip_x)},{_fmt(tip_y)} "
        f'L {_fmt(tip_x + 4.6)},{_fmt(tip_y - 8)} Z" {cls}/>'
    )


def connect_export_cards(svg, orientation: str, cards):
    """Retarget convert→GLB / convert→glTF wires onto the resized card faces."""
    # Match each export card to the branch whose old end was nearest its prior center.
    branches = list(
        re.finditer(
            r'(<path id="hw-[0-9a-f]+-c\d+" d=")([^"]+)(" class="hw-[0-9a-f]+-branch hw-[0-9a-f]+-(?:fl\d+|connmuted)"[^/]*/>)'
            r'(\s*<path d="[^"]+" class="hw-[0-9a-f]+-mk hw-[0-9a-f]+-(?:flp\d+|connmutedf)"[^/]*/>)?',
            svg,
        )
    )
    # Process far→near so earlier offsets stay valid.
    edits = []
    for card in cards:
        tx, ty = card["nx"], card["ny"]
        tw, th = card["side"], card["side"]
        if orientation == "horizontal":
            tip = (tx, ty + th / 2)
        else:
            tip = (tx + tw / 2, ty)
        # Prefer the branch that ended nearest the card's original entry.
        ox, oy, ow, oh = card["x"], card["y"], card["w"], card["h"]
        old_entry = (ox, oy + oh / 2) if orientation == "horizontal" else (ox + ow / 2, oy)

        def dist(m):
            ex, ey = _path_end(m.group(2))
            return (ex - old_entry[0]) ** 2 + (ey - old_entry[1]) ** 2

        wire = min(branches, key=dist)
        branches.remove(wire)
        d = wire.group(2)
        # Keep the start point; rebuild a simple cubic into the new tip.
        start = re.match(r"M\s*([\d.-]+),([\d.-]+)", d)
        x0, y0 = float(start[1]), float(start[2])
        if orientation == "horizontal":
            mid = (x0 + tip[0]) / 2
            new_d = (
                f"M {_fmt(x0)},{_fmt(y0)} "
                f"C {_fmt(mid)},{_fmt(y0)} {_fmt(mid)},{_fmt(tip[1])} "
                f"{_fmt(tip[0])},{_fmt(tip[1])}"
            )
        else:
            mid = (y0 + tip[1]) / 2
            new_d = (
                f"M {_fmt(x0)},{_fmt(y0)} "
                f"C {_fmt(x0)},{_fmt(mid)} {_fmt(tip[0])},{_fmt(mid)} "
                f"{_fmt(tip[0])},{_fmt(tip[1])}"
            )
        marker_cls = (
            re.search(r'class="[^"]+"', wire.group(4)).group(0) if wire.group(4) else None
        )
        new_block = wire.group(1) + new_d + wire.group(3)
        if marker_cls:
            new_block += "\n  " + _arrow(tip[0], tip[1], orientation, marker_cls)
        edits.append((wire.start(), wire.end(), new_block))

    for start, end, block in sorted(edits, reverse=True):
        svg = svg[:start] + block + svg[end:]
    return svg


def icon_only_cards(svg, orientation: str):
    """Match GLB/glTF cards: drop labels, center glyphs, shared square size."""
    cards = []
    for label in ICON_ONLY:
        text = re.search(
            r'<text [^>]*class="hw-[0-9a-f]+-(?:h|m)?name">' + re.escape(label) + "</text>",
            svg,
        )
        if not text:
            raise SystemExit(f"icon-only label not found: {label}")
        glyph_start = svg.rfind('<g aria-hidden="true" transform="translate(', 0, text.start())
        glyph_end = svg.find("</g>", glyph_start) + len("</g>")
        rect = None
        for m in re.finditer(r"<rect [^/]*/>", svg[max(0, glyph_start - 600) : glyph_start]):
            rect = m
        if not rect:
            raise SystemExit(f"card rect not found for: {label}")
        abs_rect_start = max(0, glyph_start - 600) + rect.start()
        abs_rect_end = max(0, glyph_start - 600) + rect.end()
        attrs = rect.group(0)
        x = float(re.search(r'\bx="([^"]+)"', attrs).group(1))
        y = float(re.search(r'\by="([^"]+)"', attrs).group(1))
        w = float(re.search(r'\bwidth="([^"]+)"', attrs).group(1))
        h = float(re.search(r'\bheight="([^"]+)"', attrs).group(1))
        cards.append(
            {
                "label": label,
                "rect_start": abs_rect_start,
                "rect_end": abs_rect_end,
                "rect": attrs,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "glyph_start": glyph_start,
                "glyph_end": glyph_end,
                "text_start": text.start(),
                "text_end": text.end(),
            }
        )

    side = ICON_VIEW * ICON_ONLY_SCALE + ICON_ONLY_PAD
    placed = []
    for c in sorted(cards, key=lambda c: c["rect_start"], reverse=True):
        cx = c["x"] + c["w"] / 2
        cy = c["y"] + c["h"] / 2
        nx, ny = cx - side / 2, cy - side / 2
        kind, file, stroke = ICONS[c["label"]]
        icon_x = nx + (side - ICON_VIEW * ICON_ONLY_SCALE) / 2
        icon_y = ny + (side - ICON_VIEW * ICON_ONLY_SCALE) / 2
        new_rect = re.sub(r'\bx="[^"]+"', f'x="{_fmt(nx)}"', c["rect"], count=1)
        new_rect = re.sub(r'\by="[^"]+"', f'y="{_fmt(ny)}"', new_rect, count=1)
        new_rect = re.sub(r'\bwidth="[^"]+"', f'width="{_fmt(side)}"', new_rect, count=1)
        new_rect = re.sub(r'\bheight="[^"]+"', f'height="{_fmt(side)}"', new_rect, count=1)
        new_rect = re.sub(
            r'class="hw-([0-9a-f]+)-(?:hero|m)?cardbg"',
            r'class="hw-\1-cardbg"',
            new_rect,
        )
        new_rect = re.sub(r'\bstroke-width="[^"]+"', 'stroke-width="1.0"', new_rect)
        new_rect = re.sub(r'\bstroke-dasharray="[^"]+"\s*', "", new_rect)
        new_glyph = icon_markup(
            kind, file, stroke, icon_x, icon_y, ICON_ONLY_SCALE, fill=ICON_ONLY_FILL
        )
        svg = svg[: c["text_start"]] + svg[c["text_end"] :]
        svg = svg[: c["glyph_start"]] + new_glyph + svg[c["glyph_end"] :]
        svg = svg[: c["rect_start"]] + new_rect + svg[c["rect_end"] :]
        placed.append({**c, "nx": nx, "ny": ny, "side": side})

    return connect_export_cards(svg, orientation, placed)


def full_width(svg):
    """GitHub sizes SVGs from width/height; keep viewBox, span the README."""
    return re.sub(
        r'(<svg\b[^>]*?\s)width="[^"]+" height="[^"]+"',
        r'\1width="100%" height="auto"',
        svg,
        count=1,
    )


def build_one(name: str, staging: Path):
    spec = HERE / f"{name}.spec.json"
    out = staging / f"{name}.svg"
    compose(spec, out)
    orientation = json.loads(spec.read_text())["orientation"]
    svg = out.read_text()
    for label, (kind, file, stroke) in ICONS.items():
        if label in ICON_ONLY:
            continue  # icon_only_cards replaces these
        start, end, x, y, scale = glyph_span(svg, label)
        svg = svg[:start] + icon_markup(kind, file, stroke, x, y, scale) + svg[end:]
    svg = full_width(
        outline_regions(
            icon_only_cards(
                seat_materials_chip(color_export_wires(svg), orientation),
                orientation,
            )
        )
    )
    out.write_text(svg)
    subprocess.run(["hyperweave", "verify", str(out)], check=True, stdout=subprocess.DEVNULL)
    return out


def main():
    # Compose into staging so a failed verify leaves the committed SVG untouched.
    with tempfile.TemporaryDirectory(prefix="sketchfab-diagrams-") as tmp:
        out = build_one(SPEC, Path(tmp))
        target = HERE / out.name
        target.write_bytes(out.read_bytes())
        print(f"wrote {target.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
