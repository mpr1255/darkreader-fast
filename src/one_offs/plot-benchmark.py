#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["matplotlib>=3.8"]
# ///
"""Plot docs/benchmark/results.csv as three panels of per-page medians, in light and dark.

Usage: plot-benchmark.py RESULTS.csv OUT_PREFIX
"""
import csv
import math
import statistics
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

BUILDS = [("stock", "Stock Dark Reader", "s"), ("perf", "perf branch", "D"), ("main", "This fork", "o")]
PANELS = [("script_ms", "Script time per load", "linear", (0, 2000)),
          ("longest_block_ms", "Longest block of the page", "log", (0.7, 1000)),
          ("dark_at_ms", "Time until fully dark", "linear", (0, 3000))]
THEMES = {
    "light": dict(bg="#ffffff", text="#0b0b0b", muted="#52514e", grid="#e1e0d9", series={"stock": "#1baf7a", "perf": "#eb6834", "main": "#2a78d6"}),
    "dark": dict(bg="#0d1117", text="#ffffff", muted="#c3c2b7", grid="#2c2c2a", series={"stock": "#199e70", "perf": "#d95926", "main": "#3987e5"}),
}

rows = list(csv.DictReader(open(sys.argv[1])))
pages = list(dict.fromkeys(r["page"] for r in rows))


def median(page, build, field):
    runs = [r for r in rows if r["page"] == page and r["build"] == build]
    if field != "dark_at_ms" and any(r["stuck_on_cover"] == "1" for r in runs):
        return None  # never themed: its time is not comparable
    vals = [float(r[field]) for r in runs if r[field] != ""]
    return statistics.median(vals) if len(vals) == len(runs) else None


plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "svg.fonttype": "path"})
for mode, th in THEMES.items():
    fig, axes = plt.subplots(1, 3, figsize=(10, 3.4), sharey=True)
    fig.patch.set_alpha(0)
    for ax, (field, title, scale, lim) in zip(axes, PANELS):
        ax.set_facecolor((0, 0, 0, 0))
        ax.set_xscale(scale)
        ax.set_xlim(*lim)
        for y, page in enumerate(pages):
            vals = {b: median(page, b, field) for b, _, _ in BUILDS}
            seen = [v for v in vals.values() if v is not None]
            if len(seen) > 1:
                ax.plot([min(seen), max(seen)], [y, y], color=th["grid"], linewidth=2, zorder=1, solid_capstyle="round")
            for build, _, marker in BUILDS:
                if vals[build] is not None:
                    ax.scatter(max(vals[build], lim[0]), y, s=46, marker=marker, color=th["series"][build], edgecolors=th["bg"], linewidths=1.2, zorder=3)
            stuck = any(r["stuck_on_cover"] == "1" for r in rows if r["page"] == page and r["build"] == "stock")
            note = "stock never themed" if stuck else "not timed" if not seen else None
            if note:
                if not seen:
                    x, ha = (lim[0] if scale == "linear" else 1), "left"
                else:
                    frac = (math.log(max(seen) / lim[0]) / math.log(lim[1] / lim[0])) if scale == "log" else max(seen) / lim[1]
                    pad = 1.35 if scale == "log" else lim[1] * 0.03
                    if frac < 0.55:
                        x, ha = (max(seen) * pad if scale == "log" else max(seen) + pad), "left"
                    else:
                        x, ha = (min(seen) / pad if scale == "log" else min(seen) - pad), "right"
                ax.text(x, y, note, color=th["muted"], va="center", ha=ha, fontsize=8).set_in_layout(False)
        ax.set_title(title + " (ms)", loc="left", color=th["text"], fontsize=10)
        ax.grid(axis="x", color=th["grid"], linewidth=0.6)
        ax.set_axisbelow(True)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(th["grid"])
        ax.tick_params(colors=th["muted"], length=0)
        if scale == "log":
            ax.set_xticks([1, 10, 100, 1000], ["1", "10", "100", "1000"])
    axes[0].set_yticks(range(len(pages)), pages, color=th["text"])
    axes[0].set_ylim(len(pages) - 0.5, -0.5)
    handles = [plt.Line2D([], [], marker=m, linestyle="", markersize=7, color=th["series"][b], label=label) for b, label, m in BUILDS]
    fig.legend(handles=handles, loc="upper left", bbox_to_anchor=(0.0, 1.0), ncol=3, frameon=False, labelcolor=th["text"], handletextpad=0.3, columnspacing=1.6)
    fig.tight_layout(rect=(0, 0, 1, 0.92))
    out = Path(f"{sys.argv[2]}-{mode}.svg")
    fig.savefig(out, transparent=True)
    plt.close(fig)
    print(out)
