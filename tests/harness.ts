/**
 * The shared test runner.
 *
 * Deliberately tiny: a `test` that records a line and keeps going, and a
 * `report` that prints them and decides the exit code. Node's own runner
 * would do this, but every file here is a top-level-await script run under
 * type stripping against the real sources, and that is the whole point —
 * nothing between the test and the code it is testing.
 */

const results: string[] = [];

export async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push(`  ok   ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

export function report(subject: string) {
  console.log(results.join("\n"));
  if (process.exitCode) {
    console.error(`\n${subject}: failures above.`);
    return;
  }
  console.log(`\nAll ${results.length} ${subject} passed.`);
}
