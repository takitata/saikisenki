# Sword Saint against fixed five-card opponents

- Seed: 20261005
- Scenario rosters per lineup: 5000
- Actual matches: 50000
- Each roster scenario is played once with Sword Saint side as player and once as CPU.
- Both owned pools have 15 cards; the opponent always has 5 battle and 10 support cards.
- Previous 1v1–5v5 results remain in the separate paired-balance report and are not included.

| Sword Saint battle cards | Sword Saint support | Opponent battle/support | Matches | Win% | Avg rounds | Sword Saint damage | Survival rounds | Sword-side support used/unused | Opponent support used/unused | Enemy distinct cards KOd | Sword Saint KOd rate | All five defeated rate |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 10 | 5/10 | 10000 | 56.75% | 22.25 | 188.8 | 5.27 | 9.82 / 0.18 | 9.80 / 0.20 | 4.50 | 100.00% | 56.75% |
| 4 | 11 | 5/10 | 10000 | 59.77% | 18.56 | 321.1 | 6.31 | 10.53 / 0.47 | 9.62 / 0.38 | 4.54 | 99.49% | 59.77% |
| 3 | 12 | 5/10 | 10000 | 46.77% | 15.61 | 394.1 | 7.08 | 10.45 / 1.55 | 9.36 / 0.64 | 4.28 | 97.82% | 46.77% |
| 2 | 13 | 5/10 | 10000 | 46.01% | 11.76 | 525.9 | 8.13 | 8.61 / 4.39 | 8.46 / 1.54 | 4.23 | 85.30% | 46.01% |
| 1 | 14 | 5/10 | 10000 | 44.60% | 9.23 | 643.7 | 9.23 | 6.81 / 7.19 | 7.16 / 2.84 | 4.25 | 55.40% | 44.60% |

## Opponent variety

| Sword Saint battle cards | Distinct opposing 5-card lineups | Distinct opposing 15-card pools | Opponent Rare battle cards 0/1/2/3 (roster scenarios) |
|---:|---:|---:|---|
| 5 | 4994 | 5000 | {"0":1672,"1":2537,"2":733,"3":58} |
| 4 | 4999 | 5000 | {"0":1678,"1":2433,"2":822,"3":67} |
| 3 | 4993 | 5000 | {"0":1753,"1":2382,"2":810,"3":55} |
| 2 | 4996 | 5000 | {"0":1798,"1":2363,"2":782,"3":57} |
| 1 | 4993 | 5000 | {"0":1729,"1":2412,"2":800,"3":59} |

## Player/CPU side check

| Sword Saint battle cards | Player-side win% | CPU-side win% | Player-side average rounds | CPU-side average rounds |
|---:|---:|---:|---:|---:|
| 5 | 57.06% | 56.44% | 22.25 | 22.26 |
| 4 | 59.86% | 59.68% | 18.59 | 18.52 |
| 3 | 46.70% | 46.84% | 15.59 | 15.63 |
| 2 | 45.58% | 46.44% | 11.76 | 11.75 |
| 1 | 45.14% | 44.06% | 9.25 | 9.20 |

## Scope and limits

- The current BattleEngine fixes KO successor order cyclically; no user choice is simulated.
- AI choices are heuristic; outcomes are not an optimal-play bound.
- Browser rendering and user-input timing are not simulated.
- Support-use counts are reported separately for the Sword Saint side and opponent.
