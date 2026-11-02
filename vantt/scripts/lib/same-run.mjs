// Pristine-upstream measurement made in the same run on the same machine. Quantised ONNX
// scores differ per CPU, so the quality gate compares the fork with upstream measured
// here, not with numbers recorded elsewhere. T4 (invariance.mjs) already evaluates
// upstream; it leaves its report in `vantt/.work/invariance-last.json` and the gate reuses
// it when it describes this very commit. Otherwise the gate measures upstream itself.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { datasetDir, evalEnv, goldenFile, runEvaluate } from './eval-run.mjs';
import { git } from './proc.mjs';
import { createUpstreamTree } from './trees.mjs';

export const sameRunFile = (root) => path.join(root, 'vantt', '.work', 'invariance-last.json');

/** Upstream summary from T4's report if it was made for this sha, this HEAD and this k; else null. */
export function readSameRun(root, { sha, corpus, k }) {
  const file = sameRunFile(root);
  if (!existsSync(file) || !sha) return null;
  try {
    const rep = JSON.parse(readFileSync(file, 'utf8'));
    const c = rep.corpora?.[corpus];
    if (rep.target?.sha !== sha || rep.fork_head !== git(root, ['rev-parse', 'HEAD']) || rep.k !== k || !c?.summary_upstream) return null;
    return { summary: c.summary_upstream, source: 'invariance' };
  } catch {
    return null;
  }
}

/**
 * Reference result of pristine upstream on `corpus`: {summary, source}. Reuses T4's measurement,
 * else checks upstream out at `sha` and evaluates it. Returns null when no sha is given.
 */
export function sameRunUpstream({ root, sha, corpus, k, scratch, log }) {
  if (!sha) return null;
  const cached = readSameRun(root, { sha, corpus, k });
  if (cached) {
    log('  pristine upstream: reusing the invariance run of this commit');
    return cached;
  }
  log('  pristine upstream: measuring it now (no current invariance run)');
  const tree = createUpstreamTree(root, sha, path.join(scratch, 'upstream'), log);
  try {
    const result = runEvaluate({
      tree: tree.dir,
      vault: datasetDir(root, corpus),
      golden: goldenFile(root, corpus),
      scratch,
      k,
      env: evalEnv(),
      log,
    });
    return { summary: result.summary, source: 'measured' };
  } finally {
    tree.cleanup();
    rmSync(path.join(scratch, 'upstream'), { recursive: true, force: true });
  }
}
