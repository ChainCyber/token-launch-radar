# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ChainCyber/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ChainCyber/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 198 protocols that **record no token**, ranked by what a token would be worth if one launched — priced off the tokens that already trade — with a concrete farm plan for each one. Built from the sealed DefiLlama snapshot alone; no live data, no network, no predictions about whether or when any token launches.

## Model (comps-2)

The board covers all 40 watchlist protocols (TVL ≥ $50M, records no token, not a wrapped, staked or bridged product) plus the next 158 pre-token protocols by TVL that pass the same screen — the watchlist's own exclusion rule applied to the whole universe, so no bridge, liquid-staking, restaked, or exchange product ranks as a launch candidate. A wrapped, staked or bridged product of a token that already trades is not a protocol still waiting on a launch of its own.

For each category, the **category ratio** is the median `mcap_usd / tvl_usd` of the tokenized protocols in that category. A category with fewer than 3 tokenized comps falls back to the global median ratio. Then:

```
implied_value_usd = round(TVL × category_ratio × growth_factor × age_factor × chain_factor)
  growth_factor = 1 + clamp(change_7d, -50, 100) / 400   (null change → 1)
  age_factor    = 0.9 + min(age_days, 1825) / 1825 × 0.2  (0.9–1.1; null listed_at → 1.0)
  chain_factor  = min(1 + 0.02 × (num_chains − 1), 1.10)
```

Rows sort by implied value descending (ties: TVL desc, then slug asc), and implied values are forced strictly decreasing down the ranks ($1 shaves where a tie would stand), so rank 1 is always the most valuable. No protocol name is special-cased anywhere.

Each row carries a 6-step farm plan generated from the protocol's own record (name, category, chains, TVL, age): concrete on-chain actions, each with a cost and a time, ending with a step noting the token is unconfirmed and must be verified through the protocol's official channels.

The dashboard (`dashboard/`) is a static page — search, category/chain/min-TVL filters, sorting, a detail view per protocol with the full farm plan and the model breakdown, and hash deep links (`#slug=…`, `#category=…`, `#chain=…`). It reads `data.js` and names no network address.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot path>
```

Node 22, standard library only. `main.ts` reads the snapshot, writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json` with `buildDossier` from `vendor/makefun-board.ts`. It exits non-zero if the board would fail the gate (coverage, ranks, order, farm steps).

<sub>Entered on [make.fun](https://make.fun/?ref=czm39tme&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
