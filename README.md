# ScrapYard Wars

A 3D robot building and battling game I built. You build a robot out
of scrap parts, throw it in the arena, and watch it fight to the death.
Points from each win unlock better parts, and your progress is saved
in your browser.

Play it here: [scrapyard-eight.vercel.app](https://scrapyard-eight.vercel.app)

## Features

- 3D build mode with orbit camera, junk metal materials, and shadows
- A junkyard on the edge of the city to fight in, at night: a dirt pit
  walled in corrugated steel, bleachers with a crowd, walls of crushed
  cars, tire stacks, a crane frozen mid-drop, and a lit skyline behind
  it all with blinking towers and billboards
- Thirteen parts to choose from: wheels, treads, hover pads, three hull sizes, a rip
  saw, a drop hammer, an arc zapper, side spikes, two armor sets, and
  a patch kit
- Three opponents each with varying difficulties: Rustbucket, the Mangler, and
  Goliath
- Fights run themselves and you watch: both robots drive in and swing on their own
  clocks, so you live with your build choices
- Real tradeoffs (choose what you think will work best): armor is heavy, heavy is slow, and slow gets zapped
  all the way in
- A 3-2-1 countdown before the horn (hit space to skip it if you are impatient)
- Sparks are shown on every hit, damage numbers, chunks knocked loose by heavy
  swings, and wrecks that tip over and smolder instead of vanishing
- The camera sits ringside and rattles when something big connects
- A hull telemetry graph after every fight, you in blue, them in gray
- Ringside callouts when blood is drawn and hulls hit half
- Eight achievements, including one for losing to the easiest robot
- Part unlocks, best scores, and achievements persist between sessions
- All sound effects generated in the browser with the Web Audio API

## How to Play

1. Pick parts from the palette on the left. A robot needs a drive at
   the bottom, at least one hull section, and a weapon.
2. Watch the stats panel: speed has to stay out of the red or you
   will get picked apart on the drive in.
3. Pick an opponent and hit Fight. Rustbucket first. (Trust me the rest of them are pretty hard to beat lol) XD
4. Spend the points you earn in the Parts Catalog to unlock treads,
   bigger hulls, the hammer, and the zapper. Goliath is not beatable
   with starter parts, and only barely with everything else because he is like the final boss to my game.

Drag to orbit the camera in build mode and scroll in to zoom.

## Built With

- JavaScript
- Three.js
- HTML5 / CSS
- Web Audio API

## Credits

Three.js is the only thing here I did not write. It is MIT licensed and
a copy of it lives in `vendor/three/`, license included.

Everything else is mine and made from scratch. There are no image files,
no model files and no sound files in this project. Every texture is
painted onto a canvas in code, every robot and every building is built
out of boxes and cylinders, and every sound is generated with the Web
Audio API while the game runs.

## Running Locally

There is nothing to install. Three.js is checked into `vendor/` instead
of being pulled off a CDN, so the game runs with no network at all and
the version can never change under me.

The game uses ES modules, so it needs to be served over HTTP rather
than opened straight from the filesystem. Any static server works:

```
python3 -m http.server
```

Then open http://localhost:8000 in a browser.

On older machines the game watches its own framerate for the first
few seconds and automatically turns off bloom and drops shadow
resolution if it is struggling.

Btw the first commits share a timestamp because the project was built before I set up git, then imported in one pass multiple times to show how I built it.
