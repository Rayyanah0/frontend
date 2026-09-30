/**
 * Performance harness library.
 *
 * Import the pieces you need — tree-shaken in production builds.
 * The harness page (`src/app/__perf/`) is excluded from production bundles
 * by next.config.js, so this library is only ever loaded in dev/perf builds.
 */

export * from "./metrics";
export * from "./longTasks";
export * from "./tickScripts";
export { ProfilerWrapper } from "./ProfilerWrapper";
