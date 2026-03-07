# Shared Experiment Context (EEG + Questionnaire + Eye-tracking)

> Canonical cross-project context for the *same experiment*.
> Used by the three Telegram project groups:
> - EEG: github.com/wannaqueen66-create/eeg
> - Questionnaire/SPSS: github.com/wannaqueen66-create/spss
> - Eye-tracking: github.com/wannaqueen66-create/eyetrack-aoi + eyetrack

## 0) Purpose
- Keep terminology, IDs, condition definitions, and reporting consistent across the three analysis tracks.
- Store only experiment-level, non-sensitive shared facts (no credentials).

## 1) Experiment overview (fill/confirm)
- Participants: ____
- Blocks: Block 1 + Block 2 (same 6 scenes repeated; order may be counterbalanced by `Order`)
- Scenes: 6 scenes per block (same set across modalities)
- Factors: WWR ∈ {15, 45, 75}, Complexity ∈ {Low, High}
- Data acquisition: EEG and eye-tracking were collected in the same experiment pipeline and should be treated as alignable multimodal data whenever participant/trial/time mapping is available.

## 2) Core definitions (fill/confirm)
### Scene complexity
- Final_Score = 0.5 * z(FC) + 0.5 * z(DL)
- FC: Feature Congestion (Rosenholtz model)
- DL: Deep learning perceived complexity (InceptionV3 regression)

### Condition naming conventions
- WWR: 15/45/75 (string/number normalization)
- Complexity: C0/C1 (or Low/High; keep one canonical label in analysis tables and map the other)
- Block/Round: two blocks/rounds (often labeled group1/group2 in manifests). Canonical columns:
  - `round` (1/2, numeric)
  - `round_label` (group1/group2, optional)
  Use **one term consistently in writeups** (recommend: “Round”, and in code allow alias `block`).
- Grouping variables (between-subject):
  - `Experience` (High/Low)
  - `SportFreq` (High/Low)
  - Optional combined 4-level group: `Group4 = SportFreq × Experience`

## 3) Shared IDs / mapping tables (recommended)
- subject_id: ____
- scene_id / scene_name: ____
- trial_id: (optional) 1..12, equivalent to `scene_id`
- block_id: 1..2 (Block 1 / Block 2)
- cycle_in_block: 1..6 (position within a block)
- scene_id: 1..12, canonical across modalities: `scene_id = (block_id-1)*6 + cycle_in_block`

## 4) Output/reporting standards
- When adding new analyses, update both:
  - bilingual README (CN+EN)
  - separate Chinese-only MD
- Prefer reproducible scripts + fixed output directories.

## 5) Update protocol
- If a finding/decision affects more than one modality, append a short note here.
- Keep changes small and dated.

