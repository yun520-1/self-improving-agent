/**
 * Self-Improving Agent v1.1.0
 * Safe incremental upgrade module.
 *
 * Goals:
 * - capture a lightweight environment snapshot
 * - generate a prioritized upgrade proposal
 * - keep the core engine untouched
 */

const os = require('os');

function captureEnvironmentSnapshot() {
  const now = new Date();
  return {
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    hour: now.getHours(),
    platform: process.platform,
    node: process.version,
    cpuCount: os.cpus().length,
    totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
  };
}

function rankUpgradeTargets() {
  return [
    {
      target: 'decision-execution-loop',
      reason: 'closes the gap between decision, execution, and feedback',
      priority: 1,
    },
    {
      target: 'environment-sensor',
      reason: 'adds runtime context for better decisions',
      priority: 2,
    },
    {
      target: 'self-verification',
      reason: 'reduces silent regressions during upgrades',
      priority: 3,
    },
  ];
}

function buildUpgradeProposal() {
  const env = captureEnvironmentSnapshot();
  const targets = rankUpgradeTargets();
  return {
    version: '1.1.0',
    env,
    targets,
    summary: 'Safe incremental upgrade: preserve current core, add observability and execution feedback.',
  };
}

module.exports = {
  captureEnvironmentSnapshot,
  rankUpgradeTargets,
  buildUpgradeProposal,
};
