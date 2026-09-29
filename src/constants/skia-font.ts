import { Platform } from 'react-native';

// why named per platform: Skia's default family name is iOS's; Android's font manager matches
// nothing for it, and every `matchFont` text paints blank there.
export const SKIA_FONT_FAMILY = Platform.select({ android: 'sans-serif', default: 'System' });
