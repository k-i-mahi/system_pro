# User Study Protocol — Cognitive Copilot

**Investigators:** Khadimul Islam Mahi (2107076), Sumaiya Akter (2107080)
**Supervisor:** Prof. Md. Nazirul Hasan Shawon
**Course:** CSE 3200 — System Development Project
**IRB posture:** Capstone project; non-clinical, minimal-risk; supervisor approval in lieu of formal IRB.

## Research questions

- **RQ1.** Does using Cognitive Copilot with grounded RAG answers improve topic-level quiz accuracy compared to each participant's own baseline?
- **RQ2.** Do participants find the system usable (SUS ≥ 70) and trustworthy (post-study interview theme coding)?
- **RQ3.** Does the Socratic mode produce higher self-reported understanding than the free-form chat mode?

## Design

- **Type.** Within-subjects pre/post with opt-in telemetry. No control arm — the baseline is each student's own pre-test on the same topic bank.
- **Duration.** 2 weeks (1-week fallback if recruitment stalls).
- **Target sample size.** n = 12 (minimum n = 6 pilot).
- **Setting.** Remote, unsupervised. Participants install locally or use a shared server instance provided by the supervisor.

## Participants

- **Inclusion.** 3rd- / 4th-year KUET CSE undergraduates currently enrolled in a course where at least one provided sample topic (data structures, algorithms, OS, networks, ML) is relevant.
- **Exclusion.** Co-investigators (Mahi, Sumaiya). Course TAs for the materials under study.
- **Recruitment.** Announcement on departmental mailing list forwarded by Prof. Shawon + in-person at two course meetings. Incentive: tutor-generated study packets (marginal cost zero).

## Consent

All participants sign the [consent form](consent.md) before any telemetry is enabled. Consent covers:

1. Collection of quiz scores, posterior updates, LLM call metadata (route, latency, tokens — no prompt text), and self-reported Likert responses.
2. Opt-in, revocable at any time; data is purged on revocation.
3. Anonymised aggregate reporting only. Individual quotes in the report require a second, explicit sign-off.

## Timeline

| Day        | Activity                                         |
|------------|--------------------------------------------------|
| Day 0 Mon  | Onboarding session (30 min) + consent signing    |
| Day 0 Mon  | Pre-test: 10 MCQ across two topics               |
| Day 1–6    | Free use; study telemetry auto-captured          |
| Day 7 Mon  | Post-test: 10 parallel MCQ across same topics    |
| Day 7 Mon  | SUS questionnaire + NPS item                     |
| Day 8–9    | 5 semi-structured interviews (15 min each)       |
| Day 10     | Data freeze; analysis begins                     |

## Measures

### Primary

- **Pre/post quiz accuracy.** Ten 4-option MCQs per topic pre and post, drawn from the same item bank (parallel forms, Cronbach α ≥ 0.7 target).
- **SUS.** Standard 10-item 5-point Likert System Usability Scale.

### Secondary

- **Posterior expertise shift.** Change in Beta posterior mean per topic across the study window.
- **Faithfulness self-report.** "The tutor's answers were grounded in my course materials." (5-point Likert.)
- **NPS.** "Would you recommend this tool to a classmate?" (0–10.)

### Qualitative

- **Semi-structured interview guide** (see [`interview-guide.md`](interview-guide.md), next iteration):
  - Walk me through the moment the tutor helped you most. What made it work?
  - When did you *distrust* an answer? What cue made you doubt it?
  - How did Socratic mode feel vs. the chat?
  - What would make you abandon this tool and return to ChatGPT?

## Analysis plan

- **Paired t-test** for pre/post accuracy, with Cohen's *d* as effect size.
- **Descriptives** for SUS (mean, SD, quartiles) + 0–100 score mapping.
- **Thematic coding.** Two coders independently code the five transcripts; Cohen's κ reported on a shared subset of three transcripts.
- **Posterior trajectories.** Per-topic α/β traces plotted over the study window; qualitative read of monotonicity and convergence.

All statistics run through [`scripts/analyze_study.py`](../scripts/analyze_study.py).

## Data handling

- Raw telemetry lives only in the running Postgres instance, keyed by an opaque participant_id.
- At the end of the study, the analysis script exports anonymised CSVs into `study/data/`.
- The LlmCall table is **not** exported in prompt/completion form — only route, latency, tokens, status.
- Study artefacts are deleted 90 days after the award submission unless the participant grants extended retention.

## Threats to validity

- **Small sample.** n = 12 is underpowered for subgroup analyses. We report as preliminary evidence, not as a clinical claim.
- **Novelty effect.** The two-week window likely inflates SUS scores. We note this in the limitations section of the report.
- **Selection bias.** Participants who volunteer are plausibly more motivated than the course mean. We disclose this and avoid generalising.
- **Experimenter bias.** Co-investigators also grade quizzes. Mitigation: MCQ auto-grading; no free-response scoring by investigators.

## Fallback plan

If recruitment yields fewer than six participants by Day 3, the study becomes a **self-case-study (n = 1 or 2)** with qualitative narrative plus quantitative system metrics (RAG faithfulness, latency, OCR WER) carrying the evaluative load in the report. This posture is stated up front to avoid over-claiming under time pressure.
