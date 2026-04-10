/**
 * tests/reporter.js
 *
 * Custom Jest reporter that produces a clean, readable summary:
 *  - Each test suite prints a compact table of PASS / FAIL per test name.
 *  - After all suites run, a final block lists every failed test with a
 *    short, readable error message (Prisma / internal stack traces are
 *    stripped so you see just the relevant line).
 */
'use strict';

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';
const BG_RED = '\x1b[41m';

/** Trim a raw Jest error message down to the first meaningful line. */
function trimError(msg = '') {
  // Strip ANSI codes first
  const clean = msg.replace(/\x1b\[[0-9;]*m/g, '');

  // Lines that are definitely noise
  const noisePatterns = [
    /^\s*at\s/,                         // stack trace lines
    /generated\/prisma\/runtime/,       // minified Prisma runtime
    /node_modules\//,                   // node_modules traces
    /^\s*>\s*\d+\s*\|/,                 // Prisma code frame lines ("> 32 | ...")
    /^\s*\d+\s*\|/,                     // code frame lines
    /^\s*\^+\s*$/,                      // pointer carets
    /^\s*~+\s*$/,                       // tilde underlines
    /prisma\.ly\//,                     // Prisma docs links
    /^\s*$/,                            // blank lines (after stripping)
  ];

  const lines = clean.split('\n');
  const useful = lines.filter(l => !noisePatterns.some(re => re.test(l)));

  // Take up to the first 6 useful lines
  const snippet = useful.slice(0, 6).join('\n').trim();

  // If the snippet is still empty, fall back to the raw first line
  return snippet || lines[0].trim();
}

class CleanReporter {
  constructor(_globalConfig, _reporterOptions) {
    this._failures = [];  // { suite, test, error }
    this._passes   = 0;
    this._total    = 0;
    this._suites   = 0;
    this._failedSuites = 0;
    this._startTime = Date.now();
  }

  // Called once per test suite (file)
  onTestFileResult(_test, testResult) {
    const relativePath = testResult.testFilePath
      .replace(/\\/g, '/')
      .replace(/^.*\/tests\//, 'tests/');

    const hasFail = testResult.testResults.some(r => r.status === 'failed');
    const suiteMark = hasFail
      ? `${RED}${BOLD} FAIL ${RESET}`
      : `${GREEN}${BOLD} PASS ${RESET}`;

    this._suites++;
    if (hasFail) this._failedSuites++;

    process.stdout.write(`\n${suiteMark} ${CYAN}${relativePath}${RESET}\n`);

    // Per-test result lines
    for (const r of testResult.testResults) {
      this._total++;
      const indent = '  ';

      if (r.status === 'passed') {
        this._passes++;
        const dur = r.duration != null ? `${DIM}(${r.duration}ms)${RESET}` : '';
        process.stdout.write(
          `${indent}${GREEN}✔${RESET}  ${r.fullName} ${dur}\n`
        );
      } else if (r.status === 'failed') {
        const firstMsg = r.failureMessages?.[0] ?? 'Unknown error';
        const short    = trimError(firstMsg);
        const dur      = r.duration != null ? `${DIM}(${r.duration}ms)${RESET}` : '';
        process.stdout.write(
          `${indent}${RED}✘${RESET}  ${BOLD}${r.fullName}${RESET} ${dur}\n`
        );
        // Print short error inline, indented
        const errorLines = short.split('\n').slice(0, 4);
        for (const line of errorLines) {
          process.stdout.write(`${indent}   ${DIM}${RED}${line}${RESET}\n`);
        }
        this._failures.push({
          suite: relativePath,
          test:  r.fullName,
          error: short,
        });
      } else {
        // skipped / todo / pending
        process.stdout.write(
          `${indent}${YELLOW}○${RESET}  ${DIM}${r.fullName}${RESET}\n`
        );
      }
    }

    // Suite-level errors (e.g. syntax error in the file)
    if (testResult.testExecError) {
      process.stdout.write(
        `  ${RED}Suite error:${RESET} ${trimError(testResult.testExecError.message)}\n`
      );
    }
  }

  // Called after all suites finish
  onRunComplete() {
    const elapsed = ((Date.now() - this._startTime) / 1000).toFixed(1);
    const failed  = this._total - this._passes;

    process.stdout.write('\n' + '─'.repeat(60) + '\n');

    // ── Overall summary ──────────────────────────────────────────
    const suiteLabel = `${this._suites} suite${this._suites !== 1 ? 's' : ''}`;
    const suiteSummary = this._failedSuites > 0
      ? `${RED}${BOLD}${this._failedSuites} failed${RESET}, ${this._suites - this._failedSuites} passed`
      : `${GREEN}${BOLD}all passed${RESET}`;

    const testSummary = failed > 0
      ? `${RED}${BOLD}${failed} failed${RESET}, ${this._passes} passed, ${this._total} total`
      : `${GREEN}${BOLD}${this._passes} passed${RESET}, ${this._total} total`;

    process.stdout.write(`${BOLD}Test Suites:${RESET} ${suiteSummary} (${suiteLabel})\n`);
    process.stdout.write(`${BOLD}Tests:       ${RESET} ${testSummary}\n`);
    process.stdout.write(`${BOLD}Time:        ${RESET} ${elapsed}s\n`);

    // ── Failure detail block ──────────────────────────────────────
    if (this._failures.length > 0) {
      process.stdout.write('\n' + '─'.repeat(60) + '\n');
      process.stdout.write(
        `${BG_RED}${WHITE}${BOLD}  FAILED TESTS (${this._failures.length})  ${RESET}\n\n`
      );

      this._failures.forEach((f, idx) => {
        process.stdout.write(
          `${RED}${BOLD}${idx + 1}.${RESET} ${BOLD}${f.test}${RESET}\n`
        );
        process.stdout.write(`   ${DIM}${f.suite}${RESET}\n`);
        // Print up to 8 error lines
        const errLines = f.error.split('\n').slice(0, 8);
        for (const line of errLines) {
          process.stdout.write(`   ${RED}${line}${RESET}\n`);
        }
        process.stdout.write('\n');
      });
    } else {
      process.stdout.write(`\n${GREEN}${BOLD}✔  All tests passed!${RESET}\n`);
    }

    process.stdout.write('─'.repeat(60) + '\n');
  }
}

module.exports = CleanReporter;
