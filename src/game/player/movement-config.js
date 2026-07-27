/**
 * @file Player movement tuning.
 *
 * Every number that defines how the character *feels* lives here, in one file,
 * with a note on what it does and why it is the value it is. This is
 * deliberate: movement tuning is iterative and collaborative, and numbers
 * scattered through a controller are impossible to reason about as a set.
 *
 * ## The tuning philosophy
 * The character is built around a **readable, committed** jump arc — you commit
 * to a jump and can shape it, but not steer it freely — combined with generous
 * *forgiveness* windows. That combination is what makes a platformer feel
 * simultaneously precise and fair: the rules are strict, but the game gives you
 * the benefit of the doubt on timing.
 *
 * Values are expressed in pixels and seconds, with a 16px tile. A useful frame
 * of reference: the character is 20px tall (1.25 tiles), a standard jump clears
 * 4 tiles, and a dash crosses 6.
 */

/** Gravity is defined here rather than in the physics world so jump maths is local. */
export const GRAVITY = 1500;

export const MovementConfig = Object.freeze({
  // --- body ---
  /** Collider size. Narrower than the visual silhouette, which is the standard
   *  trick for making tight gaps feel passable rather than punishing. */
  width: 11,
  height: 20,
  /** Collider while crouched or sliding. */
  crouchHeight: 12,

  // --- ground movement ---
  /** Top horizontal speed on foot, px/s. ~10 tiles per second. */
  runSpeed: 168,
  /** Acceleration to top speed, px/s^2. Reaching top speed in ~0.11s reads as
   *  responsive without feeling frictionless. */
  groundAccel: 1500,
  /** Deceleration when input is released. Higher than accel so stopping is
   *  crisp; the character should not skate. */
  groundFriction: 2200,
  /** Extra deceleration when turning around, so direction changes are snappy. */
  turnAccel: 2600,

  // --- air movement ---
  /** Air control is deliberately weaker than ground control: full air control
   *  makes jumps trivially correctable and removes all commitment. */
  airAccel: 900,
  airFriction: 420,
  /** Cap on horizontal air speed; slightly above run speed so a dash-jump
   *  preserves some of its momentum. */
  maxAirSpeed: 196,

  // --- jumping ---
  /**
   * Initial upward velocity.
   *
   * The design constraint is "a full jump clears four tiles (64px)", which the
   * level design depends on. The naive ballistic figure `v^2 / 2g` overstates
   * the real apex: semi-implicit Euler integration systematically undershoots
   * the continuous solution by about `v * dt / 2` (~3.9px at 60Hz), so a
   * velocity tuned to hit exactly 64px on paper lands at ~60px in the game and
   * every four-tile gap becomes unjumpable.
   *
   * -462 yields a real apex of ~70px: four tiles cleared with a working margin,
   * while still falling well short of five (80px) so vertical gating stays
   * meaningful.
   */
  jumpVelocity: -462,
  /** Velocity retained when the button is released early. Variable-height jumps
   *  are essential: a fixed-height jump makes precise platforming impossible. */
  jumpCutMultiplier: 0.42,
  /** Below this upward speed, releasing jump has no further effect — prevents
   *  a jump-cut from feeling like the character hit an invisible ceiling. */
  jumpCutThreshold: -90,
  /** Grace period after leaving a ledge during which a jump still works.
   *  ~6 frames. Without this the character feels "slippery" at ledges. */
  coyoteTime: 0.1,
  /** How long a jump press is remembered before landing. ~7 frames. */
  jumpBuffer: 0.12,
  /** Extra gravity while falling, so the arc is floaty up and weighty down.
   *  This asymmetry is the single biggest contributor to a jump feeling good. */
  fallGravityMultiplier: 1.32,
  /** Reduced gravity near the apex, which extends hang time and gives the
   *  player a moment to aim. */
  apexGravityMultiplier: 0.72,
  /** Speed range considered "apex". */
  apexThreshold: 70,
  /** Maximum fall speed. Keeps long drops readable. */
  maxFallSpeed: 560,

  // --- double jump ---
  doubleJumpVelocity: -400,
  /** Horizontal speed granted on the double jump if the player is holding a
   *  direction — makes the second jump feel like an active correction. */
  doubleJumpBoost: 38,

  // --- dash ---
  dashSpeed: 560,
  dashDuration: 0.17,
  dashCooldown: 0.38,
  /** Dashes refresh on landing, so ground chains are limited by cooldown only. */
  dashRefreshOnLand: true,
  /** Frames of invulnerability at the start of a dash. Short: enough to pass
   *  through a projectile you read, not enough to ignore an attack you did not. */
  dashIFrames: 0.09,
  /** Velocity retained when the dash ends, as a fraction of dash speed. */
  dashExitMomentum: 0.42,
  /** Gravity applied during a dash. Zero gives a clean horizontal line, which
   *  is what makes dashes readable as a distinct movement verb. */
  dashGravityScale: 0,

  // --- wall interaction ---
  /** Downward speed while sliding on a wall. */
  wallSlideSpeed: 62,
  /** Slide speed immediately on contact, before friction takes over. */
  wallSlideInitialSpeed: 20,
  /** How long the player can cling without sliding. */
  wallClingTime: 0.45,
  wallJumpVelocityX: 268,
  wallJumpVelocityY: -400,
  /** Time after a wall jump during which horizontal input is ignored. Without
   *  this, holding toward the wall cancels the jump and the player sticks. */
  wallJumpLockout: 0.16,
  /** Grace period for wall jumps after leaving a wall. */
  wallCoyoteTime: 0.1,

  // --- attack ---
  /** Frames: startup, active, recovery. Total 15 frames (0.25s) for the
   *  standard slash — fast enough to feel responsive, long enough to commit. */
  attackStartup: 3,
  attackActive: 5,
  attackRecovery: 7,
  /** Minimum time between attacks, allowing a fluid chain. */
  attackCooldown: 0.06,
  /** Backward recoil when a grounded attack connects with terrain. */
  attackRecoilSpeed: 140,
  attackRecoilTime: 0.1,
  /** Upward velocity granted by a successful downward strike (the "pogo"). */
  pogoVelocity: -370,
  /** Horizontal speed preserved through a pogo. */
  pogoHorizontalRetain: 0.85,
  /** Forward step given by a grounded attack, which makes attacking feel like
   *  it has weight and helps close distance. */
  attackLunge: 42,

  // --- damage response ---
  /** Invulnerability after being hit. Generous, because chip damage in a game
   *  with five hit points is miserable. */
  hurtIFrames: 1.15,
  /** Duration of the knockback state, during which control is removed. */
  hurtDuration: 0.26,
  hurtKnockbackX: 180,
  hurtKnockbackY: -190,

  // --- focus / healing ---
  /** Seconds of channelling to convert ink into one filament of health. */
  focusDuration: 0.85,
  /** Ink cost per filament healed. */
  focusCost: 33,
  /** Movement is completely locked while focusing — the core risk/reward of
   *  healing mid-combat. */
  focusMoveSpeed: 0,

  // --- climbing ---
  climbSpeed: 84,
  climbDownSpeed: 112,

  // --- swimming ---
  swimSpeed: 108,
  swimAccel: 500,
  /** Upward impulse from a swim stroke. */
  swimStroke: -168,
  swimStrokeInterval: 0.34,
  /** Vertical speed cap in fluid. */
  maxSwimSpeed: 150,

  // --- grapple ---
  grappleRange: 132,
  grapplePullSpeed: 420,
  /** Time the line takes to reach a max-range anchor. */
  grappleTravelTime: 0.13,
  /** Speed retained when releasing the line, which allows momentum swings. */
  grappleReleaseBoost: 1.12,

  // --- misc ---
  /** Distance the player can be lifted by a step or slope without slowing. */
  maxStepHeight: 16,
  /** How far the player probes downward to stay glued to slopes. */
  groundSnapDistance: 9,
  /** Ledge-grab probe height, measured from the top of the collider. */
  mantleProbeHeight: 6,
  /** Speed threshold above which running dust and motion trails appear. */
  fastMoveThreshold: 130,
  /** Fall distance (px) beyond which landing produces a heavy impact. */
  hardLandingDistance: 190,
});

/**
 * Derived values, computed once so the controller does not recompute them.
 * Exposed separately from the tuning table so it is obvious which numbers are
 * authored and which are consequences.
 */
/** Simulation step the movement values are tuned against. */
const TUNING_STEP = 1 / 60;

export const DerivedMovement = Object.freeze({
  /**
   * Peak height of a full jump, px, corrected for discrete integration.
   * The `v * dt / 2` term is the systematic undershoot of semi-implicit Euler;
   * without it this number is optimistic by ~4px and misleads level design.
   */
  jumpApexHeight:
    (MovementConfig.jumpVelocity ** 2) / (2 * GRAVITY)
    + (MovementConfig.jumpVelocity * TUNING_STEP) / 2,
  /** Uncorrected ballistic apex, kept for reference. */
  jumpApexHeightIdeal: (MovementConfig.jumpVelocity ** 2) / (2 * GRAVITY),
  /** Time to apex, seconds. */
  timeToApex: -MovementConfig.jumpVelocity / GRAVITY,
  /** Horizontal distance covered by a full-speed jump, px. */
  jumpDistance: MovementConfig.runSpeed * (-MovementConfig.jumpVelocity / GRAVITY) * 2,
  /** Distance covered by a dash, px. */
  dashDistance: MovementConfig.dashSpeed * MovementConfig.dashDuration,
  /** Total attack duration, seconds. */
  attackDuration:
    (MovementConfig.attackStartup + MovementConfig.attackActive + MovementConfig.attackRecovery) / 60,
});
