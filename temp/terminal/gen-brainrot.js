// BRAINROT LOOK for the Brain Terminal (2026-11-05, operator: "absolute total brain rot, as wild as you like, animated and
// moving, no toaster; runs until 1 Dec, then a sweet Xmas look"; "use your own fantasy, take nothing from the picture").
// The idea: everything a ROTTING BRAIN dreams at 3 a.m. — every creature is an everyday thing gone wrong, carrying a brain,
// with a nonsense pseudo-Italian name. All invented here; no existing meme character, no brand.
// Output: temp/terminal/props-br/<name>-<ts>.png
//
// Usage (from repo root):
//   MODEL=gpt-image-2.5-sunburst node -r dotenv/config temp/terminal/gen-brainrot.js <name> [quality]
//   MODEL=gpt-image-2.5-sunburst node -r dotenv/config temp/terminal/gen-brainrot.js <name>@<frame> [quality]
//        one FRAME: an edit of <name>'s newest picture where only the change under FRAMES happens
// gpt-image-2 refuses a transparent background; gpt-image-2.5-sunburst (the Halloween props' model) draws one.
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }
const OUT = path.join(__dirname, 'props-br');
const MODEL = process.env.MODEL || 'gpt-image-2.5-sunburst';

const STYLE = `Hyper-detailed glossy 3D render, absurd deadpan surreal meme energy: ultra-saturated colours, plastic-toy sheen mixed with photoreal textures, dramatic studio rim light. A real-looking pink-tan BRAIN with deep wet folds is part of the character and must be obvious. Big expressive eyes. Cursed but funny, never gory, no blood, no weapons, no logos.`;
const ALONE = `One single isolated character, the WHOLE character inside the image with a clear margin on every side, on a fully TRANSPARENT background: no floor, no ground shadow, no glow behind it, no scenery, no frame. NO text, NO letters, NO numbers, NO logos, NO watermark.`;

const PROPS = {
  octo: `"Spaghettopo Sinapsico": an octopus whose eight tentacles are long strands of cooked spaghetti with tomato sauce, its head a big pink brain with two huge round googly eyes, front view, floating; each tentacle holds something absurd: a tiny violin, a croissant, a rubber chicken, a lit birthday candle, a fork, a tiny umbrella.`,
  bulb: `"Lampadino Pensierino": a big glass light bulb walking to the RIGHT in side view on two long legs in red high-heeled shoes, inside the glass instead of a filament a small pink brain crackling with tiny electric sparks, two cartoon eyes on the glass, proud strut.`,
  astro: `"Neuronauta Pescatore": a chubby white astronaut floating, front view, whose round helmet visor shows NO face — only a pink brain inside with two googly eyes stuck on it; he holds a fishing rod and on the line dangles a tiny ringed planet like a fish.`,
  snail: `"Lumacone Razzo": a snail racing to the RIGHT in side view, its shell is a pink brain, a chrome rocket engine strapped to the shell blasting blue flame behind it, the snail's body stretched by the speed, eyes on stalks flapping backwards, mouth wide open screaming with joy.`,
  fridge: `"Frigorifero Fenicottero": an old mint-green fridge standing on two long pink flamingo legs, front view, dancing on one leg, its door swung open, and inside on the middle shelf a pink brain on a dinner plate with a little cocktail umbrella stuck in it; two cartoon eyes on the freezer door.`,
  sock: `"Calzino Profeta": a striped rainbow sock puppet rising up, front view, with button eyes and a wide felt mouth, a pink brain bursting out of the top of the sock like a hairdo, holding a tiny megaphone to its mouth and preaching.`,
  shrimp: `"Gamberone Ballerone": a bright pink shrimp standing upright on two long muscular human legs in white tube socks and sneakers without any logo, front view, dancing, holding a pink brain balloon on a string in one claw.`,
  kaiju: `"Cervellone Millepiedi": a GIGANTIC pink brain with dozens of tiny human legs in different coloured socks underneath it like a millipede, front view, with seven different eyes of different sizes spread over its folds, all staring at the viewer, mouth a wide grin of tiny teeth.`,
  eyeball: `"Occhione Ragnone": a giant white eyeball with a blue iris and red veins, walking on eight long thin black spider legs, front view, wearing a tiny black top hat lifted by a pink brain bulging out under it.`,
  duck: `"Papera Turbocervello": a yellow rubber duck flying upward to the RIGHT on a jetpack made of two fizzing soda bottles spraying foam below, side view; its head is a pink brain with the duck's orange beak and two googly eyes, wearing aviator goggles.`,
  banana: `"Bananino Lobotomino": a ripe yellow banana standing upright, front view, with huge bodybuilder arms and abs, flexing both biceps, tiny legs in white socks and sandals; the top of the banana is peeled open and a pink brain pops out where the head would be, with a confident grin and one raised eyebrow.`,
  pigeon: `"Piccione Sinapsone": a grey city pigeon in flight, side view facing RIGHT, whose whole body is a huge pink human brain with feathered pigeon wings spread up, a pigeon head with a tiny red eye and an orange beak, and two very muscular tiny human arms flexing under the brain.`,
  cactus: `"Cactusino Pensierino": a green cactus in a red cowboy boot instead of a pot, dancing on the boot heel, front view, two cactus arms raised like a disco move, a pink brain blooming on top of the cactus like a flower, huge cartoon eyes and an open singing mouth.`,
  pizza: `"Pizzetta Gigacervello": a slice of pepperoni pizza with cheese dripping, standing on two tiny legs in roller skates, front view, arms out wide; the pepperoni slices are little pink brains, and its face (two big eyes and a screaming mouth) is in the middle of the slice.`,
  washer: `"Lavatrice Galattica": an old white front-loading washing machine standing on two scaly yellow chicken legs, front view, its round glass porthole shows a pink brain tumbling in soapy rainbow foam, two cartoon eyes above the porthole, a sock hanging out of the door.`,
  cloud: `"Nuvolone Piovicervelli": a fat dark-grey storm cloud with a sad pouting face and big teary eyes, front view, raining a shower of dozens of tiny pink brains instead of raindrops, a small lightning bolt shaped like a brain fold.`,
  dj: `"Tartaruga Discotecara": a green turtle standing upright, front view, whose shell is a big pink brain, wearing huge white headphones, scratching a black vinyl record on a small turntable with one flipper, the other flipper raised, sunglasses-free, wild happy eyes.`,
  // THE STATIONS' OWN CREATURES (operator, 2026-11-05: "make other, FITTING ones for the six circles"): each one says what its
  // station of the tax split does
  stburn: `"Cervello Piromane": a small pink brain creature with a wild hairdo of bright orange-yellow FLAMES on top, big crazy happy eyes, two little arms holding a giant lit match like a torch, tiny legs, front view.`,
  // $BOB is NOT a brain (operator, 2026-11-05: "$BOB is a stick-figure builder, not like BOBAI") — see NOBRAIN below
  stbobs: `"Costruttore Stecchino": a STICK-FIGURE BUILDER: a body drawn of thick glossy black sticks (thin stick arms and stick legs, a stick torso) with a big round plain white head, two big round cartoon eyes and a wide happy open-mouth grin, a shiny yellow construction hard hat on the head, standing proudly front view on top of a small wobbly stack of three yellow toy bricks, one stick arm raising a big chunky hammer high, the other giving a thumbs up. Absurd deadpan brainrot meme energy.`,
  stbob: `"Marshmallow Cerebrale":a toasted marshmallow shaped like a pink brain, its edges charred and on small flames, skewered on a long wooden stick, with a happy screaming face and two tiny arms waving, front view.`,
  stliq: `"Goccia Nuotatrice": a big clear glossy blue WATER DROPLET with a pink brain floating inside it, wearing swimming goggles and an orange rubber swim ring around its middle, splashing little drops, front view.`,
  stdefi: `"Contadino Robotico": a small round chrome robot farmer with a glass dome head that holds a pink brain, a straw hat on the dome, watering a little glowing green plant whose stem zigzags upward like a rising price line, front view.`,
  stgiggle: `"Pentola Ridarella": a chubby colorful candy pot overflowing with wrapped sweets, its lid is a pink brain lifted up, the pot laughing so hard with tears of joy and a huge open mouth, tiny legs kicking, front view.`,
  stcreator: `"Pittore Cervellone": a pink brain creature wearing a red beret and a striped shirt, holding a paint palette and a brush, splashes of bright paint on it, proud artist grin, front view.`,
  // the TRADES station gets its own creature too (operator, 2026-11-06: "the washing machine is great, it stays in the terminal,
  // but make a character for the trades like the other six"): every buy and sell pays 3 % at its till
  sttrade: `"Cassiere Cervellone": a chubby pink brain creature as a cheeky shop cashier, wearing a green see-through bank visor cap and arm garters, standing behind a tiny shiny retro cash register, one hand slamming its big key, a long paper receipt curling out that shows a big "3%", two gold coins and one green and one red candle-stick hopping on the counter, huge happy greedy eyes, front view.`,
  // the stage under BOBAI's feet (operator, 2026-11-05: "give BOBAI something to stand on again, like the gravestone, brainrot style")
  podium: `A wide, low, round stage platform seen from the front and slightly from above, so its flat top shows as a wide ellipse: the whole platform is a giant glossy PINK BRAIN, its top cut flat and smooth to stand on, deep brain folds around its sides, glowing neon-cyan and lime cracks running through the folds like synapses, a small mirrored disco ball half sunk into the front, three tiny winged brains with propeller hats perched on the rim, a few dripping drops of purple slime. No character standing on it.`,
  mini: `"Cervellino Elicottero": a tiny round pink brain with two little white angel wings, a propeller beanie hat (red, yellow, blue) on top, two big shiny eyes and a huge happy open mouth, flying, front view.`,
};
const FRAMES = {
  'stburn@flare': `The flames on its head are now twice as tall and wild, and the match is raised high. Nothing else changes.`,
  'stbobs@hammer': `The stick figure now swings the hammer DOWN onto the top brick, little yellow sparks and dust puffs fly, the bricks wobble, the mouth is wide open shouting. Nothing else changes.`,
  'stbob@flare':`The flames on the marshmallow are now bigger and it screams even louder with both arms up. Nothing else changes.`,
  'stliq@splash': `The droplet now leans to the other side with a big splash of water drops flying out. Nothing else changes.`,
  'stdefi@grow': `The little plant is now twice as tall, its zigzag stem climbing higher with a glowing tip, and the robot cheers with one arm up. Nothing else changes.`,
  'stgiggle@laugh': `The pot now leans back laughing even harder, the brain lid flies higher and a few sweets jump out. Nothing else changes.`,
  'stcreator@paint': `The brain now swings the brush wide with a big rainbow paint stroke in the air. Nothing else changes.`,
  'sttrade@ring': `The cash register drawer now flies open with a loud ring, gold coins and tiny pink brains spray out of it, the receipt shoots up long, the cashier laughs with both arms up. Nothing else changes.`,
  'octo@wave': `All eight spaghetti tentacles now curl the other way, waving, still holding the same objects; the eyes look up. Nothing else changes.`,
  'bulb@step': `The light bulb's legs are now in the opposite walking step and the brain inside glows much brighter with bigger sparks. Nothing else changes.`,
  'astro@reel': `The astronaut now pulls the rod up hard, the line is tight and the tiny planet swings high; the googly eyes look at it. Nothing else changes.`,
  'snail@blast': `The rocket flame is now twice as long and white-hot, and the snail's eye stalks are blown flat backwards. Nothing else changes.`,
  'fridge@shut': `The fridge door is now closed, the flamingo legs swapped (the other leg raised), and the eyes on the freezer door are closed in bliss. Nothing else changes.`,
  'sock@yell': `The sock's mouth is now open much wider, the megaphone raised higher, and the brain on top is bouncing up a little. Nothing else changes.`,
  'shrimp@kick': `The shrimp now kicks one leg high in the air like a can-can dancer, the other leg on tiptoe. Nothing else changes.`,
  'kaiju@blink': `All seven eyes now look in seven different directions and half of the tiny legs are lifted in a different step. Nothing else changes.`,
  'eyeball@look': `The eyeball's iris now looks hard to the RIGHT and the legs are in a different walking step. Nothing else changes.`,
  'duck@boost': `The foam spray from the soda bottles is now three times longer and wilder, and the duck's beak is wide open screaming. Nothing else changes.`,
  'banana@flex': `The banana now raises both arms straight up in victory, mouth wide open shouting. Nothing else changes.`,
  'pigeon@flap': `The pigeon's wings are now swept fully DOWN below the brain body instead of up. Nothing else changes.`,
  'cactus@dance': `The cactus now leans to the other side and its two arms are in the opposite disco pose. Nothing else changes.`,
  'pizza@scream': `The pizza slice now leans backwards on its skates with both arms thrown up, mouth even wider, eyes squeezed shut. Nothing else changes.`,
  'washer@spin': `The brain in the porthole is now turned upside down in the foam, the foam swirls the other way, and the chicken legs are in a different dancing step. Nothing else changes.`,
  'cloud@pour': `The cloud now squeezes its eyes shut and cries harder, and the rain of tiny brains is twice as dense. Nothing else changes.`,
  'dj@scratch': `The turtle now has the other flipper on the record and the raised flipper points up to the sky, head nodding to the other side. Nothing else changes.`,
  'mini@flap': `The little wings are now swept DOWN and the propeller blades are turned 90 degrees. Nothing else changes.`,
};
// the sky: the inside of a giant brain seen as a cosmos (opaque painting, laid over the night with a screen blend)
// the second sky (operator, 2026-11-05: "with the current background the brain does not show well" + a meme picture as a
// spur: louder, brighter): teal and orange against the pink brain, a darker calm band across the middle where the scene is
const SKY2 = `A wide, LOUD meme-poster outer-space sky: deep teal and electric-cyan nebula clouds, a huge glowing orange-gold sunset cloud bank along the bottom edge, a big ringed planet top left, a swirling neon-green and gold portal glowing far right, a shooting comet with a rainbow tail across the top, scattered stars, floating bubbles, small floating rocks; the MIDDLE BAND of the picture is calmer and darker deep teal so things in front of it stay readable. Ultra-saturated, glossy, high contrast. Absolutely NO pink, NO magenta, NO purple anywhere. No characters, no text, no logos.`;
// the third sky (operator, 2026-11-05 night: "the background needs much more sick brainrot style; the podium is fine")
const SKY3 = `A wide, UNHINGED brainrot meme sky, maximum chaos but with a calmer darker middle band: a melting teal and orange sunset sky where the clouds are shaped like giant brains, a huge cosmic eye looking out of a swirling neon-green portal, floating islands with tiny palm trees and disco balls, a comet with a rainbow tail, a ringed planet wearing big sunglasses, lightning bolts in electric cyan, giant floating spaghetti strands and rubber ducks drifting in space, stars and bubbles everywhere. Ultra-saturated, glossy, high contrast. NO pink and NO magenta in the sky itself (the brains in the clouds are orange-gold), no characters in front, no text, no logos.`;
const SKY = `A wide surreal cosmos that is the INSIDE OF A GIANT BRAIN: pink and magenta nebulae shaped like brain folds, galaxies made of glowing neurons with long branching dendrites, bolts of electric-cyan synapse lightning jumping between them, floating bubbles, deep violet-black space between. Ultra-saturated, glossy, no characters, no text, no logos.`;

const arg = process.argv[2] || '', quality = process.argv[3] || 'medium';
const [name, frame] = arg.split('@');
if ((!PROPS[name] && name !== 'sky' && name !== 'sky2' && name !== 'sky3') || (frame && !FRAMES[arg])) { console.error('unknown', arg, '— props:', Object.keys(PROPS).join(', '), ', sky'); process.exit(1); }
const SKYK = name === 'sky' || name === 'sky2' || name === 'sky3';
const size = SKYK || ['bulb', 'snail', 'duck', 'pigeon'].includes(name) ? '1536x1024' : '1024x1024';
const save = (b64, tag, t0) => { fs.mkdirSync(OUT, { recursive: true }); const f = path.join(OUT, `${tag}-${Date.now()}.png`); fs.writeFileSync(f, Buffer.from(b64, 'base64')); console.log(`saved ${path.basename(f)} in ${((Date.now() - t0) / 1000).toFixed(0)} s`); };

(async () => {
  const t0 = Date.now();
  if (frame) {
    const base = fs.readdirSync(OUT).filter((f) => new RegExp('^' + name + '-\\d+\\.png$').test(f)).sort().pop();
    if (!base) throw new Error('no base picture for ' + name);
    const fd = new FormData();
    fd.append('model', MODEL);
    fd.append('image[]', new Blob([fs.readFileSync(path.join(OUT, base))], { type: 'image/png' }), 'base.png');
    fd.append('prompt', `This is ONE FRAME of a short animation of the exact character in the provided picture. Reproduce the picture exactly — same character, same size, same position in the image, same colours, light and style, same transparent background — with only this change: ${FRAMES[arg]} NO text, NO letters, NO logos.`);
    fd.append('size', size); fd.append('quality', quality); fd.append('background', 'transparent'); fd.append('output_format', 'png'); fd.append('n', '1');
    console.log(`${MODEL} ${quality} · frame ${arg} (from ${base}) …`);
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}` }, body: fd });
    const text = await res.text(); if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    save(JSON.parse(text).data[0].b64_json, arg, t0); return;
  }
  const NOBRAIN = name === 'stbobs', style = NOBRAIN ? STYLE.replace(/A real-looking pink-tan BRAIN[^.]*\./, 'NO brain anywhere on this character.') : STYLE;
  const body = { model: MODEL, prompt: SKYK ? (name === 'sky3' ? SKY3 : name === 'sky2' ? SKY2 : SKY) : `${PROPS[name]}\n\n${style} ${ALONE}`, size, quality, n: 1, output_format: 'png', background: SKYK ? 'opaque' : 'transparent' };
  console.log(`${MODEL} ${quality} · ${name} ${size} …`);
  const res = await fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text(); if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  save(JSON.parse(text).data[0].b64_json, name, t0);
})().catch((e) => { console.error(arg, e.message); process.exit(1); });
