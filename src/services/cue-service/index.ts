export type { CueService } from './port';
// Metro/TypeScript resolve `./adapter` to the platform fork (`adapter.ios.ts`
// today) per ADR 0003. Android's adapter plugs in here later with no caller
// changes.
export { cueService } from './adapter';
