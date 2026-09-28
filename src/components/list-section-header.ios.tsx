// Never rendered: expo-router bundles every platform's route files into both bundles, so a module
// an Android route imports must still resolve on iOS (ADR 0025).
export function ListSectionHeader(_props: { title: string }) {
  return null;
}
