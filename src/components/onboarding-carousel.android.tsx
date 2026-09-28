import {
  Box,
  Column,
  HorizontalPager,
  type HorizontalPagerHandle,
  Row,
  Spacer,
  useMaterialColors,
} from '@expo/ui/jetpack-compose';
import {
  background,
  clip,
  fillMaxSize,
  fillMaxWidth,
  height,
  padding,
  Shapes,
  size,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import type { SymbolViewProps } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, useWindowDimensions, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Island } from '@/components/island';
import { OnboardingAdvanceButton } from '@/components/onboarding-button';
import { OnboardingHero, type OnboardingHeroShape } from '@/components/onboarding-hero';

export type OnboardingCarouselPage = {
  shape: OnboardingHeroShape;
  symbol: SymbolViewProps['name'];
  headline: string;
  body: string;
  note?: string;
};

// why: past these the hero shrinks so the copy keeps the screen (carousel spec §4).
const COMPACT_FONT_SCALE = 1.5;
const COMPACT_WINDOW_HEIGHT = 700;
const DOT = 8;
const ACTIVE_DOT = 24;

/** The Android welcome step: a user-paced pager whose last page finishes the step. */
export function OnboardingCarousel({
  pages,
  finishLabel,
  onFinish,
}: {
  pages: readonly OnboardingCarouselPage[];
  finishLabel: string;
  onFinish: () => void;
}) {
  const colors = useMaterialColors();
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const pager = useRef<HorizontalPagerHandle>(null);
  const finished = useRef(false);
  const [page, setPage] = useState(0);
  // why two: the dots follow the finger, while the counter and button wait for the settled page so
  // a half-swipe never flips Next to Get started (carousel spec §3.3).
  const [scrollPosition, setScrollPosition] = useState(0);

  const heroSide =
    fontScale >= COMPACT_FONT_SCALE || windowHeight < COMPACT_WINDOW_HEIGHT ? 160 : 260;
  const onLastPage = page === pages.length - 1;
  const counter = (index: number) => `${index + 1} of ${pages.length}`;

  const goTo = (index: number) => {
    void (reduceMotion
      ? pager.current?.scrollToPage(index)
      : pager.current?.animateScrollToPage(index));
  };

  // why: back must page backwards, and on the first page stay put — letting it through would pop
  // the whole onboarding group off the root Stack (carousel spec §3.3).
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page > 0) goTo(page - 1);
      return true;
    });
    return () => subscription.remove();
  });

  return (
    // why offset-6: a button ends the screen, so it clears the gesture bar by 24 dp, not by nothing.
    <View className="flex-1 bg-background pt-safe pb-safe-offset-6">
      <Island>
        <Column modifiers={[fillMaxSize()]}>
          <Row modifiers={[fillMaxWidth(), padding(24, 10, 24, 10)]} horizontalArrangement="end">
            <Island.Text tone="secondary" style={{ typography: 'labelLarge' }}>
              {counter(page)}
            </Island.Text>
          </Row>

          <HorizontalPager
            ref={pager}
            modifiers={[fillMaxWidth(), weight(1)]}
            onPageScroll={(current, offsetFraction) => setScrollPosition(current + offsetFraction)}
            onSettledPageChange={(settled) => {
              if (settled === page) return;
              setPage(settled);
              AccessibilityInfo.announceForAccessibility(counter(settled));
            }}
          >
            {pages.map((p) => (
              <Column
                key={p.headline}
                horizontalAlignment="center"
                modifiers={[fillMaxSize(), verticalScroll(), padding(24, 56, 24, 24)]}
              >
                <OnboardingHero shape={p.shape} symbol={p.symbol} side={heroSide} />
                <Spacer modifiers={[height(48)]} />
                <Island.Text
                  style={{ typography: 'headlineMedium', fontWeight: '500', textAlign: 'center' }}
                >
                  {p.headline}
                </Island.Text>
                <Spacer modifiers={[height(12)]} />
                <Island.Text
                  tone="secondary"
                  style={{ typography: 'bodyLarge', textAlign: 'center' }}
                  modifiers={[padding(16, 0, 16, 0)]}
                >
                  {p.body}
                </Island.Text>
                {p.note ? (
                  <>
                    <Spacer modifiers={[height(20)]} />
                    <Island.Text
                      tone="secondary"
                      style={{ typography: 'bodySmall', textAlign: 'center' }}
                    >
                      {p.note}
                    </Island.Text>
                  </>
                ) : null}
              </Column>
            ))}
          </HorizontalPager>

          <Row
            modifiers={[fillMaxWidth(), padding(24, 16, 24, 0)]}
            horizontalArrangement="spaceBetween"
            verticalAlignment="center"
          >
            <Row horizontalArrangement={{ spacedBy: 8 }} modifiers={[padding(12, 0, 0, 0)]}>
              {pages.map((p, index) => {
                const active = Math.max(0, 1 - Math.abs(scrollPosition - index));
                return (
                  <Box
                    key={p.headline}
                    modifiers={[
                      size(DOT + (ACTIVE_DOT - DOT) * active, DOT),
                      clip(Shapes.Circle),
                      background(active >= 0.5 ? colors.primary : colors.outlineVariant),
                    ]}
                  />
                );
              })}
            </Row>

            <OnboardingAdvanceButton
              finish={onLastPage}
              nextLabel="Next"
              finishLabel={finishLabel}
              reduceMotion={reduceMotion}
              onPress={() => {
                if (!onLastPage) return goTo(page + 1);
                if (finished.current) return;
                finished.current = true;
                onFinish();
              }}
            />
          </Row>
        </Column>
      </Island>
    </View>
  );
}
