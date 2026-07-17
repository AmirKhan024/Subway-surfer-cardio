# Kriya Runner — Level 1 UI / UX Doc

**Companion to:** `kriya-runner-L1-SPEC.md`, `kriya-runner-L1-REFERENCE.md`
**Visual source of truth:** the prototype `kriya-runner-fpp-v2.html` — port its look/feel, don't reinvent from zero.

> **🧠 Reminder:** this describes intent and a proven starting look. If you (Claude Code) can make it cleaner or more on-brand using the real Kriya component library and design tokens, do it. Match the live design system over these literal values where they differ.

---

## 1. Two visual registers (important)

The runner has **two distinct visual layers** — don't blend them:

1. **The game world (FPP 3D):** bright, stylized, Subway-Surfers-like — daytime sky, road, city. This is *not* the dark Kriya app chrome. It should feel playful and alive.
2. **The UI chrome (HUD + overlays):** Kriya's **dark glass-morphism** system — translucent dark chips, blur, brand accents. This frames the bright world.

Brand accents used as gameplay signals: **cyan = jump**, **amber = squat**, red = fail/danger, plus Kriya's amber "muscle-glow" for coins/score.

> **🧠 Your call:** exact tokens from the Kriya `kriya-ui-design` system take precedence. The colors below are the prototype's; reconcile with the real palette.

Prototype palette reference: text `#f8fafc`, muted `#cbd5e1`, amber `#f59e0b`, cyan `#06b6d4`, red `#ef4444`, dark base `#020617`.

---

## 2. Screen state machine

```
  START ──play──▶ (keyboard) ─────────────▶ PLAYING ──fail/finish──▶ REPORT
    │                                          ▲                        │
    └──body control──▶ CALIBRATION ──locked───┘                        │
                          │                                             │
                     (STEP BACK loop until full body visible)     ┌─────┴─────┐
                                                                  │ Run again  │
                                                                  │ Dashboard  │
                                                                  └────────────┘
```

States: **START · CALIBRATION · PLAYING · REPORT** (+ transient "STEP BACK / tracking lost" within PLAYING).

---

## 3. Screen: START

- Title "Kriya Runner", subtitle "Level 1 — first-person, one lane. Jump the striped hurdles, squat under the beams. The view rises and dips with your body."
- Two CTAs: **Play with keyboard** (primary), **Body control (camera)** (secondary/ghost).
- **Low-impact mode** checkbox: "heel-raise instead of jump."
- Controls legend: `↑ / Space / W` jump · `↓ / S (hold)` squat.
- Small note that camera control needs local file + camera permission + internet for the pose model.
- Persistent **disclaimer banner** (see §8).

> **🧠 Your call:** if the real app already gates games behind a standard pre-game flow (BasicInfo, instructions, calibration overlay from Kriya V3), reuse that instead of a bespoke start screen — but keep the low-impact toggle and disclaimer.

---

## 4. Screen: CALIBRATION (body-control only)

- Heading "Stand back"; instruction "Get your full body in frame — head to feet. Hold still."
- Circular progress ring filling 0→100% as stable full-body frames accumulate (~1.5s).
- Dynamic hint line: "Get your whole body in frame." ↔ "Hold still…".
- On success → auto-start PLAYING.
- Back button cancels camera and returns to START.

---

## 5. Screen: PLAYING — HUD

Layout (all HUD elements are dark glass chips floating over the bright world):

**Top-left chips:** `Dist ⟨n⟩m` · `Coins ⟨n⟩` (amber) · `Ctrl ⟨Keys|Body⟩`.

**Center-top cue (the key gameplay UI):**
- Large rounded icon (`↑` jump / `↓` squat) bordered in the action color (cyan/amber).
- Label under it: **JUMP** / **SQUAT**.
- **Timing bar** beneath, filling 0→100% as the obstacle closes to the action point — the fill hitting full = act now.
- Appears when the nearest unresolved obstacle is within the cue window (~1.5–2s out); hidden otherwise.

**Top-right PiP (body-control only):**
- ~88×118px raw camera thumbnail (mirrored) with a faint cyan skeleton drawn on it.
- Bottom label: **TRACKING** (cyan) → flips to **STEP BACK** (red) when landmarks drop below confidence. This is the tracking-awareness safeguard — do not omit it.

**Bottom:** persistent disclaimer banner.

> **🧠 Your call:** cue presentation is the most important UX element — if a different cue (e.g. a floor marker rushing toward the player, or a countdown ring) trains timing better than the icon+bar, prototype it. Keep the "learn timing, not just reaction" principle.

---

## 6. The FPP world (visual spec)

Port from `kriya-runner-fpp-v2.html`. Elements, all procedural/CC0:

- **Sky:** bright gradient (blue→pale horizon) + soft sun + slow drifting clouds. **Fog** matched to the horizon color so distance melts away (also a perf win).
- **Ground:** scrolling road texture with lane lines + center dashes; curbs + sidewalks either side; green verge beyond.
- **City corridor:** varied building boxes with lit/unlit window textures + rooftops, sliding past and recycling; a faint distant skyline silhouette in the fog for depth.
- **Roadside life:** low-poly trees (stacked cones), street lamps with glowing bulbs, bushes — recycled like buildings. This is the biggest "real place" upgrade.
- **Obstacles (action-legible):** jump hurdle = **cyan/white hazard stripes** on the ground; squat beam = **amber/black construction stripes** overhead with a gap beneath. Player reads the required action at a glance.
- **Coins:** spinning gold rings with a soft glow (optional in L1).
- **Feel extras:** subtle vignette; slight FOV widening as speed rises.

**The CC0-model seam:** keep art creation behind small factory functions (`makeTree()`, `makeLamp()`, `spawnObstacle()`, etc.) so a real Kenney/Quaternius/KayKit GLTF can later replace the procedural mesh **without touching spawn/recycle/collision logic**. Add `GLTFLoader` with a graceful fallback (real model if it loads, procedural if not) when Govind wants richer art.

> **🧠 Your call:** you may restyle the world to be more distinctly "Kriya" (e.g. a wellness-park or clean-city theme) as long as it stays bright, readable, and the obstacle action-coding remains instantly legible.

---

## 7. Camera feel (the "mirror")

- Camera Y driven **continuously** from detected hip height (dip on squat, rise on jump) — see SPEC §5.3.
- Damped (EMA) so it never jitters or induces motion sickness; keep amplitude modest.
- Slight downward pitch when squatting for a natural crouch feel.
- Expose a **sensitivity / off** setting for bob amplitude (accessibility + comfort).

---

## 8. Safety & accessibility UI (keep intact)

- **Disclaimer banner** always visible during setup/play: "⚠️ Avoid if you have active pain. Consult a physician first."
- **Low-impact toggle** on START (heel-raise variant).
- **STEP BACK** tracking state so a lost-tracking moment never looks like a broken game.
- Friendly, age-appropriate copy; no engagement dark patterns; no pressure to keep playing after a run ends.
- Respect reduced-motion preferences if the platform exposes them (dampen bob/FOV/vignette).

---

## 9. Screen: REPORT (must align with the Kriya report system)

On run end, submit via `submitScore('KR1', rawData)` and navigate to the standard report route using **`sessionId`** (not `reportId` — see REFERENCE §4). The report should present the same shape as other Kriya game reports so it feels native:

**Hero:** the run's **musculage** and **conditioned score** for KR1, with **`deltaPct`** vs previous attempt and a **personal-best** flag when earned.

**Category context:** show it under **Mobility** (primary), per the category decision — but respect the §9.6 weighting choice (its own "Runner Fitness" card vs updating the calibrated Mobility musculage).

**Breakdown (from `RunnerRawData`):**
- Distance, obstacles cleared / total.
- Squats (with avg depth), Jumps (with avg height) — these are the assessment-facing numbers: *squat depth → mobility, jump power → strength, timing → reflex.*
- Clean-form rate; avg reaction time.

**Engagement:** streak update + a "Run again" CTA and a link to the dashboard.

Prototype's end-card already previews this (Coins / Squats / Jumps stat row + the "squat depth → mobility · jump power → strength · timing → reflex" line) — evolve it into the real Kriya report layout with charts (`recharts`, already in the project) for trend.

> **🧠 Your call:** match the existing Kriya report component/layout exactly so KR1 doesn't look like a bolt-on. If the standard report already renders musculage/delta/breakdown/trend generically from a session, you may need little custom UI — reuse it.

---

## 10. Component → file mapping (suggested)

| UI piece | Suggested location |
|---|---|
| FPP scene + world | `src/components/games/runner/RunnerScene.ts` |
| HUD (chips, cue, PiP) | `src/components/games/runner/RunnerHUD.tsx` |
| Cue (icon + timing bar) | subcomponent of RunnerHUD |
| Tracking PiP | subcomponent of RunnerHUD |
| Start / calibration overlays | reuse Kriya V3 pre-game flow if present, else local |
| Report | reuse the standard Kriya report route/components |
| Tunables (colors, spacing, thresholds) | `src/components/games/runner/runner-constants.ts` |

> **🧠 Your call:** conform to the repo's actual game-component conventions. This table is a hint, not a rule.

---

## 11. Motion & polish checklist

- Cue fades in/out smoothly (~120ms), never pops.
- Hip-bob damped; FOV eases; vignette subtle.
- Coins spin + glow; obstacle hazard stripes crisp and readable at distance.
- Fog hides spawn/recycle so nothing "pops" into existence.
- 60fps render maintained on a mid-range phone (cut scene complexity before inference).

> **🧠 Final UI note:** the goal is *fun that happens to be exercise*, framed in Kriya's clinical credibility. If a polish choice increases delight/retention without hurting clarity, safety, or performance — take it, and note it for Govind.
