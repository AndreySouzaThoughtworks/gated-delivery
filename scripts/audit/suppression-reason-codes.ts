export const ASSERTION_DENSITY_REASON_CODE_MEANINGS = {
  "entry-point": "CLI main or run",
  "multi-caller-helper": "shared helper whose contract is asserted at its callers",
  "exported-and-tested": "exported function proven by tests with no second invariant",
  "io-wrapper": "spawn or fs wrapper whose one postcondition is asserted",
  "recursive-walker": "recursive walk over a tree",
  "thin-wrapper": "wrapper that adds nothing to assert beyond what it calls",
  "limit-bound": "inlining or merging would breach a zanity structure limit: long-function, complex-function or deep-nesting",
  "single-invariant": "exactly one real assertion; a second would only restate it",
  "no-invariant": "zero honest assertions; nothing can be asserted that a bug could break",
};
