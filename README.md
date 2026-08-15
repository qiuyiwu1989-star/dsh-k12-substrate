# dsh-k12-substrate

English | [中文](README.zh.md)

A **K12 capability substrate** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It lets the model look up capability anchors from China's national curriculum standards, check whether a character/word/poem is on an official list, record what a specific child has mastered (locally), and compute their character count and next steps.

Data comes from [China's MOE *Compulsory Education Curriculum Standards (2022)*](https://github.com/qiuyiwu1989-star/k12-knowledge-substrate).

## What this is NOT

This section comes first, because **mistaking it for full-curriculum coverage is worse than not installing it**.

1,339 candidate anchors were extracted from the standards. **Only 146** cleared the bar of "objectively decidable, no teacher review required" and ship in this package:

| | count |
|---|---|
| Fragments cut from the standards | 4,841 |
| Passed the decidability gate | 1,339 |
| Survived AI review | 600 |
| **Writable to a child's profile (what this plugin exposes)** | **146** |

Those 146 concentrate in **Chinese character recognition/writing/recitation** and **English vocabulary** — because correctness there is objective: either the character is written correctly or it isn't.

**Math, physics, and chemistry anchors are not available.** Judging them requires pedagogical judgement ("can apply the number-shape combination idea"), and no teacher has reviewed them, so they are excluded. `k12_substrate_info` reports this boundary, and `k12_find_capability` honestly returns 0 results for math — **absence here does not mean absence from the standards**.

For the same reason this plugin **cannot answer "what should be learned first"**. Only 2 dependency edges exist among usable anchors, both from measured set containment (basic character list ⊂ common character list 1, measured 95%; English level-2 vocab ⊂ level-3, measured 100%). That is not a learning path.

## Install

```bash
pnpm add dsh-k12-substrate
```

```bash
pnpm dsh web --patch ./node_modules/dsh-k12-substrate/cordis.patch.yml
```

Or insert into your own `cordis.yml`:

```yaml
- insert:
    - id: k12-substrate
      name: 'dsh-k12-substrate'
      config:
        profileDir: ''      # empty → ~/.dsh-k12-substrate/profiles/
        readOnly: false     # true → register query tools only, no profile writes
```

## Five tools

| Tool | What it does |
|---|---|
| `k12_substrate_info` | Coverage, provenance, and **known limitations**. Call before asserting what the standards require |
| `k12_find_capability` | Search anchors by subject / grade band / keyword; returns decidable statements and the basis for each |
| `k12_lookup_item` | Locate a character, word, or recitation piece in the official appendix lists: which table, what index, which grade band, recognize vs. write |
| `k12_record_mastery` | Record what a learner has mastered, to a **local** profile file |
| `k12_learner_progress` | Character count, vocabulary size, pieces recited, per-anchor completion, and next items |

The last two can be disabled with `readOnly: true`.

## Three hard rules

**1. Profiles stay local, and only counts are echoed back.**
`k12_record_mastery` records what a specific child can and cannot do — a minor's learning profile. It writes only under `profileDir` (default `~/.dsh-k12-substrate/profiles/`) and uploads nothing. The tool result reports counts, not the individual items: **tool results enter the model's context and may be written to session logs, compacted, and sent to the model provider**. Counts are what a product needs; item-by-item detail is not.

`learner` becomes the filename, so use a pseudonymous id (e.g. `stu_0001`). Values containing path-traversal characters are rejected.

**2. Model judgements are always `proposed`.**
Only a `holder` starting with `teacher:` or `parent:` is recorded as `confirmed`. The model saying a child knows something does not make it so, and silence is not confirmation. `k12_learner_progress` reports the two separately.

**3. Only usable anchors can be referenced.**
An assertion pointing at an unreviewed anchor means measuring a child with an unvalidated ruler. Passing an ID outside the 146 raises an error.

## Development

```bash
pnpm install
pnpm snapshot   # rebuild the data snapshot from ../os-k12-taxonomy
pnpm verify     # typecheck + 69 assertions
pnpm build
```

The smoke test (`scripts/smoke.ts`) runs without the DSH runtime, calling `execute()` directly against real data, real boundaries, and real disk writes. It caught two things typecheck could not: `required` on a node referenced by `items` throws `UNSUPPORTED_SCHEMA` at runtime; and a dedupe key format duplicated across three files where one separator was a literal NUL byte.

## License

Code MIT; bundled data ODbL v1.0 + CC BY-SA 4.0 (matching upstream). The curriculum text itself is not redistributed and remains the property of China's Ministry of Education. See [LICENSE](LICENSE).

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
