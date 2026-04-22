#!/usr/bin/env python3
"""
Analyse study telemetry CSVs exported from Postgres after the Cognitive Copilot
user study.

Expected CSVs in ``study/data/`` (or the directory passed as --data-dir):

* ``prepost.csv``      — columns: participant_id, pre_score, post_score, n_items
* ``sus.csv``          — columns: participant_id, q1, q2, ..., q10  (1–5 scale)
* ``nps.csv``          — columns: participant_id, nps               (0–10 scale)
* ``posteriors.csv``   — columns: participant_id, topic_id, alpha, beta, mean

Outputs a markdown summary to stdout (or to --out).

Usage:
    python scripts/analyze_study.py --data-dir study/data --out study/report.md
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import pandas as pd
from scipy import stats


SUS_ODD = [1, 3, 5, 7, 9]   # positively worded
SUS_EVEN = [2, 4, 6, 8, 10] # negatively worded


@dataclass
class PrePostResult:
    n: int
    mean_pre: float
    mean_post: float
    sd_pre: float
    sd_post: float
    t_stat: float
    p_value: float
    cohens_d: float


def paired_ttest(pre: pd.Series, post: pd.Series) -> PrePostResult:
    """Paired-samples t-test with Cohen's d (using the SD of differences)."""
    if len(pre) != len(post):
        raise ValueError("pre and post must have equal length")
    diffs = post - pre
    n = len(diffs)
    if n < 2:
        return PrePostResult(
            n=n,
            mean_pre=float(pre.mean()),
            mean_post=float(post.mean()),
            sd_pre=float(pre.std(ddof=1)) if n > 1 else 0.0,
            sd_post=float(post.std(ddof=1)) if n > 1 else 0.0,
            t_stat=float("nan"),
            p_value=float("nan"),
            cohens_d=float("nan"),
        )
    result = stats.ttest_rel(post, pre)
    sd_diff = diffs.std(ddof=1)
    cohens_d = diffs.mean() / sd_diff if sd_diff > 0 else float("nan")
    return PrePostResult(
        n=n,
        mean_pre=float(pre.mean()),
        mean_post=float(post.mean()),
        sd_pre=float(pre.std(ddof=1)),
        sd_post=float(post.std(ddof=1)),
        t_stat=float(result.statistic),
        p_value=float(result.pvalue),
        cohens_d=float(cohens_d),
    )


def sus_score(row: pd.Series) -> float:
    """Convert one 10-item SUS row (q1..q10, 1–5) into a 0–100 score."""
    total = 0.0
    for i in SUS_ODD:
        total += row[f"q{i}"] - 1
    for i in SUS_EVEN:
        total += 5 - row[f"q{i}"]
    return total * 2.5


def nps_bucket(value: float) -> str:
    if value >= 9:
        return "promoter"
    if value >= 7:
        return "passive"
    return "detractor"


def describe_posterior_shift(df: pd.DataFrame) -> pd.DataFrame:
    """Aggregate per-participant posterior mean as a summary."""
    if df.empty:
        return pd.DataFrame()
    return (
        df.groupby("participant_id", as_index=False)
        .agg(
            n_topics=("topic_id", "count"),
            mean_mastery=("mean", "mean"),
            median_mastery=("mean", "median"),
        )
    )


def render_markdown(
    prepost: PrePostResult | None,
    sus: pd.DataFrame | None,
    nps: pd.DataFrame | None,
    posteriors: pd.DataFrame | None,
) -> str:
    lines: list[str] = ["# Cognitive Copilot — Study Analysis\n"]

    if prepost is not None:
        lines += [
            "## Pre/post quiz accuracy (paired t-test)\n",
            f"- **n**: {prepost.n}",
            f"- **Pre mean ± SD**: {prepost.mean_pre:.2f} ± {prepost.sd_pre:.2f}",
            f"- **Post mean ± SD**: {prepost.mean_post:.2f} ± {prepost.sd_post:.2f}",
            f"- **t**: {prepost.t_stat:.3f}",
            f"- **p-value**: {prepost.p_value:.4f}",
            f"- **Cohen's d**: {prepost.cohens_d:.3f}",
            "",
        ]

    if sus is not None and not sus.empty:
        scored = sus.apply(sus_score, axis=1)
        lines += [
            "## System Usability Scale (SUS)\n",
            f"- **n**: {len(scored)}",
            f"- **Mean ± SD**: {scored.mean():.1f} ± {scored.std(ddof=1):.1f}",
            f"- **Median**: {scored.median():.1f}",
            f"- **Min / Max**: {scored.min():.1f} / {scored.max():.1f}",
            f"- **Adjectival rating**: "
            + (
                "Excellent"
                if scored.mean() >= 85
                else "Good"
                if scored.mean() >= 70
                else "OK"
                if scored.mean() >= 50
                else "Poor"
            ),
            "",
        ]

    if nps is not None and not nps.empty:
        buckets = nps["nps"].map(nps_bucket).value_counts()
        promoters = int(buckets.get("promoter", 0))
        passives = int(buckets.get("passive", 0))
        detractors = int(buckets.get("detractor", 0))
        total = promoters + passives + detractors
        score = (promoters / total - detractors / total) * 100 if total else float("nan")
        lines += [
            "## Net Promoter Score (NPS)\n",
            f"- **n**: {total}",
            f"- **Promoters**: {promoters} | **Passives**: {passives} | **Detractors**: {detractors}",
            f"- **NPS**: {score:.1f}",
            "",
        ]

    if posteriors is not None and not posteriors.empty:
        shift = describe_posterior_shift(posteriors)
        lines += ["## Beta-posterior mastery (per participant)\n", shift.to_markdown(index=False), ""]

    return "\n".join(lines)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path("study/data"))
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)

    data_dir: Path = args.data_dir
    if not data_dir.exists():
        print(f"data directory not found: {data_dir}", file=sys.stderr)
        return 1

    prepost_path = data_dir / "prepost.csv"
    sus_path = data_dir / "sus.csv"
    nps_path = data_dir / "nps.csv"
    posteriors_path = data_dir / "posteriors.csv"

    prepost_result: PrePostResult | None = None
    if prepost_path.exists():
        prepost = pd.read_csv(prepost_path)
        prepost_result = paired_ttest(prepost["pre_score"], prepost["post_score"])

    sus = pd.read_csv(sus_path) if sus_path.exists() else None
    nps = pd.read_csv(nps_path) if nps_path.exists() else None
    posteriors = pd.read_csv(posteriors_path) if posteriors_path.exists() else None

    output = render_markdown(prepost_result, sus, nps, posteriors)
    if args.out:
        args.out.write_text(output, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
