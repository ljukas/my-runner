import {
  Box,
  Card,
  Column,
  LinearProgressIndicator,
  Row,
  Text,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  alpha,
  background,
  clickable,
  clip,
  fillMaxSize,
  fillMaxWidth,
  padding,
  Shapes,
  size,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import type { AndroidSymbol, SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { PixelRatio } from 'react-native';

import { ComposeSymbol } from '@/components/compose-symbol';
import { Island } from '@/components/island';
import { useTheme } from '@/hooks/use-theme';

const HERO_SIDE = 48;
const DISABLED_ALPHA = 0.38;

function RunModeCardList({ children }: { children: ReactNode }) {
  const colors = useTheme();
  return (
    <Column
      verticalArrangement={{ spacedBy: 12 }}
      modifiers={[
        fillMaxSize(),
        background(colors.background),
        verticalScroll(),
        padding(16, 8, 16, 24),
      ]}
    >
      {children}
    </Column>
  );
}

/**
 * One way to run, as a Material 3 filled card: the header opens the mode, `action` is a shortcut
 * past it. Only the header is clickable, so TalkBack reads the action as its own button.
 */
function RunModeCardRoot({
  title,
  detail,
  symbol,
  featured = false,
  progress,
  disabled = false,
  onPress,
  action,
}: {
  title: string;
  detail: string;
  symbol: { ios: SFSymbol; android: AndroidSymbol };
  featured?: boolean;
  /** 0–1. */
  progress?: number;
  disabled?: boolean;
  onPress: () => void;
  action?: { label: string; disabled?: boolean; onPress: () => void };
}) {
  const m = useMaterialColors();
  const tone = featured
    ? {
        container: m.primaryContainer,
        content: m.onPrimaryContainer,
        secondary: m.onPrimaryContainer,
        heroShape: Shapes.Material.Cookie6Sided,
        hero: m.primary,
        onHero: m.onPrimary,
        progress: m.primary,
        track: m.surfaceContainerHighest,
      }
    : {
        container: m.surfaceContainerHigh,
        content: m.onSurface,
        secondary: m.onSurfaceVariant,
        heroShape: Shapes.Material.Clover4Leaf,
        hero: m.tertiaryContainer,
        onHero: m.onTertiaryContainer,
        progress: m.secondary,
        track: m.secondaryContainer,
      };
  const heroSide = Math.round(HERO_SIDE * Math.min(PixelRatio.getFontScale(), 1.6));
  const footer = progress !== undefined || action !== undefined;

  return (
    <Card
      colors={{
        containerColor: tone.container,
        contentColor: tone.content,
      }}
      modifiers={[fillMaxWidth()]}
    >
      <Row
        verticalAlignment="center"
        horizontalArrangement={{ spacedBy: 16 }}
        modifiers={[
          fillMaxWidth(),
          ...(disabled ? [alpha(DISABLED_ALPHA)] : [clickable(onPress)]),
          padding(16, 16, 16, footer ? 12 : 16),
        ]}
      >
        <Box
          contentAlignment="center"
          modifiers={[size(heroSide, heroSide), clip(tone.heroShape), background(tone.hero)]}
        >
          <ComposeSymbol name={symbol} size={Math.round(heroSide * 0.5)} tint={tone.onHero} />
        </Box>
        <Column modifiers={[weight(1)]}>
          <Text color={tone.content} style={{ typography: 'titleLarge' }}>
            {title}
          </Text>
          <Text color={tone.secondary} style={{ typography: 'bodyMedium' }}>
            {detail}
          </Text>
        </Column>
        <ComposeSymbol
          name={{ ios: 'chevron.right', android: 'chevron_right' }}
          size={24}
          tint={tone.secondary}
        />
      </Row>
      {footer ? (
        <Column
          verticalArrangement={{ spacedBy: 16 }}
          modifiers={[fillMaxWidth(), padding(16, 0, 16, 16)]}
        >
          {progress === undefined ? null : (
            <LinearProgressIndicator
              progress={progress}
              color={tone.progress}
              trackColor={tone.track}
              modifiers={[fillMaxWidth()]}
            />
          )}
          {action ? (
            <Island.Button
              inline
              fill
              label={action.label}
              disabled={action.disabled}
              onPress={action.onPress}
            />
          ) : null}
        </Column>
      ) : null}
    </Card>
  );
}

export const RunModeCard = Object.assign(RunModeCardRoot, { List: RunModeCardList });
