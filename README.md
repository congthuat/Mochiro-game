# Surf Studio Games — Mochiro & Aetherfall

Two complete, playable 3D games inside one browser app, built on the Surf Studio stack
(Vite + React + Express + Postgres + Three.js). Every asset — terrain, characters, coin art,
effects, music and sound — is generated procedurally at runtime or resolved live from the Surf
project catalog, so the games ship with no external art/audio dependencies.

The hub opens on **Mochiro** (endless runner); the main menu links to **Aetherfall**
(3D action-adventure) and back.

---

# 1. Mochiro — endless runner

Run, jump and slide down an endless sunlit track. Instead of coins you collect the **Arc project
icon** — the real logo of [Arc](https://www.arc.network/), Circle's Layer-1 for stablecoin
finance — resolved live from the Surf project catalog and minted onto spinning gold coins.

## Play

Open the preview, press **Start Sprint**.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Switch lane | `A` / `D` or `←` / `→` | swipe left / right, or ◀ ▶ buttons |
| Jump | `Space`, `W`, `↑` | swipe up, tap anywhere, or JUMP |
| Slide (duck under bars) | `S` / `↓` | swipe down or SLIDE |
| Pause | `Esc` / `P` | HUD pause button |

**Pick your runner:** the menu offers two cel-shaded chibi heroes — **Kai** ("Blue Comet", spiky
blue hair, star jacket, backpack) and **Mika** ("Pink Spark", ponytail, bow, satchel, pleated
skirt). Switching swaps the whole rig instantly, hair physics included.

## Pickup feedback

Collecting is the core reward loop, so it answers back on three layers at once — the world, the
camera and the HUD. The rule of thumb: **a coin is never deleted, it is banked**, and **a power-up
is never a big coin**.

| Layer | Coin | Power-up |
|---|---|---|
| Particles | 7–16 gold sparks, count and speed scale with the streak | 22 sparks in the power's colour, fountain rise |
| Shockwave | one tight ring (0.8–1.35 m) | two rings: a wide colour blast plus a fast white snap |
| Banked ghost | a coin sprite pops, swells, then flies into the HUD counter and shrinks away | — |
| Camera | 0.32° FOV kick | 3.4° FOV punch + 0.5 shake |
| Time | — | **0.09 s hit-stop**: the world drops to 12 % speed while FX and camera keep running |
| Audio | the coin ladder climbs with the combo | rising four-note arpeggio |
| HUD | counter scale-punch + gold flash, a `+N` float rises off it (bigger and orange when the multiplier steps up) | a `MAGNET ONLINE` / `SHIELD UP` / `OVERDRIVE` banner slams in and a colour vignette flashes the screen edges |

Everything is pooled (`ShockRings`, `FlyCoins`, `SparkSystem`) so a five-coin-per-second streak costs
no allocations, and `prefers-reduced-motion` collapses the HUD animations.

## Loop & rules

1. Speed ramps from 15 to 42 units/s (≈54 → 150 km/h) over ~2.5 minutes; the HUD names each tier
   (Warm-up → Overclock → Surge → Hyperdrive → Terminal Velocity).
2. Obstacles: **low barriers** (jump), **overhead bars** (slide), **tall blockers** (change lane),
   plus city traffic — **cars you can land on and run along the roof**, **buses** that must be
   dodged, **launch ramps** that throw the runner into the air, and **gateways** that have to
   be slid under. Pattern difficulty scales with speed: single barriers first, then doubles,
   slaloms, gauntlets, traffic jams, ramp-onto-roof combos and low gateway gates.
3. **Coins** build a combo: +1 multiplier every 8 coins (up to ×8), collecting a whole line pays a
   perfect-line bonus. Multiplier applies to coin points *and* distance points.
4. **Power-ups** come in two flavours, and the icon tells you which before you touch it. Boons
   (≈78 % of spawns) carry a smooth halo: **shield** (absorbs one hit), **magnet** (8 s of coin
   pull), **overdrive** (invulnerable boost that smashes obstacles for points), **double** (every
   coin pays twice) and **phase** (cars and barriers pass straight through the runner). Hazards
   (≈22 %, never in the first 22 s) wear a **spiked red collar**: **controls jammed** (left/right
   are mirrored), **smoke screen** (the view hazes over) and **heavy load** (the jump is cut to
   60 %, so low barriers stop being clearable).
5. One hit ends the sprint — unless a shield is up. Every finished sprint is submitted to the
   global board with score, coins, distance, top speed and best combo.

## Arc branding pipeline

The coin and the trackside billboards carry the **real project mark**, not a redrawn stand-in:

1. `GET /api/arc/project` resolves the project card (name, tags, website, logo URL) from the Surf
   project catalog, cached for ten minutes.
2. `GET /api/arc/logo` re-serves the artwork from our own origin. The catalog logo is a JPEG with
   an opaque plate, and reading its pixels requires a same-origin image — the proxy is what makes
   the canvas untainted.
3. `loadArcMark()` cuts the mark out of that plate on a canvas: Otsu's method splits the artwork,
   a flood fill from the border removes everything connected to the edge (so gradients and vignettes
   in the artwork survive), enclosed shapes are kept, and the mark is minted in white with an
   anti-aliased alpha ramp. A tight bounding box comes back with it, so the mark can be centred and
   scaled on any surface.
4. `buildCoinTexture()` strikes the coin: a reeded gold rim, a bevelled navy field lit from the
   upper left, the mark centred with a soft shadow and a cyan halo, and a specular sheen across the
   face. `buildWordmarkTexture()` prints the billboard panel: navy board with a gold frame, the mark
   on the left, the wordmark, the project's first tag and its website.
5. If the catalog is unreachable the game falls back to a vector arch emblem, so it is never
   unbranded.

1. `GET /api/arc/project` resolves the Arc project through the Surf data API
   (`project/detail` with a `search/project` fallback) and caches the card for 10 minutes.
2. `GET /api/arc/logo` proxies the catalog logo image through our own origin, so the browser can
   upload it to a WebGL texture without cross-origin tainting.
3. The client composes the coin face on a canvas (halo ring, inner disc, project logo, gloss and
   rim light) and uses it as the emissive map of a spinning coin mesh; billboards along the track
   carry the project wordmark.
4. If the catalog is unreachable the game still runs — it falls back to a hand-drawn Arc emblem
   and a "degraded" flag instead of failing.

The menu also shows the live project description, tags and follower count from the same card.

---

# 2. Aetherfall — Guardian of the Shards

A complete 3D action-adventure: five shattered sky isles, one guardian, a shadow host to cleanse
and a final boss in the Sky Citadel.

### Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Move | `W A S D` / arrows | virtual stick (bottom-left) |
| Camera | drag anywhere · wheel to zoom | drag the right half of the screen |
| Jump (air jumps with Sky Step) | `Space` | JUMP button |
| Pulse blast | left click, `J` / `K` / `F` | PULSE button |
| Dash (i-frames) | `Q` / `E` / right click | DASH button |
| Sprint | `Shift` (hold) | SPRINT toggle |
| Pause | `Esc` | HUD pause button |

### Loop

1. Collect every **aether shard** (marked by light beams) and cleanse every **shadow hostile**.
2. The beacon opens — step into the portal.
3. Pick one of three upgrades, then descend into the next zone. Difficulty, enemy types and enemy
   statistics scale up each zone.
4. Defeat the **Shadow Colossus** in the Sky Citadel (zone 5) for victory.

Enemies: **wisps** chase and ram, **sentries** keep their distance and fire homing bolts, **brutes**
wind up and charge. The boss has three phases with telegraphed ground slams, minion summons and
radial volleys. Score = shards × 100 + hostiles defeated + zone clear bonus + remaining health
bonus; runs are submitted to the global leaderboard when they end.

---

## Characters

Every hero shares the same animation set but carries a signature
ability of their own, so the choice is looks *and* gameplay — and it is made on a
**live 3D line-up** on the menu, not from a list of names. The stage is its own little
scene: all six stand on a lit floor,
breathe through the idle clip, and the one you click steps forward with a glowing
ring under their feet (raycast picking, so you click the character itself).

| Hero | Rig | Look |
|---|---|---|
| **Sam** — Armoured Ace | `knight.glb` | blue plate + **blue cape** · *starts with a shield* |
| **Bobbilee** — Arc Sorceress | `mage.glb` | pale robe, **magenta cape and hat** · *helpful power-ups +25%* |
| **Teddyz** — Thunder Bruiser | `barbarian.glb` | **red hide, bare back, no cape** · *immune to harmful effects* |
| **Lecter** — Night Blade | `rogue.glb` | bare-headed, **dark violet, no cape**, two knives · *changes lane 35% faster* |
| **Mike** — Marksman | `rogue_hooded.glb` | hooded green ranger, **no cape**, the rig's arbalest in hand · *magnet reaches 45% further* |
| **Tim** — Blade Duelist | `knight.glb` | **gold plate, no cape, no shield**, the greatsword and nothing else · *Overdrive lasts twice as long* |

The heroes face the player on the stage (the rigs look down −z for gameplay, so
the stage adds half a turn), and the line-up is built to be told apart at a
glance: one blue, one pink, one brown, one violet, one green with kit.

Two things make the roster read that way:

- **Costume palette swap** (`recolor.ts`). Each KayKit hero is one texture atlas.
  Rather than shipping a second copy of the file, the atlas is repainted on the
  client: only pixels whose hue falls inside a window change, so skin, leather and
  metal stay exactly as painted while the fabric band takes a new hue. That is how
  the hooded rig — green out of the box — became the violet Night Blade. The
  repaint happens on the clone with its own material instance, so the cached
  original is never disturbed.
- **Extra kit** (`gear.ts`). The rig exposes `handslot.l/r` and `chest`. The bow
  goes in the off hand — the same slot every other class in this pack uses for its
  weapon, which is what makes the archer read as an archer at a glance — and the
  quiver rides the back. Both are parented through a holder node solved as a
  matrix, so the kit ends up axis-aligned with the character and sized in world
  metres no matter what the rig's bones do: this rig keeps its joints in a
  compressed space (the skin's inverse bind matrices put the mesh back to size), so
  the kit is placed against the *body*, measured from the bone, not against the
  bone itself.
- **Class, not costume** (`hideNodes`). The two rogue rigs ship with the same
  baked-in kit — a knife *and* two crossbows — which made the assassin and the
  archer look like the same character. Two changes separate them: the rigs are
  swapped so the **hooded** body belongs to the archer (hood + bow is the ranger
  silhouette) and the bare-headed one to the knife-fighter, and the archer retires
  the melee kit entirely (`hideNodes: ['Knife', 'Crossbow']`, matched by substring
  so one entry covers the family) while the assassin keeps his knives. The assassin
  needs the mirror-image treatment (`hideNodes: ['Crossbow']`): the rogue rig ships a
  one- and a two-handed crossbow out at arm's length, and with them on he read as a
  second archer. `scripts/kit-check.ts` asserts both kits straight from the model
  files, so a future rig swap cannot quietly hand the knives back to the archer. The studio
  portraits confirm it: Lecter's head region is 30% skin/hair and 0% costume colour,
  Mike's is 66% hood.
- **Six backs, not one.** Every rig in this pack ships the *same* teal cape, so from
  the gameplay camera — which sits behind the runner — the whole roster read as five
  copies of one character. Two heroes keep a cape and four do not: Sam's whole suit
  is repainted to blue plate (the palette swap learned a `grey` band, because steel
  and hide carry no hue for a hue window to catch), Bobbilee's cape and hat go
  magenta, Teddyz loses his cape and takes a red wash, and both rogues lose theirs —
  the assassin reads as dark violet leather, the archer as a green hood over an
  arbalest, and the duelist as gold plate with no cloak at all.
  `scripts/kit-check.ts` decodes the atlases, replays the palette swaps and fails if
  any two heroes end up looking alike from behind.
- **Two heroes can share a rig.** Tim is a second knight, so the rig file is loaded
  once and cloned twice. `SkeletonUtils.clone` shares material *instances*, so the
  clone now always takes its own material before anything is written to it — a
  palette swap or a metalness tweak applied in place would otherwise repaint
  whichever hero happened to be built last, and the bug would only ever show up on
  the menu stage, where both of them stand side by side.
- **No near-white surfaces.** The palette swap caps lightness at 0.8. A highlight that
  reaches white streaks past the camera as a glitch stripe — the same artefact that
  the track art already guards against.
- **Slung, not held.** The bow first shipped in the off hand, stabilised against the
  arm swing by re-placing it in world terms every frame. It looked right from the
  front and wrong from behind: on this rig the hand hangs at hip height, so a 1.1 m
  bow held there puts its upper limb *through* the hood — the gameplay camera sits
  behind the runner, so that is the view that matters. The bow now rides the chest
  bone on the back, canted 66° across the spine, with the quiver on the opposite
  diagonal. The arms swing free, the bow never tumbles, and from behind you read a
  ranger rather than a green blob with a stick through its head.

### Abilities

Picking a hero is a gameplay choice, not just a costume: each one carries a single
signature ability, shown on their card in the menu.

| Hero | Ability | How it is wired |
|---|---|---|
| Sam | Starts with a shield up | `run.shield = 1` when the sprint begins |
| Bobbilee | Helpful power-ups last +25% | beneficial durations × 1.25 (hazards keep their full bite) |
| Teddyz | Immune to harmful effects | a collected hazard is shrugged off — `powerTakesHold()` in `config.ts` |
| Lecter | Changes lane 35% faster | lane tween rate × 1.35 |
| Mike | Magnet reaches 45% further | magnet radius 7.6 m → 11.0 m |
| Tim | Overdrive lasts twice as long | Overdrive's 3.4 s → 6.8 s (only Overdrive; every other reward keeps its own length) |

The multipliers live next to the character in `config.ts` and are read through
`Runner.perkScale`, so the tunables stay in one place. The debug snapshot reports
the *effective* values (`perk.jumpVelocity`, `perk.laneRate`, `perk.magnetRadius`,
`perk.powerScale`, `perk.shieldAtStart`, `perk.boostScale`), which is what the browser check asserts
against — a perk that is not wired into the sim fails the check.

Teddyz's ward is the one perk that is a rule rather than a multiplier, so it is a
pure function instead — `powerTakesHold(perk, harmful)`. `takePower()` asks it
*before* applying anything, and every effect lives in a single `applyPower()` that
the QA seam also goes through, so a granted hazard measures what the game would
really do with it. A warded hazard still lands, still flashes and still raises a
banner — the banner just reads **WARDED** instead of naming the hazard.
`scripts/perk-check.ts` proves the split without a browser: one hero is warded,
the other four still take all three hazards, and everyone keeps every reward.

The menu stage preloads every rig, so switching hero in the game is instant
(the models are cached by URL and shared with the runner).

## Character models

Both runners are rigged glTF characters from **KayKit — Adventurers Character Pack (1.0)** by
**Kay Lousberg**, released under **CC0 1.0** (public domain — free for personal, educational and
commercial use; crediting the author is appreciated but not required).

| | |
|---|---|
| Source | https://kaylousberg.itch.io/kaykit-adventurers (mirrored in the `KayKit-Game-Assets` GitHub org) |
| Rigs | Kai → Knight, Mika → Mage — 41-joint humanoid, 6 skinned parts, ~6k triangles, one 1024² texture |
| Pipeline | `frontend/scripts/build-models.ts` strips the 76 shipped clips down to the ten the runner needs, drops the constant "scale = 1" tracks and disposes the orphaned samplers, accessors and buffer views |
| Result | 3.5 MB → **~0.55 MB per character** (mesh 0.31 MB, animation 0.09 MB, JSON 0.2 MB) |

Animation states, all crossfaded: `Idle` (menu) → `Running_A` (playback rate follows the run
speed) → `Jump_Start` → `Jump_Idle` (airborne) → `Jump_Land` (touchdown) → `Dodge_Forward`
(slide) → `Death_A` (crash). Models are normalised on load (height 1.74 m, feet on the track,
yawed so the character looks down -z, the direction of travel — verified by comparing the rendered
face-pixel count at both yaws) and warmed in a cache so switching heroes is instant.

Add another hero by dropping a KayKit GLB in `/tmp/kk_<name>.glb`, running
`bun run scripts/build-models.ts` and pointing a `CharacterSpec.model` at the new asset.

---

# 3. Technology & references

| Layer | Choice | Why |
| --- | --- | --- |
| Renderer | [three.js](https://threejs.org) r187 (MIT) | Battle-tested WebGL2 renderer, PBR materials, instancing, shadow maps |
| Post FX | `three/examples/jsm` EffectComposer + UnrealBloom + OutputPass (MIT) | Emissive bloom for coins, neon rails, portals and particles |
| UI | React 19 + Tailwind 4 (MIT) | Menu/HUD layer, decoupled from the render loop |
| Backend | Express + `@surf-ai/sdk` (Postgres via `dbQuery`) | Leaderboards, player progression, Arc project branding |
| Audio | WebAudio synthesis (no samples) | Original synthwave score + SFX, zero licensing risk |
| Physics | Custom controllers (runner lanes + character controller) | Stable, fast, no extra dependency |

**Design references** (principles studied, nothing copied): Subway Surfers / Temple Run (lane
readability, jump/slide timing, coin lines), synthwave poster art (palette), Breath of the Wild /
Genshin Impact (exploration pacing, beacon landmarks), Minecraft (readable low-poly silhouettes),
Fall Guys (telegraphed hazards).

---

# 4. Architecture

```
frontend/src/App.tsx              hub: switches between the two games
frontend/src/apps/RushApp.tsx     Mochiro shell (HUD, screens, persistence, run flow)
frontend/src/apps/AetherfallApp.tsx  Aetherfall shell

frontend/src/runner/              Mochiro runtime (framework-free)
  Runner.ts                       orchestrator: loop, speed ramp, spawning, collisions, scoring
  config.ts                       lanes, physics, spawn cadence, scoring, quality presets
  track.ts                        scrolling road, lane dashes, rails, gate arches, pylons
  scenery.ts                      sky dome, stars, Arc ring, neon skyline chunks, billboards
  player.ts                       chibi character rig (two heroes) with full pose set
  obstacles.ts                    pooled barriers, blockers and overhead bars
  pickups.ts                      Arc coins + power-ups (with magnet attraction)
  effects.ts                      particle sparks + speed streaks
  arc.ts                          Arc project card + coin/wordmark texture baking
  textures.ts                     procedural canvas textures (road, hazard, beam, sky, glow)
  audio.ts                        synthwave sequencer + 14 synthesised effects
  input.ts                        keyboard, swipe and on-screen button input with buffering

frontend/src/components/runner/   HUD, touch pad, menu/pause/result/settings/help/board screens
frontend/src/lib/runnerApi.ts     runner profile + leaderboard client

frontend/src/game/                Aetherfall runtime (see section 2)
frontend/src/components/game/     Aetherfall HUD + screens

backend/routes/arc.js             Arc project card + logo proxy
backend/routes/runner.js          Mochiro leaderboard + profile
backend/routes/leaderboard.js     Aetherfall leaderboard
backend/routes/profile.js         Aetherfall profile
backend/db/schema.js              players · runs · runner_profiles · runner_runs
```

The render loops never touch React. Each game emits typed events (`phase`, `hud`, `toast`,
`result`, `damage`, `power`, `brand`, `pauseKey`) and the UI subscribes; HUD updates are throttled
to ~12 Hz and gameplay logic is fully decoupled from rendering.

### Graphics features (Mochiro)

- **Daylight scene**: baked sky dome (zenith → horizon gradient, three mountain ranges with
  atmospheric perspective, sun disc and halo, drifting cloud puffs), a warm directional sun with
  soft shadow maps that follow the runner, sky/ground bounce light and a light-blue haze.
- **A street, not a ribbon**: the track has a road with lane dashes, kerbs and cone markers, plus a
  raised **pavement** with kerb stones, paving joints, lamp posts, benches, street signs, fences,
  hedges and flower beds — all recycled in chunks.
- **Detailed houses**: every building is generated from a plinth, wall block, floor bands and an
  overhanging roof (gable / hip / flat with parapet), then punched with framed windows, glass,
  mullions, sills and shutters, a recessed door with a brass handle, step and canopy, a chimney,
  and sometimes a balcony railing or a shopfront with a striped awning and a hanging sign.
  Each prototype is merged into one vertex-coloured geometry and drawn as an `InstancedMesh`.
- Rolling hills, layered trees (deciduous / conifer / bushes), a pastel skyline with window bands,
  drifting hot-air balloons and branded billboards carrying the Arc wordmark.
- **Rigged character models**: two hand-animated KayKit adventurers (see *Character models*
  below) driven by an `AnimationMixer` state machine — every transition is a crossfade, so the
  runner blends from idle into the run cycle, through the jump, into a dodge-roll slide, and into
  the death clip instead of popping between poses. The run cycle's playback rate tracks the game
  speed, and the body leans and yaws into lane changes. One-shot clips (jump start, landing,
  dodge) hand control back to the run cycle the moment they play out — the landing clip's own
  clock and the mixer's `finished` event both feed that hand-off, so the legs can never freeze
  mid-landing. The landing is also time-scaled with the run speed and hands over at the halfway
  point, so it reads as a quick squash instead of a pause; and on a long flight (a ramp launch)
  the run cycle takes over mid-air rather than holding a static jump pose.
- **Procedural fallback rig** (used if a model cannot be loaded): cel-shaded chibi built from
  `MeshToonMaterial` with a banded ramp plus an inverted-hull outline on every part, a 2048×1024
  painted face and tapered strand hair.
- Gold Arc coins: the project icon is composited onto a minted gold disc with a gloss pass and used
  as an emissive map, so the mark catches the light as the coin spins.
- Pooled particle sparks (collect, land, slide, shield, smash, crash) and a **ground rush** that
  only appears past ~60 % of top speed; camera FOV punch, roll and impact shake. The rush is a set
  of soft tapered dashes lying flat on the tarmac that swell and fly past the camera — it lives on
  the road surface, so it always reads as motion. (Earlier revisions used billboarded bars beside
  the camera, which the eye reads as a rendering fault once they stretch across the frame.) The
  effect's intensity follows the *actual* speed, so overdrive drives it to full tilt.
- **A slide has to look like a slide.** The KayKit rigs ship ten clips and not one of them ducks:
  measured through `Dodge_Forward`, the clip the state machine used to reach for, the head drops
  0.10 m while the run cycle itself bounces 0.16 m — so a sliding runner read as *taller* than a
  running one while the collision box shrank from 1.70 m to 0.86 m. The slide is therefore a body
  transform on top of a clip, and both halves had to be measured.
  - **The clip.** `Dodge_Forward` looks like the obvious choice, but its pose already curls the body
    31° forward, so tipping it 89° only brings the torso to 25° above the road: the runner looks
    like they are sitting up, legs tucked under them. `SLIDE_CLIP` is `Idle` — a straight, upright
    pose — which tipped 89° gives a body **1° off horizontal**, chest to the sky, feet leading.
    `scripts/slide-pose.ts --clips` compares them.
  - **Nothing is squashed.** Compressing the model along its own length makes the runner *stubbier*
    rather than lower — "bẹp dí" — so `SLIDE_SQUASH` stays at 1 and the check fails if it is ever
    lowered again. The tip does all of the work.
  - **The lift is what puts the body *on* the road rather than in it.** The chibi head is 0.81 m
    across on a 1.74 m runner, so a body lying flat is only 0.72–0.78 m tall once it is down.
    `scripts/slide-pose.ts` measures the **skinned mesh**, not the bones — the head and torso are
    far bigger than the joints inside them — names the mesh that owns the highest vertex, and holds
    the skeleton between 0.05 m and 0.40 m so the runner can neither float nor be buried.
  - **And the pose has to be *looked at*, not just measured.** A pose can measure
    perfectly and still read as a blob, because the chase camera sits behind the runner:
    a body lying along the view axis is foreshortened almost to nothing, and the chibi
    head — the biggest part, and the nearest to the camera — covers the rest. At the
    first working lift the sliding silhouette was four rows against the standing five:
    the runner did not look any lower. `scripts/slide-pose.ts --view` projects the real
    skinned body through the real game camera and prints the silhouette, which is how
    that was caught. The lift was then raised to the most the collision budget allows,
    which brings the figure down to **three rows** — a visibly squatter, wider shape.
  - **The model does not own the runner's height.** The Runner writes `run.y` into
    `root.position.y` every frame, immediately before the avatar updates, so the slide
    *adds* its lift rather than assigning it. Assigning pins the avatar to the road and
    no jump, hop or ramp launch ever leaves the ground again — and the jump check still
    passed, because it measured the physics (`run.y`) and not the model. The snapshot
    now carries `avatarY`, and the browser check asserts the height that is *drawn*.
  Every rig ends up **1° off horizontal**, top 0.87–0.93 m against a 0.98 m budget, feet
  leading, and the body resting on the road.
- **The box you see is the box that kills you.** Every obstacle's collision volume is measured
  against its mesh by `scripts/obstacle-fit.ts`, which probes the geometry with a ray straight down
  and straight up from the road centre. The gateway used to draw a 4.3 m opening over a collision
  box that started at 1.42 m — you ran cleanly under the arch and died anyway. Its lintel is now
  built *from* the collision spec, so the duck is never a guess, and the bar's gap dropped to
  1.25 m because from a camera 4.4 m up and 8.6 m back a 1.5 m gap reads as "I fit under that".
  The same check also guards the gate's *legibility*: its columns have to stand at least a metre
  proud of the lintel, because a column tucked behind the lintel's end is two pixels wide at spawn
  distance and the gate collapses into a bare bar hanging over the road.
- **The board advertised 842 km/h for a person on foot.** `top_speed` was converted to
  km/h on the way into the database and converted *again* by `formatSpeed` on the way
  out. It is stored in world units per second now, like `distance_m` is stored in metres,
  and the existing rows were migrated by a one-off update guarded on the one thing that
  makes them identifiable: 65 m/s is the game's ceiling, so anything above it could only
  have been kilometres per hour.
- **The stage hint was half-covered by the characters it described.** "Bấm vào nhân vật
  để chọn" sat at the bottom of the stage, which is exactly where six pairs of feet and a
  mace are drawn. It sits at the top of the stage now, in empty sky.
- **A legend that is entirely one colour is not a legend.** The help screen listed "blue
  halo — helpful · red spikes — harmful" in a single grey, and the whole point of that
  sentence is the colour. Blue reads blue and red reads red.
- **11 px, uppercase and tracked is the hardest way to read a sentence**, and the help
  rows and leaderboard rows are sentences. Sentence case, 12 px, minimal tracking.
- **The scrollbars were the browser default** — a chunky grey slab against a pale panel —
  and the settings toggle's off state was white at 14 % opacity on a near-white panel,
  which is a control you cannot see.
- **"Is the text clear enough?" is a measurable question.** It was not: the ability label
  on the character tiles sat at **1.94:1** — an 8.5 px string at 65 % opacity, the worst
  combination of every possible fault — the class tag at 4.03:1 and the stage hint at
  3.4:1, all below the 4.5:1 WCAG asks for body text. Tiny type also carried the widest
  letter-spacing, which is exactly backwards. Every one of them is fixed, and
  `scripts/legibility-check.ts` now reads `ui.css` and measures it: it resolves custom
  properties, composites opacity against the background, and fails the build if any
  menu string drops below 4.5:1 or below 9.5 px. It carries regression guards for the
  two old colours, so if the maths ever breaks the audit says so instead of passing.
- **The tiles were not aligned, and it was not a judgement call.** A two-word class tag
  ("Sát thủ bóng đêm") wrapped to two lines and pushed the ability block down — in
  precisely the tiles whose tags were longest. The tag and the ability text now reserve
  their lines, so six tiles are one shape whatever the words do.
- **The three menu buttons were two different heights.** "Bảng xếp hạng" broke across two
  lines in a third of a column and "Cài đặt" did not. The label is now "Xếp hạng", the
  row is `nowrap`, and the tracking is a quarter of what it was.
- **The stage was a wide blue band with the heroes in the middle of it.** The fit-to-width
  camera means the character's pixel size depends only on the stage's *width*, so the
  extra height bought nothing but empty space. 268 px down to 214 px, same heroes.
- **A cleanup script deleted a range instead of a line, and the menu shipped showing
  raw keys.** The sweep that removed the project card used a lazy regex to find each
  dictionary entry; for a single-line entry it matched from that line all the way to the
  next multi-line entry's closing brace, and took fourteen `menu.*` strings with it. The
  build stayed green, `tsc` stayed clean, and all nine checks stayed green — because a
  missing dictionary key is not an error, it renders as its own name. The menu said
  `MENU.START`. A screenshot caught it; nothing else could have.
- **So the dictionary is audited now** (`scripts/i18n-check.ts`, browser-free). It reads
  every `t(…)` call site and the dictionary and compares them both ways: nothing used may
  be missing, nothing defined may be unused, every entry must be written in both
  languages, no key may appear twice. It found the same class of bug in itself on its
  first run — matching `t('…')` directly misses keys inside a ternary, which is how the
  power banners are written, and it reported fifteen live keys as dead.
- **The switch to Aetherfall is gone.** It sat in the menu footer and took the player out
  of the game and into the old one. Nothing imports `AetherfallApp` any more, so it is
  not in the bundle; the code is still in the repo if it is ever wanted back.
- **Copy is not decoration — it was audited.** The menu carried an Arc project card
  (logo, tagline, marketing blurb, "every coin you grab is the project icon") that read
  like an advert inside a game menu, and a subtitle that promised a "daylight sprint"
  three biomes after daylight stopped being the whole game. Both are gone.
- **Half the HUD was written in English and never translated.** Score, Combo, Velocity,
  Top, Slide, Jump, Shield, Overdrive, Double, Phase, Mirrored, Smoke, Heavy, the swipe
  hints, the settings labels, the whole help screen, the leaderboard rows — all hardcoded,
  so a Vietnamese player got a Vietnamese menu and an English HUD. Every one of them now
  goes through the dictionary, in both languages.
- **The loading screen still said ARC RUSH**, the name from before the rename. It reads
  the name from the dictionary now, so it can never fall behind again.
- **A fact-check found a lie.** The help text promised "tap again to double jump" — there
  is no double jump anywhere in the physics. It was never rendered, so nobody saw it, but
  it is gone. Twenty-seven other dictionary entries were written and then never shown,
  including a speed-tier ladder for a HUD that has no tier display.
- **Some dead strings were worth keeping.** The pickup legend (blue halo helpful, red
  spikes harmful) and the obstacle summary were written and never wired up — they are on
  the help screen now, where they explain the thing the game actually asks you to read.
- **The name is Mochiro, and the mark is the game's own.** The header used to wear the
  Arc project's logo, which is the *pickup*, not the game. The new mark is a squircle
  badge — deliberately not a coin, because the road is full of coins already — holding a
  soft, forward-leaning M standing in three speed streaks. The M is drawn twice, a dark
  copy nudged down and then the lit one, which is what makes it sit on the badge instead
  of floating over it. It is vector art, so it is sharp at the 24 px a tab icon gets and
  at the 400 px a poster would.
- **The mark and the tab icon are one source, not two.** Both are built from
  `mochiroMarkSvg()`, and the check asserts the favicon equals the logo modulo gradient
  ids — a hand-copied second version would drift the first time either was touched.
  `index.html` is off-limits and ships a generic icon, so the tab title and icon are set
  from the app at runtime.
- **Two obstacles were the same obstacle in two costumes.** `bar` was a plain red slab;
  `tunnel` was the striped gate with chevrons, pillars and an arch. Both had
  `bottom: 1.25` and `width: 9.4`, so both were "slide under this" — and the player met
  them back to back. The plain slab is gone: `bar` is no longer an `ObstacleKind`, its
  spec, geometry and material are gone, and the patterns that raised it now raise the
  gate they are named after. The pattern previously called `bar` is called `gate`.
- **The pattern named `tunnel` spawned a `bar`.** `case 'tunnel': spawn('bar', 1, z)` —
  the one pattern whose whole job was to raise a gateway raised the other thing. Found
  by reading the spawn switch rather than by looking at the road.
- **A roll chain that was out of order.** `pickPattern` read
  `roll < 0.9 → slideGate`, then `roll < 0.84 → rampCar`, then `roll < 0.92`, then
  `roll < 0.86`. Three branches were unreachable and `slalom` — which has no case in
  `spawnPattern` at all — could never be picked. Every branch now returns a pattern that
  exists, so the game repeats itself as often as the weights say it should.
- **The police car is gone.** The pursuit cruiser — its model, its four project badges,
  its livery, its lane-picking, and the whole of `src/runner/pursuit.ts` — has been removed
  on request. What remains is the rule it existed to enforce: a crash adds heat, clean
  running sheds it, and the top of the meter ends the run. The HUD meter is now the *whole*
  of the system, so it is drawn the moment any heat exists at all — the bar jumping is the
  only feedback a crash gets. `PURSUIT` keeps `crashHeat`, `coolPerSecond` and `bustedAt`;
  `farZ`, `nearZ` and `laneClearance` died with the car. Five assertions in
  `feature-check.ts` went with them; the four that test the arithmetic stayed, because
  that is the part a player feels.
- **Removing a thing means removing what it said.** Three strings still promised a cruiser:
  the help intro ("before the cruiser catches you"), the busted badge, and the revive hint.
  The help intro was also wrong about the rule — it claimed one hit ends the run, which has
  never been true. All three now describe the game that exists.
- **Having a profile is not the same as having played.** A profile row is created for a
  guest the moment they arrive (the debounced name save does it), so `profile` being
  non-null proves nothing about whether they have run. The tiles now key off
  `runs > 0` — `const played = (profile?.runs ?? 0) > 0 ? profile : null` — and read `—`
  until there is something real to show.
- **The guest identity lives in the browser, not on a server.** `getRunnerClientId()`
  returns `arc:<wallet>` when signed in and `arcrush.clientId` from localStorage otherwise,
  so a guest's stats are that *browser's* guest history — real, but anonymous, and gone if
  site data is cleared. Signing in switches to the wallet's profile, which is a **separate**
  history: guest runs do not merge into it.
- **Four zeros is not a scoreboard.** The menu's four tiles read `profile?.best_score ?? 0`
  and friends, so a guest — who has no profile until their first run — saw
  `0 / 0 / 0 / 0 m`, which reads as broken rather than as new. They now read `—`. The
  tiles are the *player's own* numbers, not the world's; a guest gets a profile of their
  own the first time they run.
- **A blocked start button is a wall, not a rule.** Disabling *start sprint* over a name
  that is merely taken stops the player playing in order to enforce a label. The rule is
  enforced where it matters — the save is skipped and the server answers 409 — and the run
  keeps the name already on the profile. The red line still says why.
- **An emptied field must not persist, and must come back.** `storeRunnerName` now refuses
  to write an empty string, so the last valid name is never erased, and the field restores
  it on blur. A field that can be left holding nothing leaves the next visit with nothing.
- **The account is the source of truth for the name.** The profile name was only applied
  when `localStorage` had nothing under `arcrush.name`, so a stale "Runner" written before
  sign-in won forever — the menu showed "Runner" while the account was "Makoto". The
  profile now wins unless the player has already started typing (`nameTouched`).
- **A name that is a problem is fixed where the problem is shown.** Signed in, the field
  was a fixed value, so a name that came back taken left the start button disabled with
  nowhere to go but Settings. The menu now swaps in the input whenever the name is not
  `ok`, auto-focused — and `editing` keeps it mounted while it is focused, because a name
  that becomes free again would otherwise swap the input for the value mid-keystroke and
  drop the caret.
- **Two players cannot share a name.** The database already had two rows reading
  "Makoto" — one the real wallet profile with six runs, one an empty guest profile created
  a second later. Nobody could tell whose run was whose. `runner_profiles.name` is now
  guarded in three places: `GET /api/runner/name-available` answers the question,
  `POST /api/runner/profile` returns **409 `name_taken`**, and `POST /api/runner/runs`
  falls back to the name already on the profile rather than throwing a finished run away.
  The check ignores your own row, so keeping your own name is always allowed. The empty
  duplicate was deleted (`runs = 0 AND best_score = 0`), which is what freed the name.
- **The name is a field with a rule, so the rule is stated where the field is.** The menu
  shows the message under the input and disables the start button while the name is taken
  or too short; a check that cannot reach the server resolves to *ok* rather than locking
  the player out of their own game.
- **A name attached to an account is set once, not re-typed.** The menu asked every
  player for a name on every visit, signed in or not — the same field, the same
  placeholder, as if the account knew nothing. Signed in, the field is now a value
  (`Locked to your account — change it in Settings`), and the one place to edit it is
  Settings. A guest still gets the input, because a guest has no account to hold a name.
- **A read-only value must not look like a disabled field.** `.ar-name-fixed` reads as a
  filled value — tinted background, bold ink, no caret — so nobody clicks it wondering why
  it will not type.
- **The menu footer is gone.** "Global: 190 sprints · 30.3K Arc collected · best 616,347"
  sat under the panel on every visit, and the numbers are already on the leaderboard where
  they belong. Removing it also meant removing `menu.global` from the dictionary and the
  `stats` prop from the menu — an unused key fails `i18n-check.ts`, which is the point of
  auditing the dictionary in both directions.
- **"Play as guest" was a one-way door.** The gate appears once, at startup; choosing
  guest made sign-in unreachable for the rest of the session, and the menu header rendered
  `{account && <AccountChip …>}` — which for a guest renders nothing at all. There was
  simply no way back in. The header now shows a sign-in button wherever the account chip
  would sit, opening the gate over the menu.
- **A gate that is opened over something can be dismissed; a gate that is the only thing
  on screen cannot.** `AuthGate` takes an optional `onDismiss`: at startup there is
  nothing behind it, so a click outside does nothing, but opened from the menu the
  backdrop is a way out like every other panel.
- **A panel you cannot dismiss by clicking beside it feels broken.** Every panel had a
  Close button and nothing else, so the only way out was to aim at a small target. All
  four dismissible panels now close on a backdrop click, and the test is
  `event.target === event.currentTarget`: the click has to land on the backdrop itself,
  so a click that started inside the panel and ended outside it does not dismiss. The
  pause panel *resumes* rather than closes, because that is what a click outside "paused"
  means. The results screen deliberately does not — you have to choose something there.
  A check in `feature-check.ts` fails the build if a rewrite drops any of the four.
- **4.5:1 is a floor, not a target.** The whole interface was held to the AA minimum,
  and text that only just clears the minimum reads as washed out — which is what a player
  said, unprompted, looking at the menu. Every secondary ink was failing AAA: the tile
  tag 5.47:1, the ability label 6.56:1, the hint 4.85:1, the difficulty buttons 4.97:1.
  The audit now holds small text to **7:1** and large text to 4.5:1, and one secondary
  ink (`#33455f`) replaced five pale greys — it clears 9.49:1 on the panel and 7.86:1 on
  a white chip over the night sky, so it is safe everywhere it is used.
- **Sharpness is two things, and contrast is only one of them.** The other is stroke
  weight: every small label was rendering at the 400 default. They carry 600 now. And the
  app sets `-webkit-font-smoothing: antialiased` globally — a rule written for dark
  backgrounds, applied to light panels, thinning every glyph. It cannot be edited where
  it lives, so it is answered in `ui.css`: `auto` restores the browser's own subpixel
  rendering, which is visibly crisper on light surfaces.
- **Four colours could not reach 7:1** and were retuned: the cruiser warning (5.45:1),
  "busted" (6.37:1), "new personal record" (5.77:1) and the good-news toast (5.61:1 —
  green is the hardest hue to keep both bright and legible). The power pills were
  retuned from a 30 % hue mix to 28 %: worst of the eight, 7.32:1.
- **The character cards were told to left-align.** `.ar-char-tile` declared
  `text-align: center` and then a later rule set `left`, so the name and the job tag ran
  left while the ability text below them — which declares its own `center` — stayed
  centred. Two alignments inside one card. The stray declaration is gone.
- **A job tag is a label, not a sentence.** "Chiến binh sấm sét" (17 characters) and
  "Sát thủ bóng đêm" (15) wrapped mid-phrase while "Pháp sư" (7) sat on one line, so the
  six cards read as a ragged row rather than a set. The budget is derived from the tile
  rather than guessed — 1080 px panel, a 1.62fr column of a 2.42fr grid, six tiles with
  8 px gaps and 10 px of padding leave about 86 px of text at 10 px uppercase and
  0.06em tracking, which is twelve characters. Three tags were over it; all six fit now,
  and the check fails the build if a longer name is ever added.
- **A screenshot that can be misread is a screenshot that will be.** "QUÃNG ĐƯỜNG" at
  10 px, uppercase, tracked 0.18em was read as "ĐƯỜNG ĐƯỜNG" — a duplicated word, i.e. a
  text bug. The source said otherwise, and the real finding was the type itself: the
  results screen was still wearing the exact combination this project had already
  removed from the menu tiles. It is 11 px sentence case now, and the misreading is the
  evidence for why.
- **Two primaries is the same as none.** The results screen offered "Continue · 20 coin"
  and "Sprint again" as two identical filled gradients. The revive is the hero action;
  sprint again is the ordinary one, and it looks like it.
- **"New personal record" was 2.31:1** — amber on a near-white panel, on the one line
  that is supposed to make you feel good about the run. It is a badge now: tinted field,
  dark amber ink, 6.31:1.
- **The big score ran from `#eaf8ff`** — 1.08:1 against the panel, invisible — through
  cyan to violet. The pale end of a gradient is where the eye starts. All three stops are
  dark now, worst 5.10:1.
- **The results screen is the same problem as the HUD**: panels over a world that changes
  colour four times per run. Every label, mission row and counter on it is now measured
  over both the day sky and the neon night. 57 assertions.
- **An incomplete audit is a claim you cannot back.** The legibility pass covered 22
  selectors in the menu and the sign-in screen. The stylesheet declares a font size in
  **84** places. So **62 pieces of text had never been measured** — including the whole
  HUD, which is where the player spends the entire run. The audit now reads the power
  hue table straight out of `RushHud.tsx`, understands `color-mix`, and tests every HUD
  chip against **both** extremes the world reaches: the pale day sky and the neon zone
  at night. 49 assertions where there were 22.
- **The power pills were invisible.** They carried their hue in `color`, and
  `border: 1px solid currentColor` copied it onto the border — so a bright cyan label sat
  on a white pill at **1.04:1**. All eight hues failed. The hue now lives in a custom
  property that tints the chip, and the ink is that hue cut with navy, so a pill still
  reads as "shield" while the word stays legible: worst of the eight, 5.71:1.
- **The score was white on a pale sky: 1.13:1** — the largest type on the screen, and
  you could not read it. The multiplier was 1.58:1 and the floating numbers 2.43:1.
  No single ink clears both a pale sky and a dark road, so these carry an outline, and
  what makes an outline work is the contrast between the **fill and the outline** — that
  is the number the audit checks now (white on `#0a1a36` is 17.3:1).
- **A translucent chip is not a background until you say what is behind it.** A white
  chip at 86 % over the night sky composites to `#dddde0`, and the mid-grey label on it
  is 3.67:1. Every HUD chip is now measured over the darkest and the lightest thing the
  world contains.
- **An inherited colour is an unmeasured one.** The swipe hint and the toast declared no
  colour at all; the coin unit inherited the mid-grey. The audit treats a missing colour
  as a failure rather than a shrug — which is how all three were found.
- **A false positive is a bug in the audit.** The toast variants sit on the same element
  as `.ar-toast` and only change border and colour, so their font size is inherited —
  the audit reported `0px`. `sizeFrom` lets a target name the class its size comes from.
- **A heading is not a logo.** The sign-in screen reused `.ar-title`, which is the menu
  wordmark — 68 px, uppercase tracking, and a gradient running from near-white to violet.
  That style is built for a dark backdrop; on the white sign-in panel the pale end of the
  gradient vanished, "Đăng nhập Mochiro" grew to three lines, and the heading became wide
  enough to push the language switch clean out of the card. The screen has its own
  heading now, the language switch is a bar above it rather than a passenger beside it,
  and the mark sits on a soft plate as the screen's focal point.
- **Playing without an account is a real choice, not fine print**, so it is a real
  control — dashed, deliberately the quietest button on the screen.
- **The audit caught the author.** The first pass at the sign-in footer used `#6d80a3`
  at 11 px: 3.89:1, under the 4.5:1 the same file demands of everything else. The check
  failed the build before a player could read it.
- **A centred flex item that outgrows its container loses its top edge** — the overflow
  is above the scroll origin, so it cannot be scrolled back into view. `.ar-screen` asks
  for `align-items: safe center`, behind an `@supports` so an older engine keeps the
  plain value rather than falling back to `stretch`.
- **A logo can be measured.** The check reads the monogram's own path, adds half a
  stroke-width past every point (a stroke is drawn centred on its line) plus the bevel
  offset, and asserts the ink lands at least 8 units inside the badge — 10.8 in practice,
  the closest edge. It also measures the mark against the field it stands on: 6.6:1,
  where WCAG AA asks 4.5:1. Rasterised at 24, 54 and 256 px to confirm the M still reads.
- **The menu is a panel, not a form.** It was a narrow column: a short wide strip of
  heroes with dead space above and below, six character tiles whose ability text spilled
  past their borders, and a project blurb clipped mid-sentence. It is now one wide panel
  in two columns — the line-up and the heroes on the left, everything you set before a
  run on the right — and the live world behind it is blurred and darkened so the panel is
  the only thing on screen. That blur also means a building the orbit camera happens to
  pass through can never look like a broken panel edge, which is what the old screenshot
  showed on the left.
- **The line-up camera fits the stage instead of standing still.** It used to sit at a
  fixed 6.05 m, so on a wide, short stage the six heroes filled 72% of an axis and the
  rest was empty background. It now fits by width on every resize — never closer than
  the tallest hero needs, or a wide, short stage pushes the camera in far enough to
  distort the faces. The check asserts that at seven stage shapes, from 3.2:1 to 0.9:1,
  the line-up both fits and spans at least 95% of an axis.
- **Ability text is clamped, not clipped.** Six tiles of six different heights made the
  row read as six separate boxes; a two-line clamp keeps them one control. Layout classes
  shared with other screens (`ar-stats-grid`, `ar-menu-row`) are scoped to the menu, since
  the results and settings screens still want their own arrangement.
- **A slab that was invisible on pale grey is not invisible on black.** The track used
  to carry a translucent 2.05 × 26 m "lane guide" that slid under the runner's feet.
  Against the old pale-grey surface it disappeared; against real asphalt it read as a
  long pink rectangle dragging along under the character. The road now has proper white
  lane markings doing the same job better, so the slab and its setting are gone. Changing
  a surface means re-checking everything that was drawn on it.
- **The cruiser wears the project's own mark.** Its badges are struck the way the coin
  is — gold rim, navy field, the mark in the middle — so the thing chasing you and the
  thing you are collecting read as the same project. The badge layout is exported as
  data (`CRUISER_BADGES`, `CRUISER_BODY`) and checked, because a badge that floats off
  the car or sinks inside it is invisible from the chase camera and that mistake was made
  twice by hand first.
- **A road is asphalt and paint.** The surface was pale grey, which reads as a runway.
  Real asphalt is near-black and the only bright thing on it is the paint, so the road
  is a dark aggregate with a slight crown and the markings do all the work: a solid
  white edge line either side of the carriageway, and dashed dividers between the lanes
  laid as real geometry so they can be worn unevenly. At speed the white edge line
  streaming past is the strongest motion cue in the scene, and it cost nothing but a
  change of colour. `PALETTE.grid` is the single source of truth for the paint, so the
  baked edge line and the geometric dashes can never drift apart.
- **Difficulty is two numbers and a rule.** A mode scales the speed ramp and the gap
  between patterns — the two things that actually decide how hard a run is — plus how
  often a harmful power is drawn, plus what a continue costs. Easy is a real step down
  (86% speed, 28% more room) and hard a real step up (116%, 20% less).
- **Missions turn "how far did I get" into "what am I trying to do".** Three are rolled
  per run from a weighted catalogue with a target inside a range, so two runs never ask
  for the same thing. Progress is read straight off the run's own counters, which is why
  a mission can never disagree with the HUD. The coin mission counts coins *picked off
  the road* rather than the purse — otherwise completing a mission would progress it.
- **One crash is survivable; two in quick succession are not.** A cruiser sits behind
  the runner the whole time. Every contact brings it closer and clean running lets it
  drop back, so the run is decided by how cleanly you drive rather than by one bad
  frame. It works the *furthest* lane: it is metres closer to the camera than the
  runner and therefore magnified, and from the nearest free lane its near wing projects
  across the runner's legs.
- **A close call is worth points.** A hazard that swept past with under 30 cm of air
  between the boxes pays `RUN.nearMissBonus × multiplier` and shouts `CLOSE!`. The
  threshold is tight on purpose: a clean pass in the next lane leaves about 0.9 m, and a
  slide under a barrier always leaves 0.39 m, so only a deliberate graze — mid-lane-
  change, or a jump that barely clears — earns it.
- **Coins buy a second chance.** A continue costs 20/25/35 coins depending on the mode,
  shakes the cruiser off and leaves the runner untouchable for 2.6 s. It is the one
  thing coins buy, which is what makes them worth collecting.
- **Variety comes from light, not from geometry.** A run travels through four zones —
  daylight, golden hour, dusk, neon night — and a zone is a *palette*: sky, fog, sun
  colour, sky/ground bounce and exposure, blended over 150 m of track with a smoothstep
  so the change reads as weather rather than as a switch. Nothing new is built, which is
  how the idea is affordable at all; it is the trick `Blue Run` uses for its five biomes
  and Subway Surfers for its city/neon themes. The zones are keyed to distance, so a long
  run sees all four and a short one still sees two, and the HUD carries a chip naming the
  one you are in. The night zone leans on the emissive lift every prop already has to
  keep the runner and the traffic readable against a dark sky.
- **The sweep judges contact, not proximity.** At full speed a frame covers 3.26 m — more than a low
  wall is deep — so the sweep used to widen its window to `depth/2 + 0.55 + min(2.4, dz/2)`, which
  reached 2.75 m up the road. The height test then ran while the obstacle was still metres away,
  judging a jump by where the runner had been a step earlier, and a runner could be waved through an
  obstacle their body was still inside. Contact is now either *beside the runner now* or *swept past
  them during this step* — `run.previousY` records the height the step began with, which is the
  height that matters for a crossing — and the top edge lost its 12 cm of forgiveness: a wall with
  no `platformTop` cannot be stood on, so there is no landing to forgive. `scripts/sweep-check.ts`
  walks every obstacle past a runner at every speed and frame time the game can produce and fails if
  a body buried deeper than the declared fairness tolerance is not hit.
- **Signs own their sightline.** The tree line *and the lamp posts* are laid out around the
  billboards rather than through them: a tree or a lamp may stand in front of a sign only while it
  still projects clear of the artwork, otherwise it is pushed behind, where the depth buffer keeps
  the wordmark visible. Two details make this work: distances are measured from each chunk's real
  position (chunks are built in local space, so a local-z comparison puts chunk 5 on top of the
  camera), and the post rides as a child of the panel, tucked 0.2 m behind it — a post centred on
  the panel's own z pokes 0.11 m towards the camera and draws a grey stripe down the wordmark.
  `scripts/billboard-check.ts` projects the whole street onto the camera, replays the layout and
  sweeps 400 random ones to prove nothing crosses a sign.
- **Black and white edges**: the painted road edge and the kerb caps alternate near-black with
  off-white, so the edge reads as a marked line instead of a second row of pale concrete.
- **No pure white anywhere**: the kerb is laid as individual stones with alternating shades rather
  than one 320 m concrete box (a single near-white box turns into an endless bright stripe as it
  streaks past), the pavement, lane markings and building walls are all toned to warm off-whites,
  and the brightest surfaces stay clear of the bloom threshold.
- Adaptive quality (auto/low/medium/high) with automatic stepping when frame rate drops, and a
  manual override in settings. Bloom is thresholded above white so daylight never washes out.

---

# 5. Accounts (wallet + Google)

Two ways in, modelled on the Makoto wallet reference: a browser wallet with
Sign-In with Ethereum, or Google — and a Google account gets an Arc wallet
minted **on the device**.

| Route | Method | Purpose |
|---|---|---|
| `/api/auth` | GET | Current session for a bearer token |
| `/api/auth/config` | GET | Chain id, RPC, explorer, Google client id |
| `/api/auth/nonce` | POST | Issues a SIWE challenge bound to an address |
| `/api/auth/verify` | POST | Checks the signature, opens a session |
| `/api/auth/google` | POST | Verifies a Google ID token, links the device wallet |
| `/api/auth/logout` | POST | Revokes the bearer token |
| `/api/auth/sweep` | POST | Drops expired sessions and challenges |

**Wallet sign-in.** The server issues an EIP-4361 message (Arc testnet, chain
5042002) and stores the nonce; the browser signs it with the injected wallet; the
server recovers the address and only accepts the challenge once. Replays, tampered
signatures and swapped addresses are all rejected — the QA script proves each.

**Google sign-in.** The ID token is verified server-side against Google's
`tokeninfo` endpoint (audience, issuer, expiry, verified email). If the account
has no wallet yet, the browser mints one: `ethers` generates the key, the key is
encrypted with the player's password (PBKDF2-SHA256, 210k iterations → AES-GCM)
and only the ciphertext is stored in `localStorage`. The address is registered
with the server together with a signature over a link message, so the server
knows the device really holds that key. **The key never leaves the browser** —
losing the password and the recovery key means losing the wallet, exactly like
the reference.

Google sign-in needs a client id. Set `GOOGLE_CLIENT_ID` on the backend (and
optionally `VITE_GOOGLE_CLIENT_ID` for the frontend build), or paste one into the
sign-in screen's setup field, which stores it locally for that browser. The
Google Cloud project must list the preview origin as an authorised JavaScript
origin.

**Progress follows the account.** Once signed in, the runner profile and every
submitted sprint are keyed to `arc:<wallet address>` instead of the device uuid,
so the same board entry appears on any browser. Guests keep playing with a
device-local profile.

Tables (auto-synced from `backend/db/schema.js`): `arc_accounts`, `arc_sessions`
and `arc_challenges`.

---

# 6. Languages

The whole interface is bilingual — Vietnamese and English — with a switch on the
sign-in screen, on the menu header and in settings. The choice is stored in
`localStorage` and the first visit follows the browser language. Copy lives in
`frontend/src/lib/i18n.ts` as a flat `key → { en, vi }` dictionary, read through
`useT()`; nothing is hard-coded in components.

---

# 7. Backend API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/arc/project` | GET | Arc project card (name, tags, description, socials, logo path) |
| `/api/arc/logo` | GET | Same-origin proxy for the Arc logo image (cacheable, CORS-friendly) |
| `/api/runner/leaderboard` | GET | Top 20 sprints + global statistics |
| `/api/runner/runs` | POST | Submit a finished sprint, update runner aggregates, return rank |
| `/api/runner/profile?client_id=` | GET | Fetch a runner profile |
| `/api/runner/profile` | POST | Create or rename a runner profile |
| `/api/leaderboard` | GET/POST | Aetherfall leaderboard + run submission |
| `/api/profile` | GET/POST | Aetherfall profile |

Tables (auto-synced from `backend/db/schema.js`): `runner_profiles` + `runner_runs` (Mochiro) and
`players` + `runs` (Aetherfall). Client ids are UUIDs in `localStorage`, so progress follows the
browser without accounts.

---

# 8. Verification

```bash
cd frontend
bun run scripts/game-smoke.ts   # Aetherfall headless self-check (no WebGL needed)
bunx tsc --noEmit               # type check
bun run build                   # production build (client + SSR)
```

### End-to-end browser checks

```bash
cd frontend
bun add -d puppeteer yauzl            # one-off: downloads a headless Chrome build
bun run scripts/runner-browser-check.ts   # Mochiro
bun run scripts/browser-check.ts          # Aetherfall
```

Both scripts boot the running preview in headless Chrome (software GL) and fail on any console
error, blank frame or broken API:

- **Mochiro** (43 checks): menu branding + logo load → sprint start → lane changes, jump, slide →
  the run cycle resuming at full animation weight after the landing clip → coin lines and combo
  multiplier → cars landed on and run along the roof, ramp launches (including the run cycle
  taking over mid-flight), tunnel mouths → collecting a hazard and watching the mirrored steering
  plus the red HUD warning → magnet, shield, overdrive → pause/settings/resume → crash → death clip
  → result screen → leaderboard submission → back to the menu → switch to Aetherfall.
- **Sign-in** (`scripts/auth-check.ts`, 18 checks): the gate appears → wallet sign-in through a
  mock EIP-1193 provider (a real key signs a real SIWE challenge) → the account chip shows the
  wallet → the bearer token survives a reload and is accepted by the server → sign-out returns to
  the gate and clears the token → guests still play → **all six heroes load their rigged model in
  the game**.
- **Aetherfall**: menu → zone 1 combat → pause/settings → all five zones with upgrade drafts →
  boss → victory → leaderboard submission.

Screenshots are written to `frontend/.browser-check/` and analysed for contrast so a black screen
cannot pass.

`scripts/hero-check.ts` (17 checks) photographs each hero in the studio framing and
measures the archer's kit: a ~1 m recurve bow slung on the back, clear of the ground,
a quiver on the back, **no** baked-in melee weapon left switched on, and — as the
control — the assassin's knife still visible.

`scripts/kit-check.ts` also needs no browser: it applies each character's `hideNodes`
to the rig file and reports the weapons that survive, then runs the same
head-silhouette test over them. It pins the assassin to exactly `Knife` +
`Knife_Offhand`, the archer to no baked weapon at all, and every hero to a kit that
stays clear of the head from behind.

`scripts/feature-check.ts` needs no browser either, and it is the one that earns its
keep. It checks the systems added on top of the run — difficulty, missions, the
pursuit, close calls, the road itself — and the assertions are the ones that would
otherwise stay invisible until a player is three minutes in:

- **One crash must be survivable and two must not.** The pursuit meter is arithmetic, so
  it is checked as arithmetic.
- **The cruiser must not cover the runner.** Its box and the runner's box are projected
  through the real game camera and tested for overlap in screen space. This is the same
  technique `slide-pose.ts` uses, and it is the only reason the chase is shippable
  without a browser to look at it.
- **A close call must be earned.** The threshold has to sit below the 0.9 m of air a
  clean pass in the next lane leaves, or every obstacle would award one.
- **The road must read as a road.** Dark asphalt, bright paint, and a luma ratio between
  them.

It caught three real faults on the way in: the cruiser sat in the *nearest* free lane,
where the camera magnifies it enough to project across the runner's legs; the heat
meter was never incremented on contact, so the pursuit could never actually end a run;
and `crashHeat` was set a hair low, so two crashes left the meter at 0.90 rather than
busting.

`scripts/biome-check.ts` needs no browser either: it walks the whole distance range a
run can cover, metre by metre, and demands that the blended sky, fog and lights never
jump between one metre and the next — a hard cut would be over 1.0 in colour distance
and the worst step it allows is 0.02. It also pins the lighting inside the band the
game was tuned in (exposure 0.8–1.0, key light above 0.6), and checks that every zone
is reachable and labelled in both languages. It caught a real discontinuity on its
first run: the blend picked its base zone a whole handover early, so the sky cut from
daylight to golden hour in a single metre at 369 m.

`scripts/sweep-check.ts` needs no browser either: it walks an obstacle past a runner at
every speed and frame time the game can produce — including the worst case, 65 m/s on a
50 ms frame — and demands two things. Nothing slips through: an obstacle the runner's
body overlaps by more than the declared fairness tolerance is always a hit, and an
obstacle that crosses the runner between two frames is never missed entirely. And the
intended passes survive: a slide still fits under a gate and under the gateway, feet
above an obstacle's top still clear it, and a runner standing on a car roof is not hit
by the car they are standing on.

`scripts/obstacle-fit.ts` and `scripts/billboard-check.ts` need no browser either: the first
rebuilds every obstacle mesh and ray-probes it against its collision box, the second replays the
whole scenery layout and projects the tree line and the signs onto the camera to prove no canopy
can cross a wordmark.

`scripts/carry-geometry.ts` needs no browser at all: it parses the rig, replays the
exact placement maths `gear.ts` runs at load time against the rest pose, and samples
the bow and quiver along their length against the head mesh's real silhouette, band by
band. A single sample landing behind the head inside its outline fails the check —
which is how the hand-carried bow's hood-crossing was pinned down and how the slung
placement was tuned (bow 66° across the back at 46% of body height, quiver 16% lower).

`scripts/menu-check.ts` photographs the sign-in gate, the live 3D line-up (before and after a
click) and the English menu, and reports the stage canvas size and the number of hero tiles.

`scripts/city-check.ts` photographs the city obstacles and the pickup glyphs (car roof, ramp
launch, tunnel mouth, one boon and one hazard) so the new content can be reviewed frame by frame,
and `scripts/speed-check.ts` captures the speed streaks at play quality, including an on/off pair
for the same moment.

`scripts/portrait-check.ts` isolates the runner model on a plain backdrop (dev-only `studio`
mode), photographs both heroes with and without hair, parks the camera on the street to inspect
the generated town, and captures a medium-quality gameplay frame — so the character rig, the town
art and the bloom/post-processing path can all be inspected without a human eye.

`window.__arcrush` and `window.__aetherfall` (dev builds only) expose `snapshot()`, power-up
grants, deterministic obstacle/coin spawning, the character picker, `studio()` / `portrait()`
model inspection, `parts()` / `stats()` / `probe()` diagnostics and progression helpers so
automated checks can play without a human at the keyboard; they are stripped from production builds.

---

# 9. Deploy notes

- `BASE_PATH` drives the Vite base path and the API proxy; frontend requests always go through the
  `api()` helper so preview and production paths stay in sync.
- The SSR entry renders a placeholder shell only — the games mount on the client, so WebGL is never
  touched during server rendering.
- Audio unlocks on the first user gesture (browser autoplay policy).
- On devices without WebGL the app shows a clear message instead of failing silently.
- `ARC_PROJECT_SLUG` / `ARC_PROJECT_QUERY` env vars can point the coin art at a different project
  from the Surf catalog without touching code.
