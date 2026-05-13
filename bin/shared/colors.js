#!/usr/bin/env node
export const c = {
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  blue:   (s) => `\x1b[34m${s}\x1b[0m`,
  dim:    (s) => `\x1b[90m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  magenta:(s) => `\x1b[35m${s}\x1b[0m`,
}

export const log = {
  section: (title) => console.log(`\n${c.bold(title)}`),
  created: (file)  => console.log(`  ${c.green("+ created ")} ${file}`),
  appended:(file)  => console.log(`  ${c.blue("~ appended")} ${file}`),
  skipped: (file)  => console.log(`  ${c.dim("· skipped ")} ${file}`),
  warn:    (msg)   => console.log(`  ${c.yellow("⚠ " + msg)}`),
  ok:      (msg)   => console.log(`  ${c.green("✓")} ${msg}`),
  fail:    (msg)   => console.log(`  ${c.red("✗")} ${msg}`),
  info:    (msg)   => console.log(`  ${c.dim(msg)}`),
}
