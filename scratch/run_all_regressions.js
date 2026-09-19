const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const suites = [
  { phase: 9, file: 'scratch/test_phase9_architecture.js' },
  { phase: 10, file: 'scratch/test_phase10_advisor.js' },
  { phase: 11, file: 'scratch/test_phase11_patterns.js' },
  { phase: 12, file: 'scratch/test_phase12_scenarios.js' },
  { phase: 13, file: 'scratch/test_phase13_goals_budgets.js' },
  { phase: 14, file: 'scratch/test_phase14_kpi.js' },
  { phase: 15, file: 'scratch/test_phase15_cashflow_calendar.js' },
  { phase: 16, file: 'scratch/test_phase16_action_center.js' },
  { phase: 17, file: 'scratch/test_phase17_payment_readiness.js' },
  { phase: 18, file: 'scratch/test_phase18_cash_planning.js' },
  { phase: 19, file: 'scratch/test_phase19_mitigation.js' },
  { phase: 20, file: 'scratch/test_phase20_statement.js' },
  { phase: 21, file: 'scratch/test_phase21_settlement.js' },
  { phase: 22, file: 'scratch/test_phase22_collections.js' },
  { phase: 23, file: 'scratch/test_phase23_risk.js' },
  { phase: 24, file: 'scratch/test_phase24_decision_workspace.js' },
  { phase: 25, file: 'scratch/test_phase25_action_tracking.js' },
  { phase: 26, file: 'scratch/test_phase26_persistence.js' },
  { phase: 27, file: 'scratch/test_phase27_provider.js' },
  { phase: 28, file: 'scratch/test_phase28_reconciliation.js' }
];

console.log('======================================================');
console.log('RUNNING ALL PHASE 9 - PHASE 28 REGRESSION SUITES');
console.log('======================================================');

const results = [];

for (const suite of suites) {
  process.stdout.write(`Running Phase ${suite.phase} (${suite.file})... `);
  try {
    const output = execSync(`node ${suite.file}`, { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    
    // Parse pass/fail counts
    let passed = 0;
    let failed = 0;
    
    // Look for common summary patterns:
    // e.g. "AUDIT RESULTS: 56 PASSED, 0 FAILED"
    // e.g. "Results: 42 passed, 0 failed"
    // e.g. "Passed: 15, Failed: 0"
    // e.g. counting "[PASS]" vs "[FAIL]"
    
    const summaryMatch = output.match(/(\d+)\s+(?:passed|PASSED)[,\s]+(\d+)\s+(?:failed|FAILED)/i) ||
                         output.match(/(?:Passed|PASSED):\s*(\d+)[,\s]+(?:Failed|FAILED):\s*(\d+)/i);
    
    if (summaryMatch) {
      passed = parseInt(summaryMatch[1], 10);
      failed = parseInt(summaryMatch[2], 10);
    } else {
      const passMatches = (output.match(/\[PASS\]|✓|✔/g) || []).length;
      const failMatches = (output.match(/\[FAIL\]|✗|✘/g) || []).length;
      passed = passMatches;
      failed = failMatches;
    }
    
    results.push({ phase: suite.phase, file: suite.file, passed, failed, error: null, outputSummary: summaryMatch ? summaryMatch[0] : `Pass: ${passed}, Fail: ${failed}` });
    console.log(`DONE: ${passed} PASSED, ${failed} FAILED`);
    if (failed > 0) {
      console.log('--- OUTPUT SNIPPET ---');
      console.log(output.slice(-1000));
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    results.push({ phase: suite.phase, file: suite.file, passed: 0, failed: 1, error: err.message, output: err.stdout });
  }
}

console.log('\n======================================================');
console.log('FINAL REGRESSION SUMMARY');
console.log('======================================================');
console.table(results.map(r => ({
  Phase: `Phase ${r.phase}`,
  Suite: path.basename(r.file),
  Passed: r.passed,
  Failed: r.failed,
  Status: r.failed === 0 && r.error === null ? 'PASS' : 'FAIL'
})));

const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
console.log(`Total Passed: ${totalPassed}, Total Failed: ${totalFailed}`);
