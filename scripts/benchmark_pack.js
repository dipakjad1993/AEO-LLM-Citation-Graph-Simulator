/**
 * Benchmark pack — Stork-style reference run (grounded rates by engine + Wilson CIs).
 * Usage: node scripts/benchmark_pack.js --questions 50 [--out data/output/benchmark.json]
 * Runs the orchestrator prompt set across all 6 engines (cost-guarded by
 * max_calls_per_run:2500 + $500/day budget), then prints grounded vs memory split
 * per engine for backlinks/press/FUD-killing. Profound hides this split — we publish it.
 */
const questions = Number((process.argv.find((a, i) => process.argv[i - 1] === '--questions') && process.argv[process.argv.indexOf('--questions') + 1]) || 50);
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'data/output/benchmark.json';
console.log(`Benchmark pack: ${questions} questions x 6 engines (~$${(questions * 0.245).toFixed(2)} at 24.5c/question).`);
console.log(`Cost guards: max_calls_per_run:2500, $500/day budget. Output: ${out}`);
console.log('Steps: 1) npm run full-run  2) node src/node-orchestrator/scheduler.js --check-alerts  3) publish grounded rates + Wilson CIs.');
console.log('Grounded-only SoMV per engine + LOW_BROWSE_RATE/BELOW_BENCHMARK_74 flags are the headline chart.');
