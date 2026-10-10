#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib>=3.8", "typer>=0.12"]
# ///
"""Compare Dark Reader's CPU time on one page across builds as flame graphs on one time scale.

fold: turn benchmark-load.mjs .cpuprofile files into folded stacks (mean ms per run),
keeping only stacks that pass through the extension, starting at its outermost frame.
plot: draw two folded files as flame graphs sharing an x-axis in ms, light and dark,
with anonymous frames folded into their callers.
"""
import json
from collections import defaultdict
from pathlib import Path

import typer

app = typer.Typer(add_completion=False)


@app.command()
def fold(out: Path, profiles: list[Path]):
    totals = defaultdict(float)
    for path in profiles:
        prof = json.loads(path.read_text())
        nodes = {n["id"]: n for n in prof["nodes"]}
        parent = {c: n["id"] for n in prof["nodes"] for c in n.get("children", [])}
        stacks = {}
        for nid, dt in zip(prof["samples"], prof["timeDeltas"]):
            if nid not in stacks:
                frames, cur = [], nid
                while cur is not None:
                    frames.append(nodes[cur]["callFrame"])
                    cur = parent.get(cur)
                frames.reverse()
                first = next((i for i, f in enumerate(frames) if f["url"].startswith("chrome-extension://")), None)
                stacks[nid] = None if first is None else ";".join(f["functionName"] or "(anonymous)" for f in frames[first:])
            if stacks[nid]:
                totals[stacks[nid]] += dt / 1000 / len(profiles)
    out.write_text("".join(f"{k} {v:.3f}\n" for k, v in sorted(totals.items())))
    print(f"{out}: {sum(totals.values()):.0f} ms per run, {len(totals)} stacks")


def tree(folded: Path):
    root = {"ms": 0.0, "kids": {}}
    for line in folded.read_text().splitlines():
        stack, ms = line.rsplit(" ", 1)
        node = root
        node["ms"] += float(ms)
        for name in stack.split(";"):
            if name == "(anonymous)":
                continue  # fold wrapper callbacks into their callers so labels name real functions
            node = node["kids"].setdefault(name, {"ms": 0.0, "kids": {}})
            node["ms"] += float(ms)
    return root


THEMES = {
    "light": dict(text="#0b0b0b", muted="#52514e", grid="#e1e0d9", bg="#ffffff", series={"stock": "#eb6834", "main": "#2a78d6"}),
    "dark": dict(text="#ffffff", muted="#c3c2b7", grid="#2c2c2a", bg="#0d1117", series={"stock": "#d95926", "main": "#3987e5"}),
}


@app.command()
def plot(stock: Path, main: Path, out_prefix: Path, depth: int = typer.Option(14, help="Rows to draw")):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import to_rgba

    trees = {"stock": tree(stock), "main": tree(main)}
    span = max(t["ms"] for t in trees.values())
    for mode, th in THEMES.items():
        plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "svg.fonttype": "path"})
        fig, axes = plt.subplots(2, 1, figsize=(9.6, 2 * (depth * 0.19 + 0.55)), sharex=True)
        fig.patch.set_alpha(0)
        for ax, (build, t) in zip(axes, trees.items()):
            color = th["series"][build]

            def draw(node, x, level):
                for name, kid in sorted(node["kids"].items()):
                    if level < depth and kid["ms"] >= span * 0.002:
                        fill = to_rgba(color, 0.32 if level % 2 else 0.5)
                        ax.add_patch(plt.Rectangle((x, level), kid["ms"], 0.92, facecolor=fill, edgecolor=th["bg"], linewidth=0.6))
                        chars = int(kid["ms"] / span * 9.6 * 72 / 5.6)
                        if chars >= 4:
                            label = name if len(name) <= chars else name[: chars - 1] + "…"
                            ax.text(x + span * 0.003, level + 0.46, label, va="center", ha="left", fontsize=7, color=th["text"], clip_on=True)
                        draw(kid, x, level + 1)
                    x += kid["ms"]

            draw(t, 0.0, 0)
            ax.set_ylim(0, depth)
            ax.set_xlim(0, span)
            ax.set_yticks([])
            for side in ("top", "right", "left"):
                ax.spines[side].set_visible(False)
            ax.spines["bottom"].set_color(th["grid"])
            ax.tick_params(colors=th["muted"], length=3)
            ax.set_facecolor((0, 0, 0, 0))
            ax.set_title(f"{'Stock Dark Reader' if build == 'stock' else 'This fork'}: {t['ms']:.0f} ms", loc="left", color=th["text"], fontsize=10)
        axes[-1].set_xlabel("ms of Dark Reader CPU time per page load, mean of 3 loads", color=th["muted"])
        fig.tight_layout()
        path = Path(f"{out_prefix}-{mode}.svg")
        fig.savefig(path, transparent=True)
        plt.close(fig)
        print(path)


if __name__ == "__main__":
    app()
