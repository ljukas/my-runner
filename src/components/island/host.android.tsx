import { Host, type HostProps } from '@expo/ui/jetpack-compose';

// why no seedColor: the Host then themes from the wallpaper, the Android palette by decision (ADR 0025 §4).
export function IslandHost({ style, matchContents, ...props }: HostProps) {
  return (
    <Host
      matchContents={matchContents}
      style={style ?? (matchContents ? undefined : { flex: 1 })}
      {...props}
    />
  );
}
