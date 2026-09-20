import { DarkTheme, DefaultTheme } from 'expo-router';
import type { ColorSchemeName } from 'react-native';

export function navigationTheme(scheme: ColorSchemeName): typeof DefaultTheme {
  return scheme === 'dark' ? DarkTheme : DefaultTheme;
}
