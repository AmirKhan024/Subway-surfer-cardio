/**
 * KR1 metadata — mirrors production's TEST_METADATA entry shape
 * (src/lib/constants.ts TestMetadata) so the integration copy is 1:1.
 * Category decision: 'mobility' (squat-dominant), but the score surfaces as
 * a separate "Runner Fitness" card and must NOT be averaged into the
 * calibrated Mobility category musculage (SPEC §9.6 conservative default).
 */
export const KR1_METADATA = {
  id: 'KR1',
  name: 'Kriya Runner — Level 1',
  category: 'mobility',
  level: 1,
  icon: '🏃',
  posture: 'standing',
  durationSec: 120, // fixed 20-obstacle course ≈ 90-120s
  description:
    'First-person body-controlled runner: jump the striped hurdles, squat under the beams. The view rises and dips with your body.',
  instructions: [
    'Stand facing the camera with your full body in frame',
    'Squat to slide under the amber beams',
    'Jump to clear the cyan hurdles (or heel-raise in low-impact mode)',
    'Clear as many of the 20 obstacles as you can — 3 lives',
  ],
} as const;

/** Prod integration reminder — the registries a KR1 port must touch:
 *  1. src/types/test.ts            → add 'KR1' to the TestId union
 *  2. src/lib/constants.ts         → TEST_METADATA (this object) + TEST_IDS_BY_CATEGORY
 *  3. src/server/scoring/bands.ts  → bandKR1X / bandKR1Y (from kr1-local.ts)
 *  4. src/server/scoring/compute.ts→ case 'KR1' (MATRIX_70_30, x=cleared, y=cleanFormRate)
 *  5. src/types/raw-data.ts        → RunnerRawData into the union + getTestMaxValues
 *  6. src/lib/game/game-id-map.ts  → GAME_TO_TEST + getCategoryForTestId ('KR' prefix!)
 */
export const KR1_TEST_ID = 'KR1' as const;
