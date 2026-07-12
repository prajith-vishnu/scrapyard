# ScrapYard

A 3D robot building and battling game. You bolt a robot together out
of scrap parts, throw it in the arena, and watch the fight play out.
Points from each win unlock better parts, and your progress is saved
in the browser.

## Features

- 3D build mode with orbit camera, junk metal materials, and shadows
- A desert junkyard to fight in: a dirt pit ringed with concrete
  barriers, scrap piles, floodlights, and mountains on the horizon
- Thirteen parts: wheels, treads, hover pads, three hull sizes, a rip
  saw, a drop hammer, an arc zapper, side spikes, two armor sets, and
  a patch kit
- Three opponents with fixed builds: Rustbucket, the Mangler, and
  Goliath
- Fights run themselves: both robots drive in and swing on their own
  clocks, so you live with your build choices
- Real tradeoffs: armor is heavy, heavy is slow, and slow gets zapped
  all the way in
- Sparks on every hit and a proper explosion when something dies
- Part unlocks and best scores persist between sessions
- All sound effects generated in the browser with the Web Audio API

## How to Play

1. Pick parts from the palette on the left. A robot needs a drive at
   the bottom, at least one hull section, and a weapon.
2. Watch the stats panel: speed has to stay out of the red or you
   will get picked apart on the drive in.
3. Pick an opponent and hit Fight.
4. Spend the points you earn in the Parts Catalog to unlock treads,
   bigger hulls, the hammer, and the zapper.

Drag to orbit the camera in build mode, scroll to zoom.

## Built With

- JavaScript
- Three.js
- HTML5 / CSS
- Web Audio API

## Running Locally

The game uses ES modules, so it needs to be served over HTTP rather
than opened straight from the filesystem. Any static server works:

```
python3 -m http.server
```

Then open http://localhost:8000 in a browser.
