# Named states for screenshots

Run `npm run dev`, then open these (fake source, frozen on a timeline step). Add `&debug=1` for fps and `window.__garden`.
Space pauses, Left/Right arrows step frames. In the browser console with `?debug=1`: `__garden.setStep(n)`.

Frame N is the state after the first N scripted events in `shared/fake-data.ts` (14 events, so frames 0..14).

| Shot | URL | What you should see |
|---|---|---|
| bare-soil | `/?source=fake&step=0` | all beds, seed mounds only, no activity |
| joined | `/?source=fake&step=1` | four gardeners and bots arrived |
| fence-up | `/?source=fake&step=2` | trisha's fence around `src/api/` |
| editing | `/?source=fake&step=3` | trisha's bot watering routes.ts, plant growing |
| bee-out | `/?source=fake&step=4` | a bee flying to src/db.ts |
| blocked-edit | `/?source=fake&step=6` | alex stopped at the gate |
| message-in-flight | `/?source=fake&step=7` | butterfly circling trisha (sent) |
| message-landed | `/?source=fake&step=8` | butterfly landed on trisha (delivered) |
| bugs | `/?source=fake&step=10` | bugs on routes.ts, plant drooping |
| botanist-refuse | `/?source=fake&step=11` | refused verdict (animation needs the frame to arrive by stepping forward) |
| tests-pass | `/?source=fake&step=12` | bugs cleared |
| post-commit | `/?source=fake&step=13` | fence gone |
| bloom | `/?source=fake&step=14` | routes.ts in bloom |

Animations (botanist walk, bubbles, butterfly arrival) only play when a frame arrives by stepping forward (Right arrow or autoplay):
jumping to a step uses a reset, which replays no events. To capture an animation mid-way, open `step=N-1&paused=1`, then press Right.
