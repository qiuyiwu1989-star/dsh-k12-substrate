# dsh-k12-substrate

English | [中文](README.zh.md)

A **K12 capability substrate** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It lets the model look up capability anchors from China's national curriculum standards, check whether a character/word/poem is on an official list, record what a specific child has mastered (locally), and compute their character count and next steps.

Data comes from [China's MOE *Compulsory Education Curriculum Standards (2022)*](https://github.com/qiuyiwu1989-star/k12-knowledge-substrate).

## What this is NOT

This section comes first, because **mistaking this for teacher-validated data is worse than not installing it**.

This package ships **3,100 usable anchors across 24 subjects** (source: `data/substrate.json`, built from substrate v1.5). What "usable" means matters more than the number:

| | count | what it means |
|---|---|---|
| Objectively decidable | 146 | correctness is mechanical — a character is written correctly or it isn't |
| Judged by AI against the verbatim standard text | 2,954 | an AI read the source page and **found no fault** |
| **Signed off by a teacher** | **0** | **none** |

So **"usable" means "an AI checked it and found no fault" — not "a teacher approved it."** Treat every anchor that way.

Math, physics, chemistry and the rest are now included (math: 338). There are **4,889 dependency edges** among usable anchors, so the plugin can answer "what should be learned before this" — but those edges were proposed by a model and retagged in two stages, **not validated by a teacher either**.

One more boundary: anchors are at the **granularity of the national standard**, not of a lesson. Most span a whole stage (e.g. grades 1–2). Mapping a single lesson to one tells you *where it sits*, not that the child has finished learning it. Each result carries a granularity warning for this reason.

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

### Search can go through the substrate's MCP server

When the host mounts the substrate's MCP server (via the official bridge `@deepseek-ai/dsh-mcp-client`, `serverName: k12`), `k12_find_capability` with a `query` searches through it: live substrate data, the substrate's own ranking, a grain warning on every hit, and the hit is recorded by the substrate's usage counter (anchor IDs and counts only). Without it, the tool falls back to the bundled snapshot. Which path was taken is stated in the `route` field and on the first line of the result — never a silent fallback.

```bash
K12_TAXONOMY_ROOT=/path/to/os-k12-taxonomy \
  dsh web --patch ./examples/mcp/cordis.patch.yml --patch ./cordis.patch.yml
```

What goes through MCP, what doesn't, and the counting rules: [docs/mcp.md](docs/mcp.md) (Chinese).

## Three hard rules

**1. Profiles stay local, and only counts are echoed back.**
`k12_record_mastery` records what a specific child can and cannot do — a minor's learning profile. It writes only under `profileDir` (default `~/.dsh-k12-substrate/profiles/`) and uploads nothing. The tool result reports counts, not the individual items: **tool results enter the model's context and may be written to session logs, compacted, and sent to the model provider**. Counts are what a product needs; item-by-item detail is not.

`learner` becomes the filename, so use a pseudonymous id (e.g. `stu_0001`). Values containing path-traversal characters are rejected.

**2. Model judgements are always `proposed`.**
Only a `holder` starting with `teacher:` or `parent:` is recorded as `confirmed`. The model saying a child knows something does not make it so, and silence is not confirmation. `k12_learner_progress` reports the two separately.

**3. Only usable anchors can be referenced.**
An assertion pointing at an unreviewed anchor means measuring a child with an unvalidated ruler. Passing an ID outside the usable set raises an error.

## Development

```bash
pnpm install
pnpm snapshot   # rebuild the data snapshot from ../os-k12-taxonomy
pnpm verify     # typecheck + smoke assertions (no DSH runtime, never starts the real MCP server)
pnpm build
```

The smoke test (`scripts/smoke.ts`) runs without the DSH runtime, calling `execute()` directly against real data, real boundaries, and real disk writes. It caught two things typecheck could not: `required` on a node referenced by `items` throws `UNSUPPORTED_SCHEMA` at runtime; and a dedupe key format duplicated across three files where one separator was a literal NUL byte.

## License

Code MIT; bundled data ODbL v1.0 + CC BY-SA 4.0 (matching upstream). The curriculum text itself is not redistributed and remains the property of China's Ministry of Education. See [LICENSE](LICENSE).

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
