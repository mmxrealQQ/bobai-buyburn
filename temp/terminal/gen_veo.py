#!/usr/bin/env python3
"""
Real motion for the living BOBAI with Google Veo 3.1 (OpenAI ended its video API on 2026-09-24).
Start frame AND last frame are the same approved pose on a flat chroma green, so every clip ends where it
began (a seamless loop) and keys out cleanly. Output: anim/<pose>.mp4 (720x1280, 9:16).

Usage: python gen_veo.py saber [bull ...] [--fast] [--secs 4|6|8] [--force]
"""
import os, sys, base64, json, time, requests
from io import BytesIO
from PIL import Image
# IPv4 ONLY (2026-10-03: the run made no take and said nothing): IPv6 to googleapis drops most TLS handshakes on this
# line (1 of 4 pass, IPv4 4 of 4); curl and node fall back by themselves, requests does not and died with an SSLError
import socket, urllib3.util.connection
urllib3.util.connection.allowed_gai_family = lambda: socket.AF_INET

KEY = None
for line in open(r'd:/ai/fourmeme/.env', encoding='utf-8'):
    if line.startswith('GEMINI_API_KEY='):
        KEY = line.split('=', 1)[1].strip().strip('"').strip("'")
assert KEY, 'GEMINI_API_KEY not found in .env'
HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, '..', 'terminal-site', 'terminal', 'fig')
OUT = os.path.join(HERE, 'anim'); os.makedirs(OUT, exist_ok=True)
API = 'https://generativelanguage.googleapis.com/v1beta'
GREEN = (0, 177, 64)   # chroma green: far from his skin, the brain, the black hoodie and the gold
# BLUE SCREEN (2026-09-28, operator: the green liquidity pour): a take whose effect is green itself would be keyed out
# on green, so it is shot on blue from figure/hub-start-wide-blue.png; anim/<pose>.blue tells key_clip and trim_hub
BLUE_SCREEN = {'hub-liq-v2'}

BASE = ("Static locked-off camera: no camera movement, no zoom, no pan, no cut, no scene change. The background is a "
        "perfectly flat, evenly lit, solid chroma-key GREEN screen from edge to edge for the whole clip — no shadow on it, "
        "no floor, no scenery, no gradient, no light change. The character is EXACTLY the one in the image: the small kid "
        "whose head is a big glossy brain, in the black hoodie with gold-tipped drawstrings, black trousers and black "
        "sneakers with gold soles; same face, same eyes with the thin colored glitch lines, same size and position; "
        "his irises are ALWAYS the same warm amber-brown in every frame — never blue, never another colour, even in "
        "blue or colored light; "
        "exactly two arms and two legs, correct anatomy, he never turns into someone else. "
        "LIGHTING: the green background is only a flat backdrop — it emits NO light and casts NO green color onto him. "
        "His hoodie, trousers and sneakers stay DEEP MATTE BLACK in every single frame (never green, never tinted); he is "
        "lit only by warm golden studio light and by the light of his own effects. "
        "SOUND: silent clip, only soft ambient sound; nobody speaks, sings or says any word. ")
TAIL = (" Every object he holds stays exactly the same object the whole time (same shape, same material, same glow) — "
        "it never changes into something else and never disappears. Premium 3D animated-film character animation: smooth, "
        "expressive, full-body, with natural weight and "
        "follow-through. The clip ends in exactly the pose of the first frame so it loops seamlessly. No text, no logos, "
        "no new objects, no other characters.")

MOTION = {
    'idle': "He is alive and relaxed: breathes, shifts his weight from one foot to the other, blinks, looks around "
            "curiously, gives a small friendly wave with one hand, tilts his head with a warm smile, then settles back.",
    'saber': "He swings the glowing golden light-sword in two big, elegant, heroic arcs — a diagonal slash and a spin "
             "of the blade — his body turning with the swing, the blade humming and leaving bright golden light trails, "
             "then he returns to his guard pose with a confident smile.",
    'coffee': "He takes a slow, satisfied sip from the black mug, lowers it, exhales with pleasure and wiggles his "
              "shoulders happily, looks at the viewer with a content half-smile, then lifts the mug back to his lips.",
    'bull': "The golden bull bucks and gallops on the spot with powerful rhythmic strides, golden dust puffing from its "
            "hooves; he rides it like a rodeo champion, bouncing with each buck, one hand on the horn, the other fist "
            "circling in the air, laughing.",
    'build': "He carefully sets the glowing golden cube on top of the tower with a satisfying little tap, the tower "
             "glows brighter for a moment, he brushes his hands together, taps his golden hard hat with a proud grin and "
             "gives the viewer a thumbs up, then lifts the same cube again into the pose of the first frame.",
    'moon': "He shades his eyes, leans forward and scans the sky, then points up at the glowing crescent moon, bouncing "
            "on his toes with excitement and hope, nodding as if asking 'wen?'.",
    'hodl': "He plants his feet, clenches both sparkling diamond fists, flexes them with determination, bumps them "
            "together once with a bright crystal glint, and gives a firm confident nod to the viewer.",
    'cheer': "He jumps high with pure joy, both fists pumping in the air, spins around once in the air and lands, "
             "golden confetti sparks raining around him, laughing.",
    'laugh': "He laughs hard at his own joke: shoulders shaking, leaning back, slapping his knee once, wiping a tear, "
             "then points at the viewer still giggling.",
    'think': "He scrolls the phone with his thumb, zooms in with two fingers, raises an eyebrow, strokes his chin, "
             "glances at the viewer with a knowing look and nods slowly.",
    'shrug': "He shrugs twice with both palms up, shoulders bouncing, a playful 'it is what it is' face, a little "
             "side-to-side sway.",
    # 2026-09-26, operator: "real push-ups — the body goes up and down to the floor, like real push-ups look"
    'pushups': "He does three REAL push-ups, seen from the side like a fitness video: his whole body stays straight as a "
               "plank from head to heels, his elbows bend and his entire body lowers smoothly until his chest almost "
               "touches the floor, then his arms straighten and push his whole body back up — down, up, down, up, down, "
               "up, each rep clearly visible, the floor line under his hands and toes does not move. His hands and toes "
               "stay planted on the ground the whole time. Between reps he puffs his cheeks with comic effort, on the "
               "last rep he grins proudly at the viewer. He ends in exactly the high plank of the first frame.",
    'burn': "The blazing ball of fire in his hands swirls and grows, flames licking up, embers and sparks flying past "
            "his grinning face; he tosses it up just above his head and catches it again. The fireball and its flames "
            "stay fully inside the frame the whole time; the camera does not move.",
    'liq': "He pours the glowing GOLDEN liquid from the flask in a steady shimmering stream with bubbles, tilting "
           "the flask further with a satisfied focused smile, the stream splashing below. His brain-head keeps its "
           "natural warm pink-peach colour the whole time: the liquid glows gold and amber only, it casts no green or "
           "yellow-green light on him (re-shot 2026-09-26: the first take tinted his brain green).",
    'defi': "He works the blue hologram like a pro: swipes, taps, the gear spins and the gauge needle swings, the "
            "light flickers on his clever face, he nods, satisfied.",
    'giggle': "He tosses the glowing golden coin up, it spins and sparkles with pink and golden light, he catches it and "
              "drops it gently down with a warm, kind smile.",
    # the alert tiers (TG bot ladder): each a short hero moment that ends where it began
    'buy-nice': "He flips the golden coin high with his thumb, follows it with his eyes, catches it, winks and gives a "
                "cheeky thumbs up.",
    'buy-big': "He lifts the glowing diamond higher, turns it so it flashes brilliant white-blue light, admires it with "
               "delight and presents it proudly to the viewer.",
    'buy-huge': "The rocket roars and shakes, flames blasting, he holds on and pumps his fist, whooping with joy, sparks "
                "streaming past; the rocket stays in place in the frame (it hovers, it does not fly away).",
    'buy-whale': "The whale surges up and sways majestically, its blowhole blasts a tall glittering fountain of glowing "
                 "water, he balances on its back with arms wide open, laughing, droplets sparkling around him.",
    'buy-thunder': "He raises his fist and huge bolts of golden lightning strike down into it and branch out around him "
                   "again and again with bright flashes, electric arcs racing over his hoodie, he roars with excitement "
                   "— a thunderstorm of power, the camera stays still.",
    'buy-kraken': "The giant purple-and-gold kraken tentacles rise, swirl and curl powerfully around him in a mighty "
                  "wave, he conducts them like an orchestra with both arms, a legendary triumphant grin.",
    'burn-small': "The little flame on his fingertip dances and grows a bit, he blows on it gently so it flickers, then "
                  "it burns bright again; he smiles.",
    'burn-nice': "The candle flame flickers and rises taller, wax glowing, he watches it with a warm content smile and "
                 "lifts the candle a little like a toast.",
    'burn-big': "The volcano beside him erupts in bursts, glowing lava and embers shooting up, he jumps a little with "
                "excitement and points at it, the lava light pulsing on him.",
    'burn-mega': "The flaming skull in his hands roars and blazes, its flames swirling wildly, embers flying; he lifts "
                 "it to chest height and holds it with a fearless grin. The skull and ALL its flames stay well inside the "
                 "frame the whole time, never reaching the top edge; nothing is cut off; the camera does not move "
                 "(re-shot 2026-09-26: the first take tossed it out of the top of the frame).",
    'burn-apocalypse': "The blazing meteor streaks across the sky above him with a long fiery tail and bursts in a flash "
                       "of light behind him, he points and shields his eyes, thrilled, sparks raining down.",
    'burn-supernova': "The supernova between his hands flares and explodes outward in brilliant white-gold and violet "
                      "shockwave rings, star sparks bursting everywhere, his hoodie fluttering in the blast, an epic "
                      "radiant expression; then the light gathers back between his hands.",
    # AT REST (2026-09-26, operator: "sometimes he may just be calm for 20-30 s, stand there, blink, laugh"): from the
    # idle frame, almost no motion — the film of a calm moment, looped while nothing happens
    'rest': "He stands calm and relaxed in exactly the pose of the first frame, his hands staying where they are: he only "
            "breathes softly (a gentle rise and fall of the chest), blinks slowly twice, lets his eyes wander a little "
            "and settles into a small, warm, content smile. Almost no movement — a quiet, peaceful moment. "
            "Audio: a soft, warm ambient music pad only (2026-09-27: a near-silent clip was filtered for its audio "
            "three times).",
    'rest-v2': "He stands calm and relaxed in exactly the pose of the first frame, hands staying where they are: he blinks, "
               "then something amuses him — a silent amused smile, eyes crinkling, shoulders lifting lightly for "
               "a moment — and calms down again into a warm smile. Small, gentle movements only.",
    # MORE WAITING, MORE VARIETY (2026-09-30, operator: "the video where BOBAI does nothing comes after every sequence —
    # make 3-4 different ones, all with the same start and end as now"): four calm moments from the same standing frame
    # back to it (seal_ends.py seals first and last frame onto the one standing still). Small, slow, nothing conjured.
    'rest-v3': "He stands calm and relaxed in exactly the pose of the first frame: he looks slowly to one side, then to the "
               "other, curious, tilts his head a little, looks back at the viewer and gives a small friendly nod. His hands "
               "stay where they are; he ends in exactly the pose he started in. Small, gentle movements only.",
    'rest-v4': "He stands calm and relaxed in exactly the pose of the first frame: he lifts one hand briefly to straighten "
               "the drawstring of his hoodie, smooths the hoodie with a small satisfied look, and lets the hand return "
               "exactly to where it was. He ends in exactly the pose he started in. Small, gentle movements only.",
    'rest-v5': "He stands calm and relaxed in exactly the pose of the first frame: he rocks softly on his heels once, "
               "hums a little tune with his mouth closed, eyes half shut with a happy face, then stands still again "
               "exactly as he began. His hands stay where they are. Small, gentle movements only.",
    'rest-v6': "He stands calm and relaxed in exactly the pose of the first frame: he looks up for a moment as if he heard "
               "a new block arrive, raises his eyebrows, smiles to himself and looks back at the viewer, calm. His hands "
               "stay where they are; he ends in exactly the pose he started in. Small, gentle movements only.",
    # SHORT CALM MOMENTS (2026-10-11, operator chose "new 4-s rest takes"): every reaction waits for the rest take
    # playing to end (a take is never cut) — 8 s takes meant ~4 s, up to 8 s, before he answers (flowlag.mjs). Six 4 s
    # moments, one small thing each, from the standing frame back to it: `python gen_veo.py rest-v7 --secs 4`
    'rest-v7': "He stands calm and relaxed in exactly the pose of the first frame: he blinks once, slowly, and gives a tiny "
               "warm smile. His hands stay where they are; he ends in exactly the pose he started in. Very small, gentle movement only.",
    'rest-v8': "He stands calm and relaxed in exactly the pose of the first frame: he breathes in deeply and out again, his "
               "shoulders rising and settling softly. His hands stay where they are; he ends in exactly the pose he started in. "
               "Very small, gentle movement only.",
    'rest-v9': "He stands calm and relaxed in exactly the pose of the first frame: his eyes glance to the side for a moment and "
               "come back to the viewer. His hands stay where they are; he ends in exactly the pose he started in. Very small, "
               "gentle movement only.",
    'rest-v10': "He stands calm and relaxed in exactly the pose of the first frame: he tilts his head a little to one side, "
                "curious, and straightens it again. His hands stay where they are; he ends in exactly the pose he started in. "
                "Very small, gentle movement only.",
    'rest-v11': "He stands calm and relaxed in exactly the pose of the first frame: a short, silent, amused smile, his eyes "
                "crinkling, then calm again. His hands stay where they are; he ends in exactly the pose he started in. Very "
                "small, gentle movement only.",
    'rest-v12': "He stands calm and relaxed in exactly the pose of the first frame: he shifts his weight softly from one foot "
                "to the other and back. His hands stay where they are; he ends in exactly the pose he started in. Very small, "
                "gentle movement only.",
    # quiet market (2026-09-26, operator: "he can walk, build, dance — BOBAI loves to dance, like in our GIFs")
    'dance': "He dances a groovy, funny dance on the spot: disco points up and down with one finger, hips swinging to "
             "the beat, a couple of quick side steps, a little shoulder shimmy and a playful spin on one heel, grinning "
             "and having the time of his life; the golden sparkles swirl with him. He ends in exactly the pose of the "
             "first frame.",
    'dance-v2': "He does a smooth, funny moonwalk: sliding backwards on the spot with gliding steps, then a quick "
                "toe-stand, a hat-less head nod to the beat and a cheeky finger point to the viewer, grinning, before "
                "returning to the disco pose of the first frame. He stays in the same place in the frame.",
    'walk': "He walks cheerfully ON THE SPOT like on an invisible treadmill: natural steps, arms swinging in rhythm, a "
            "little bounce in every step, looking around happily and giving the viewer a friendly nod; he never moves "
            "away from his place in the frame and ends in exactly the stride of the first frame.",
    # SECOND TAKES (2026-09-26, operator: "make him livelier, so he does not always do the same — maybe 2 variants
    # for every action"): the same start frame as the pose, another motion; the terminal alternates between them
    'idle-v2': "He stretches both arms up high with a big playful yawn, rolls his shoulders, blinks awake, looks at the "
               "viewer with a cheeky grin and settles back into the relaxed stance.",
    # MORE THAN ONE HELLO (2026-10-02, operator: "the greeting is almost always the same"): the greeting's wave was one
    # take; these two are waves too (the stretch idle-v2 stays apart), hands never in front of his face
    'idle-v3': "He looks at the viewer, his face lights up, and he waves hello with his right hand raised high in three "
               "big happy waves, then adds his left hand for a quick two-handed wave, smiles warmly and settles back into "
               "the relaxed stance with his arms open.",
    'idle-v4': "He gives the viewer a cheerful little two-finger salute from the side of his brow, then a small friendly "
               "bow, comes back up with a big grin and waves once with his right hand, then settles back into the relaxed "
               "stance with his arms open.",
    'think-v2': "He reads the phone, his eyes widen in surprise, he taps the screen twice quickly, nods impressed with "
                "raised eyebrows, then holds the phone as before, a satisfied little smile.",
    'burn-v2': "He juggles the blazing ball of fire from one hand to the other in a smooth arc, flames trailing, embers "
               "sparkling, grinning with focus, and ends holding it as in the first frame. The fire stays fully inside "
               "the frame; the camera does not move.",
    'liq-v2': "He holds the flask at chest height, swirls it gently so the liquid inside spins and sparkles, looks at "
              "it with a satisfied smile, then tilts it and pours a short shimmering splash downward. The flask stays "
              "BELOW his face the whole time and never glows brighter than in the first frame; his brain-head keeps its "
              "natural warm pink-peach colour in every frame, never yellow, never gold, never green (the first take "
              "turned his brain yellow when he held the glowing flask next to his face, 2026-09-26).",
    'defi-v2': "He spreads two fingers to zoom the blue hologram bigger, turns the glowing gear with one fingertip, the "
               "gauge needle climbs, he gives a small fist pump and a clever wink, then returns to the first pose.",
    'cheer-v2': "He does a short happy victory dance: two quick side steps, hips swinging, arms rolling like a disco "
                "move, a spin on one heel, laughing, golden confetti sparks drifting down.",
    'buy-nice-v2': "He rolls the golden coin across the knuckles of one hand, flicks it up, catches it with the other "
                   "hand, blows on it for luck with a wink and shows it to the viewer.",
    'giggle-v2': "He balances the glowing golden coin spinning upright on one fingertip, pink and golden sparkles "
                 "circling it, he giggles softly, then catches it in his palm with a warm kind smile.",
    'laugh-v2': "He tries to hold back a giggle, covering his mouth with one hand, shoulders shaking, then bursts out "
                "into a big happy belly laugh holding his tummy, and points at the viewer.",
    'build-v2': "He polishes the glowing golden cube with his sleeve until it gleams, sets it carefully on top of the "
                "tower, steps back a little, admires the tower with his hands on his hips and nods proudly.",
    'coffee-v2': "He blows gently on the hot coffee so a curl of steam swirls up, takes a careful sip, his eyes close in "
                 "pure bliss, and he gives the viewer a relaxed thumbs up with the other hand.",
}
# ONE FIGURE, ONE FLOW (2026-09-26, operator: "like a film - he cannot suddenly be doing push-ups; there must always be
# one in-between pose everything starts from, 24/7 the same figure"): hub-<move> clips start AND end in his standing
# pose (figure/hub-start.png = the first frame of anim/idle.mp4, the still the terminal shows). A prop appears out of
# golden sparkles (or his hoodie pocket) and is gone again before the end, so every move leaves the pose and comes home.
HUB_HEAD = ("He starts standing relaxed in exactly the pose of the first frame (arms open, hands empty, feet on the "
            "ground, facing the viewer). ")
HUB_TAIL = (" Then he smoothly and naturally returns to exactly the standing pose of the first frame: the same spot, the "
            "same size, arms open, hands empty, facing the viewer. One continuous take, the transitions into and out of "
            "the move are fluid and physical (weight shifts, anticipation, follow-through), never a jump or a cut. "
            "Any object appears only as described and is completely gone before the end. Premium 3D animated-film "
            "character animation: smooth, expressive, full-body, with natural weight. No text, no logos, no other characters.")
HUB = {
    'think': "He takes a black smartphone out of his hoodie pocket, silently scrolls it with his thumb, zooms in with two fingers, "
             "raises an eyebrow, strokes his chin, nods slowly and slips the phone back into the pocket.",
    'coffee': "A black coffee mug appears in his hand in a small puff of golden sparkles, steam curling up; he takes a slow, "
              "satisfied sip, exhales with pleasure, wiggles his shoulders happily, and the mug fades away in golden sparkles.",
    'laugh': "Something amuses him: he chuckles, then laughs hard, shoulders shaking, leaning back, slapping his knee once, "
             "wiping a tear, still giggling as he straightens up.",
    'dance': "He starts a groovy, funny dance on the spot: disco points up and down with one finger, hips swinging to the "
             "beat, a quick side step each way, a shoulder shimmy and a playful spin on one heel, grinning.",
    'walk': "He walks cheerfully ON THE SPOT like on an invisible treadmill: natural steps, arms swinging in rhythm, a "
            "little bounce in every step, looking around happily, then slows down and stops.",
    'pushups': "He drops forward onto both hands into a straight plank, seen from the side like a fitness video, and does "
               "three REAL push-ups: his whole body straight from head to heels lowers until his chest almost touches the "
               "floor, then pushes back up - down, up, down, up, down, up, each rep clearly visible, puffing his cheeks with "
               "comic effort; then he pushes off, jumps back onto his feet with a proud grin and dusts off his hands.",
    'build': "A glowing golden hard hat and a glowing golden cube appear in golden sparkles; he puts on the hat, sets the "
             "cube on a small stack of golden cubes that grows beside him with a satisfying tap, the tower glows, he "
             "brushes his hands together and gives a thumbs up; then hat and tower dissolve into golden sparkles.",
    'shrug': "He shrugs twice with both palms up, shoulders bouncing, a playful it-is-what-it-is face, a little "
             "side-to-side sway.",
    'hodl': "He plants his feet, both fists turn into sparkling diamond fists, he flexes them with determination, bumps "
            "them together once with a bright crystal glint, gives a firm nod, and the diamond sparkle fades from his hands.",
    'moon': "He shades his eyes with one hand, leans forward and scans the sky, then points up excitedly, bouncing on his "
            "toes with hope and a hopeful, questioning look, without a word.",
    'cheer': "He jumps up with pure joy, both fists pumping in the air, golden confetti sparks raining around him, lands "
             "softly, laughing.",
    'saber': "A glowing golden light-sword ignites in his hand out of golden sparkles; he swings it in two elegant heroic "
             "arcs leaving golden light trails, then the blade retracts into sparkles and vanishes.",
    'bull': "A glowing golden bull made of light gallops in from golden sparkles, he hops onto it and rides a few rodeo "
            "bucks, one fist circling in the air, laughing; he hops off and the bull dissolves into golden dust.",
    # re-shot 2026-09-28: the first wide take tossed the fireball out of the top of the frame
    'burn': "A blazing ball of fire bursts into life between his hands at chest height, flames licking up, embers flying "
            "past his grinning face; he bounces it gently from one hand to the other, never higher than his head, then "
            "closes his hands and the fire goes out in a puff of glowing embers. The fire stays well inside the frame, "
            "close to him, the whole time.",
    'liq': "A glass flask of glowing GOLDEN liquid appears in his hand in sparkles; he pours a steady shimmering stream "
           "downward with a focused smile, then the flask fades away. The flask stays BELOW his face; his brain-head keeps "
           "its natural warm pink-peach colour in every frame, never yellow, gold or green.",
    # SECOND TAKES (operator 2026-09-28: "every action at least 2 different videos"): each one a different moment of the
    # same action, not the same one again, so he never looks like a loop
    'think-v2': "He pulls his black smartphone out, reads something, his eyes widen in surprise, he taps the screen twice "
                "quickly, nods impressed with pursed lips and slides the phone back into his pocket.",
    'coffee-v2': "A black coffee mug appears in his hand in golden sparkles; he blows on the hot coffee, takes a tiny careful "
                 "sip, it is too hot, he fans his mouth with his free hand and laughs at himself, then the mug fades away.",
    'dance-v2': "He does a little robot dance: stiff arm moves in rhythm, a head tilt left and right, a moonwalk slide back "
                "and forward on the spot, then snaps into a cool pose with a grin.",
    'walk-v2': "He strolls ON THE SPOT like on an invisible treadmill, hands relaxed in his hoodie pocket, whistling without "
               "sound, nodding to an imaginary passer-by, then slows down and stops.",
    'pushups-v2': "He does three quick squats with his arms stretched forward, then flexes both biceps like a bodybuilder with "
                  "a proud comic face, puffs his cheeks and shakes out his arms.",
    'build-v2': "A glowing golden hard hat appears on his head in sparkles; a glowing golden brick appears in his hands, he "
                "places it on an invisible wall in front of him with care, taps it into place twice with his fist, admires "
                "it and wipes his forehead; hat and brick dissolve into golden sparkles.",
    'shrug-v2': "He spreads his arms wide with a big comic sigh, tilts his head, rolls his eyes playfully and lets his arms "
                "drop with a good-natured smile.",
    'hodl-v2': "He clutches an invisible bag tightly to his chest with both arms, shakes his head firmly no to someone "
               "off-screen, hugs it even tighter with a stubborn grin and a single diamond sparkle glints on it.",
    'moon-v2': "He cups both hands around his eyes like binoculars and looks up and around the sky, gasps, points up with both "
               "hands and does a small hopeful hop.",
    'cheer-v2': "He punches the air with one fist, does a quick little victory shuffle with his feet and claps his hands "
                "twice with a huge smile, a few golden sparks popping around him.",
    'saber-v2': "A glowing golden light-sword ignites in his hand; he twirls it once around his wrist, holds it up in a "
                "heroic salute in front of his face, then the blade retracts into sparkles and vanishes.",
    'bull-v2': "A glowing golden bull made of light trots in beside him from sparkles; he pats its neck proudly, it nuzzles "
               "him, he laughs and it dissolves into golden dust.",
    'defi-v2': "A blue hologram screen appears in front of him with a rising chart; he zooms into it with two fingers, gives "
               "a small fist pump and a wink, and the hologram folds away into light. "
               "Audio: soft, clean interface blips and a calm electronic hum only.",
    'giggle-v2': "A glowing golden coin appears in his hand; he rolls it over his knuckles from finger to finger, drops it "
                 "into his other palm, shows it to the viewer with a warm smile and it vanishes in pink and golden sparkles.",
    'burn-small-v2': "He snaps his fingers and a small flame lights on his thumb like a lighter; he admires it, it flickers, "
                     "he closes his hand and it goes out in a tiny puff.",
    'burn-nice-v2': "A small fireball appears in his hand; he juggles it playfully from one hand to the other twice, catches "
                    "it and closes his hand, the fire goes out in a puff of embers. All fire stays close to him.",
    'buy-nice-v2': "A small golden coin drops from above into his open hand; he bites it like a pirate testing gold, grins "
                   "and gives a thumbs up, and the coin vanishes in a sparkle.",
    'buy-big-v2': "A sparkling diamond appears in his hand; he polishes it on his hoodie, holds it up to his eye like a "
                  "jeweller with a delighted face, and it dissolves into sparkles.",
    # second takes of the big alert tiers: the same motif, another moment of it; everything inside the frame, his head
    # and face never covered or replaced, his hoodie deep black (no warm fire light on it)
    # 2026-09-29: every flame so far coloured his clothes (warm -> brown, blue -> blue). This rocket has NO fire at all:
    # a cartoon toy that puffs white cloud-smoke, so nothing lights him in a colour
    'buy-huge-v2': "A small shiny golden toy rocket appears on his open palm in sparkles; he counts down on the fingers of "
                   "his other hand, 3-2-1, and it lifts off with fluffy WHITE cartoon cloud puffs instead of fire (no flame, "
                   "no glow, no coloured light), zips up to just above his head, loops once leaving a white cloud trail and "
                   "pops into golden sparkles; he cheers and pumps his fist. It never leaves the frame.",
    'buy-whale-v2': "A friendly glowing blue whale swims through the air in a small circle around him at waist height, "
                    "he pats its head as it passes, it blows a small glittering fountain, he laughs, and it fades away.",
    'buy-thunder-v2': "He claps his hands together once and a crackle of golden electricity arcs between his palms; he "
                      "pulls his hands apart and the lightning dances between them, his eyes shine with excitement, then "
                      "he closes his hands and the storm is gone. The lightning stays between his hands.",
    'buy-kraken-v2': "Two purple-and-gold kraken tentacles rise from the ground on either side of him, he high-fives both "
                     "tips with a triumphant laugh, they wave and sink back into the ground.",
    'burn-big-v2': "Glowing lava bubbles up in a small pool at his feet; he hops over it from one side to the other with a "
                   "playful jump, a few embers pop up to his knees, and the pool cools and sinks away. Everything stays "
                   "low, close to him and inside the frame.",
    'burn-mega-v2': "A ring of flames lights up on the ground around his feet and rises to his waist; he stands calm in the "
                    "middle, arms crossed with a fearless grin, then snaps his fingers and the ring dies down into embers. "
                    "His hoodie stays deep black; the flames stay low and inside the frame.",
    'burn-apocalypse-v2': "Small fiery meteors streak down in the background behind him, he watches them over his shoulder, "
                          "then turns to the viewer, shields his eyes from a bright flash and gives a thumbs up as the "
                          "sparks fade. Nothing covers his face.",
    'burn-supernova-v2': "A tiny bright star forms above his open palm, he raises it slowly, it pulses and blooms into a "
                         "small radiant sun with violet rings that stays at the size of his head beside him, then it "
                         "shrinks back into his hand and goes out.",
    # the laugh with the pointing finger (operator 2026-09-28: "that one is top") as a hub take, so it flows
    'laugh-v2': "Something the viewer did amuses him: he bursts out laughing, bends forward holding his belly with one hand, "
                "shakes with laughter, then straightens up and points at the viewer with a playful grin and a wink, still "
                "chuckling. His eyes stay the same warm amber-brown the whole time.",
    # third takes of the most-seen clips (2026-09-30): the laugh plays with every joke, coffee and think are the calm
    # market's everyday moves. No glowing light, no phone (defi-v3 has one), nothing near his face
    'laugh-v3': "He snorts with laughter, covers his mouth with one hand, fails to hold it in and doubles over laughing, "
                "then waves one hand in the air like 'stop, stop', straightens up breathless and wipes a tear with a "
                "finger, grinning at the viewer. His eyes stay warm amber-brown, his hoodie deep black.",
    'coffee-v3': "A black coffee mug appears in his hand in a small puff of golden sparkles; he holds it with both hands at "
                 "chest height, blows on it, takes a careful sip, his eyes go wide at how hot it is, he fans his mouth "
                 "with one hand, laughs at himself, and the mug fades away in golden sparkles. The mug stays below his face.",
    'think-v3': "He looks up and to the side, taps his temple slowly with one finger, squints as if doing hard maths, "
                "counts something on his fingers, then his face lights up with an idea and he snaps his fingers with a "
                "confident nod. No phone, no objects, nothing glowing.",
    # THE NFT MOMENT (operator 2026-09-28: "a video of BOBAI creating an NFT — painting it, like a street artist"):
    # plays when a buy's NFT is minted (the terminal's NFT card scene)
    # re-shot 2026-09-29: the first take stood the easel to his right, and in the wide framing there are only ~108 px
    # beside him — easel and card ran out of the frame in 56 of 62 frames. The card now floats in front of his chest.
    'nft': "Like a cheerful street artist, he conjures a small blank trading card that floats in the air in front of his "
           "chest, a little to his right, always completely inside the frame with clear space around it, never in front "
           "of his face; with a small glowing brush he paints it in quick, confident strokes, little violet and gold "
           "sparkles fly off the card, he tilts his head to admire it, turns the finished card toward the viewer with a "
           "proud grin, and it dissolves in violet and golden sparkles. No easel. His brain-head keeps its natural warm "
           "pink-peach colour, his eyes stay warm amber-brown, his hoodie stays deep black; the paint never touches his face.",
    # second takes planned 2026-09-29, shaped by the day's failures: small, low, in front of his chest, fully in the frame
    'nft-v2': "A glowing golden picture frame appears floating in front of his chest, a little to his right, completely "
              "inside the frame; with one fingertip he draws a brain-shaped doodle into it in glowing violet light lines, "
              "it fills with colour and becomes a shiny trading card, he flips it around once with a proud grin, and it "
              "bursts into violet and golden sparkles. Never in front of his face.",
    'burn-v2': "A small glowing fireball the size of an orange appears in his palm; he tosses it from one hand to the "
               "other in a LOW arc at chest height, never higher than his shoulders, grinning, then closes his fist "
               "around it and it goes out in a puff of golden sparks. Everything stays small and well inside the frame.",
    # for the launch morning, 2026-10-01 (operator 2026-09-30: "the liq where he pours from the flask should make a
    # puddle below" / "on one burn he only stands on a yellow spot"): the pour now visibly lands and spreads; the lava is
    # dark cracked rock with glowing cracks, never a flat yellow disc. Hoodie deep black (fix_hoodie --body --top .5 if not)
    'liq-v3': "A round glass flask of glowing GOLDEN liquid appears in his hand in golden sparkles; he tilts it and pours a "
              "steady shimmering golden stream down onto the ground right in front of his feet, where it splashes and "
              "spreads into a small round glowing golden PUDDLE that stays on the ground and grows while he pours; he "
              "watches it with a pleased smile, then flask and puddle fade away in golden sparkles. The flask stays below "
              "his face; the puddle stays close to his feet, fully inside the frame. His hoodie stays deep matte black; "
              "only the liquid glows.",
    'burn-big-v3': "The ground around his feet cracks open into a small circle of dark volcanic rock with glowing orange-red "
                   "cracks, like cooling lava; a few bubbles of molten lava pop up between the rocks, he takes one step back "
                   "with a surprised grin and fans the heat away with his hand, then the cracks cool down to dark stone and "
                   "fade. Dark rock with thin glowing cracks, never a flat yellow disc. Everything low, near the ground, fully "
                   "inside the frame. His hoodie stays deep matte black.",
    # 2026-10-01 re-shoot: v3 had the right rock, but the slab spread to the sides of the picture (edge_scan: right edge in
    # 31/62 frames). The patch is now named small, round, under his shoes, with empty floor around it
    'burn-big-v4': "Right under his shoes the ground cracks into a SMALL ROUND patch of dark volcanic rock, no wider than his "
                   "shoulders, with thin glowing orange-red cracks like cooling lava; two small bubbles of molten lava pop "
                   "between the stones, he hops back half a step with a surprised grin and fans the heat away with one hand, "
                   "then the cracks cool to dark stone and the patch fades. Around the patch the floor stays empty plain "
                   "background; the patch never reaches the sides or the bottom of the picture. Dark rock with thin glowing "
                   "cracks, never a flat yellow disc. His hoodie stays deep matte black.",
    # 2026-10-01 evening (operator: "the defi video is still slightly faulty, the whale flying in the air is wrong — the
    # whale coming from below is perfect — and the kraken could be much nicer and more spectacular; free hand, it just
    # has to be super nice"). Every take keeps all coloured light below his shoulders and nothing ever in front of his face.
    'defi-v4': "A small friendly golden robot helper the size of a cat rolls in beside his right foot out of golden "
               "sparkles, carrying a tiny tray with two stacked shiny coins; he bends his knees a little and they bump "
               "fists, the robot does a happy little spin and beeps, he gives the viewer a thumbs-up with a proud grin, and "
               "the robot vanishes in golden sparkles. Everything stays low, near the ground; no light near his head; his "
               "brain-head keeps its natural warm pink-peach colour, his eyes stay warm amber-brown, his hoodie stays deep "
               "matte black.",
    'buy-whale-v3': "A huge friendly whale with a glossy blue-grey back rises up from below the bottom of the picture right "
                    "under his feet and lifts him a little on its broad back; he surfs on it with arms wide, laughing, its "
                    "blowhole behind him blasts a tall glittering fountain of golden water, droplets sparkle all around; "
                    "then the whale sinks back down below the picture and he lands softly on his feet. His face stays "
                    "clear and warmly lit the whole time, his hoodie deep matte black.",
    'buy-kraken-v3': "Behind him a giant majestic kraken rises out of glowing dark water at the bottom of the picture: huge "
                     "purple-and-gold tentacles with golden suckers curl up high on both sides of him and its big friendly "
                     "golden eyes appear far behind his shoulders; he raises both arms like a champion, the tentacles swirl "
                     "in a powerful spiral around him without ever touching or covering his face, golden sparks fly; then "
                     "everything sinks back into the water and the water fades away. His face stays clear, his hoodie deep "
                     "matte black, his brain-head its warm pink-peach colour.",
    'buy-kraken-v4': "A purple-and-gold kraken tentacle as thick as a tree trunk bursts up from below the picture on his left "
                     "and a second one on his right; they curl high above his head and meet in a golden crown-shaped arch, "
                     "he points up at it with a huge proud grin as shiny golden coins rain down around him, then the "
                     "tentacles slide back down below the picture. Nothing ever covers his face; his hoodie stays deep matte "
                     "black, his brain-head its warm pink-peach colour.",
    # third takes of the calm market's everyday moves (2026-09-30, for the launch morning: chill / bored / patient /
    # stubborn show shrug, walk, hodl, moon most). No glowing coloured light near his head, no phone, nothing over his face
    'shrug-v3': "He looks at the viewer, raises both palms up in a big friendly shrug with his eyebrows high, puffs his "
                "cheeks, then lets out a small laugh and lets his arms drop back to his sides, relaxed.",
    'walk-v3': "He marches ON THE SPOT with big proud steps like in a small parade, swinging his arms, chin up with a cheeky "
               "grin, then stops with a neat little heel click and stands relaxed again.",
    'hodl-v3': "He crosses his arms firmly over his chest, plants his feet wide, shakes his head slowly with a confident "
               "smirk as if someone asked him to sell, then taps his chest twice with his fist and nods.",
    'moon-v3': "He shades his eyes with one hand and scans the sky, then points up excitedly with his other hand, bounces "
               "on his toes twice with a hopeful grin, and lowers his hands again with a happy sigh.",
    'giggle-v3': "A small golden coin appears in his hand in a few golden sparkles; he flips it with his thumb, it spins up "
                 "to shoulder height, he catches it on the back of his hand, peeks at it with a delighted grin, and it "
                 "vanishes in soft pink and golden sparkles. The coin stays below his face.",
    'pushups-v3': "He does three energetic jumping jacks, then flexes one arm like a strongman, kisses his biceps with a "
                  "comic wink and shakes his arms out, relaxed.",
    # re-shot 2026-09-30: defi-v2 put a glowing blue chart screen over his head (brain purple) and nft-v2 a glowing
    # picture over his whole face. Every take that went wrong had GLOWING COLOURED LIGHT near his head. These two use
    # solid objects held low in his hands, lit like everything else in the scene, nothing glowing near his face.
    'defi-v3': "He pulls a small shiny golden smartphone out of his hoodie pocket and holds it low at his waist with both "
               "hands, taps the screen twice with his thumb, looks down at it and grins, gives the viewer a quick nod "
               "and slides the phone back into his pocket. The phone never rises above his chest and gives off no "
               "coloured light; his brain-head keeps its natural warm pink-peach colour, his eyes stay warm "
               "amber-brown, his hoodie stays deep black.",
    'nft-v3': "He takes a small golden trading card out of his hoodie pocket, holds it at waist height with both hands "
              "like a collector showing a rare card, blows on it once so it shines with a soft golden glint, turns it "
              "toward the viewer with a proud grin and a wink, and tucks it back into his pocket. The card stays small, "
              "below his chest and never in front of his face; nothing glows in colour; his brain-head keeps its "
              "natural warm pink-peach colour, his eyes stay warm amber-brown, his hoodie stays deep black.",
    # a second way of BUILDING (operator 2026-09-28: the hard hat with the blocks comes too often)
    'build-v3': "A glowing golden holographic keyboard appears in front of his chest; he types fast and happily, lines of "
                "golden code float up beside him to his RIGHT (never over his face) and click together into one small "
                "glowing cube, he gives the cube a satisfied tap, nods, and it fades away in golden sparkles. His face "
                "and brain stay lit warm and keep their natural colour, his eyes stay warm amber-brown.",
    # 2026-10-02 (operator: "every action at least two videos; free hand and imagination for the credit"): every action
    # has two already, so third takes for what plays most — the burn run, the small buys, the saber, the bull — and a
    # defi take with the robot helper that leaves the way it came (defi-v4 vanished in a blotchy sparkle cloud). Same
    # rules as every take since 30.9.: no coloured glow near his head, nothing ever in front of his face.
    'defi-v5': "A small friendly golden robot helper the size of a cat rolls in along the ground from the right side of the "
               "picture to beside his right foot, holding up one tiny shiny coin; he bends his knees a little, takes the "
               "coin and they bump fists; the robot does a happy little spin and rolls back out of the picture to the "
               "right the same way it came. No sparkle cloud, no smoke, no light on the floor; everything stays low near "
               "the ground; his brain-head keeps its natural warm pink-peach colour, his eyes stay warm amber-brown, his "
               "hoodie stays deep matte black.",
    'burn-v3': "He holds out his open right hand at chest height and a ball of golden-orange fire ignites above his palm; "
               "he tosses it gently up once to shoulder height, catches it, then closes his fist and it goes out in a puff "
               "of embers that drift down and fade; he gives a satisfied nod. The fire never rises above his shoulders.",
    'saber-v3': "A glowing golden light-sword ignites in his right hand; he does a quick playful fencing routine — a lunge "
                "forward, a parry, a spin — then holds it up beside him in a heroic salute, never in front of his face, "
                "and it switches off and vanishes in a few golden sparkles.",
    'buy-nice-v3': "He spots a shiny golden coin on the ground in front of his feet, picks it up, polishes it on his "
                   "hoodie, holds it up at chest height toward the viewer with a proud grin and slips it into his hoodie "
                   "pocket.",
    'bull-v3': "A glowing golden bull made of light trots in beside him out of golden sparkles; he swings onto its back, it "
               "rears up proudly once while he waves one hand in the air like a rodeo rider, then he hops down beside it "
               "and the bull dissolves into golden sparkles. The bull stays fully inside the picture.",
    'dance-v3': "He does a fun little hip-hop dance on the spot: two quick shoulder bounces, a spin on one heel, a step "
                "to each side, and ends with both arms crossed and a cool nod.",
    'cheer-v3': "He claps his hands three times with a huge smile, throws both arms up in a big happy 'yes!' and does a "
                "small hop, a few golden confetti sparkles drifting down beside him, never in front of his face.",
    'giggle-v4': "A small golden coin appears in his hand; like a magician he makes it disappear behind his back, then pulls "
                 "it out from behind his ear with a delighted giggle, and it vanishes in a few soft golden sparkles. No "
                 "pink burst, nothing ever covers his head; his brain-head keeps its natural warm pink-peach colour, his "
                 "hoodie stays deep matte black.",
    'nft-v4': "He takes a small golden trading card out of his hoodie pocket, flips it between two fingers like a magician "
              "at waist height, shows its shiny back to the viewer with a proud grin and slides it back into his pocket. "
              "The card stays small, below his chest, never in front of his face; nothing glows in colour.",
    'buy-big-v3': "A sparkling diamond the size of an apple appears in his hands at chest height out of golden sparkles; "
                  "he turns it so it glints softly, winks at the viewer and tucks it into his hoodie pocket. No bright "
                  "flash, no light near his face.",
    # 2026-10-05 (operator: "only a new kraken, thunder and huge — but they must be perfect"): every past flaw of these
    # tiers was light ON him (rocket fire browned/blued the hoodie, lightning lit his face) or the effect over his face /
    # off the edge. So: no fire, no flash, the effect a hand's width beside or behind him, he stays the star.
    'buy-huge-v3': "A shiny golden rocket as tall as his knee lands upright on the floor beside him to his right out of soft "
                   "golden sparkles; he counts down on the fingers of one hand, three, two, one, and it lifts off with a "
                   "soft puff of WHITE vapour (no fire, no flame, no glow) and shoots straight up out of the top of the "
                   "picture leaving a thin trail of golden sparkles; he shields his eyes, looks up after it and cheers "
                   "with both fists. The rocket and its trail stay beside him, never in front of him or his face; no "
                   "flash; his hoodie, trousers and sneakers stay deep matte black.",
    'buy-thunder-v3': "A small fluffy dark storm cloud the size of a pillow floats in beside him at shoulder height to his "
                      "right, a hand's width away from his head; it rumbles and drops three short, thin golden lightning "
                      "zaps straight down into the floor beside his right foot with a crackle of tiny golden sparks; he "
                      "jumps back in surprise, then grins, pokes the little cloud with one finger and it puffs away into "
                      "golden sparkles. The zaps stay small and beside him, they never touch him and never flash over "
                      "his face; his face and brain keep their natural warm colour, his hoodie stays deep matte black.",
    # 2026-10-05 second try: thunder-v3 browned his hoodie under bright bolts and ended in a sparkle cloud over his body;
    # huge-v3's white vapour plume glowed like fire beside his head and browned the hoodie too. Now nothing bright, the
    # effect an ARM'S length away, and it leaves by moving away (up and out of the picture), never by dissolving on him.
    # 2026-10-05 third round (operator: "thunder much stronger, it is a buy over $1k — Dragon Ball Z style; the kraken
    # must be worthy of the $2.5k biggest alert"; huge stays E3 = huge-v3): BIG now — the face rule stays (face and eyes
    # always clearly visible, nothing in front of them); a tinted hoodie is fixed afterwards (fix_hoodie --body)
    'buy-thunder-v5': "Like a Dragon Ball Z power-up: he plants his feet wide, clenches both fists at his hips and powers "
                      "up with a determined shout — a blazing golden aura flares up around his body like flames, crackling "
                      "golden lightning arcs dance through the aura, small stones on the floor lift up and float around "
                      "his feet, the air trembles; at the peak the aura bursts outward in a ring of golden light that "
                      "spreads to the edges and fades, the stones drop, he stands with a confident grin. The aura hugs his "
                      "body outline and rises behind him, never in front of his face: his face, eyes and brain stay "
                      "clearly visible and keep their natural colours the whole time.",
    'buy-kraken-v6': "THE BIGGEST MOMENT: a colossal majestic kraken in glossy deep purple with gold-tipped suckers rises up "
                     "out of glowing golden water behind him, its giant head and glowing eyes towering high above him; eight "
                     "enormous tentacles rise all around him in a mighty ring, swirl through the air and curl overhead like "
                     "a crown, a rain of golden coins falls around him; he raises both arms like a king in triumph and "
                     "laughs; then the tentacles sink back, the kraken dives and the water fades. Everything stays behind "
                     "and around him, never in front of his face; his face, eyes and brain stay clearly visible.",
    'buy-thunder-v4': "A small fluffy grey storm cloud the size of a pillow floats in from the right and stops high beside "
                      "him, an arm's length away from his head; it gives a soft rumble and three thin, faint golden zaps "
                      "flick down from it into the empty floor an arm's length to his side — no flash, no glow on the "
                      "floor, no sparks on him; he leans away in mock surprise, then laughs, waves at the cloud and it "
                      "drifts up and out of the top of the picture. Nothing dissolves, no sparkle cloud; his face, brain "
                      "and hoodie keep their colours, the hoodie deep matte black in every frame.",
    'buy-huge-v4': "A shiny golden rocket as tall as his knee stands on the floor an arm's length to his right; he counts "
                   "down on his fingers, three, two, one, and it lifts off with only a thin wisp of soft grey smoke (no "
                   "fire, no bright plume, nothing glowing) and flies straight up and out of the top of the picture; he "
                   "follows it with his eyes, shading them with one hand, and cheers with both fists. Nothing lights him; "
                   "his hoodie, trousers and sneakers stay deep matte black in every frame.",
    'buy-kraken-v5':"Behind him a giant friendly purple-and-gold kraken rises from below the bottom of the picture until "
                     "its big round head with kind eyes shows above his shoulders, far behind him; two of its tentacles "
                     "curl around on either side of him at a distance and gently set a small golden treasure chest on "
                     "the floor in front of his feet; he opens the lid, golden coins glint softly inside, he looks back "
                     "and gives the kraken a thumbs-up, the kraken winks and sinks back below the picture and the chest "
                     "fades in golden sparkles. The kraken stays behind him, nothing ever passes in front of his face; "
                     "no bright light; his hoodie stays deep matte black.",
    'burn-nice-v3': "A small campfire of three glowing logs appears on the ground beside his right foot; he crouches a "
                    "little and warms his hands over it with a content smile, stands up, and the fire shrinks and goes out "
                    "in a few drifting embers. The fire stays low and small.",
    # 2026-10-03 (after the clip inspector, operator: "first the moves with only one clip"): every flaw so far was fire,
    # a flash or a prop over his FACE, or a second figure. Here everything burns LOW and to his SIDE, at least a hand's
    # width from his head, nothing ever between his face and the viewer, one figure only.
    'buy-whale-v4': "A huge friendly whale with a glossy blue-grey back rises up from below the bottom of the picture BEHIND "
                    "him and to his left, blows a tall fountain of glittering golden water straight up far behind him, "
                    "waves its tail fin once and sinks back down below the picture; he turns, points at it and cheers with "
                    "both fists. The fountain and the droplets stay behind him and above, never over him or his face.",
    'bull-v4': "A glowing golden bull made of light trots in from the right and stops beside him; he pats its neck with a "
               "proud grin and gives the viewer a thumbs-up, the bull nods once and trots out of the picture to the right. "
               "He never rides it, he stays standing beside it; there is only ONE of him the whole time.",
    'burn-v4': "He holds his right hand out to his side at hip height, a small ball of orange fire ignites above his palm, "
               "he looks at it with a satisfied smile and closes his fist, and the fire goes out in a few embers that fall "
               "to the floor. The fire stays at hip height, far from his face.",
    'burn-small-v3': "He snaps his fingers at hip height beside him and a tiny flame lights on his thumb like a lighter; he "
                     "looks down at it, smiles, and snuffs it out with his other hand. The flame stays at hip height, far "
                     "from his face.",
    'burn-nice-v4': "A small lantern with a warm candle inside appears in his right hand, held low at his side at knee "
                    "height; he lifts it a little like a toast, smiles at the viewer, and it fades away in a curl of smoke. "
                    "The flame stays low, far from his face.",
    'burn-apocalypse-v3': "Far behind him, high in the sky, a small fiery meteor streaks across from left to right and bursts "
                          "into a ring of orange sparks near the top edge of the picture; he points up at it with an "
                          "amazed grin, then claps once. All the fire stays high and far behind him, never near his face, "
                          "no flash over him.",
    'burn-supernova-v3': "High above his head a small star glows, swells and bursts into violet and gold rings that spread "
                         "out across the top of the picture; he looks up at it in awe and opens his arms wide. All the light "
                         "stays high above him, no flash over his face or body.",
    # the green pour (operator 2026-09-28, shot on BLUE_SCREEN): the first liq take on green was the one he liked
    'liq-v2': "A round glass flask of glowing bright EMERALD-GREEN liquid appears in his hand in green sparkles; he tilts it "
              "and pours a steady shimmering green stream with bubbles down onto the ground, where it splashes into a small "
              "glowing green puddle at his feet, with a focused, pleased smile; then the flask and the puddle fade away in "
              "green sparkles. The flask stays BELOW his face and the stream and puddle stay close to him, well inside the "
              "frame. His brain-head keeps its natural warm pink-peach colour in every frame (never green, never yellow), "
              "his hoodie stays deep black; only the liquid glows green.",
    # re-shot 2026-09-28: the first wide take put the hologram over his face (eyes and brain turned blue)
    'defi': "A blue hologram panel with a spinning gear and a gauge appears at his CHEST height to his RIGHT side, never "
            "in front of his face or head; he swipes and taps it like a pro, the gauge needle climbs, he nods "
            "satisfied, and the hologram folds away into light. His face and brain are lit warm and keep their "
            "natural colour, his eyes stay warm amber-brown. "
            "Audio: soft, clean interface blips and a calm electronic hum only.",
    'giggle': "A glowing golden coin appears on his thumb; he flips it up, it spins with pink and golden sparkles, he "
              "catches it, smiles warmly and it vanishes in sparkles.",
    'buy-nice': "A golden coin appears on his thumb; he flips it high, follows it with his eyes, catches it, winks, gives "
                "a cheeky thumbs up, and the coin vanishes in a sparkle.",
    'buy-big': "A glowing diamond appears in his raised hand; he turns it so it flashes brilliant white-blue light, admires "
               "it with delight, presents it to the viewer, and it dissolves into sparkles.",
    # re-shot 2026-09-28: warm rocket fire lit his hoodie brown twice; the flame is now cool blue-white
    'buy-huge': "A small golden rocket appears beside him in sparkles; he grabs it, it rumbles and shakes with a COOL "
                "BLUE-WHITE jet flame pointing straight down at the floor while hovering in place, he pumps his fist "
                "whooping, then lets go and it vanishes in a burst of sparks. The cool flame casts no warm light: his "
                "hoodie, trousers and sneakers stay deep matte BLACK the whole time, never brown or orange; no smoke.",
    'buy-whale': "A majestic glowing whale surges up from below, he stands on its back with arms wide, its blowhole blasts "
                 "a glittering fountain, he laughs; the whale sinks away and he lands on his feet.",
    'buy-thunder': "He raises one fist and golden lightning bolts strike down into it with bright flashes, electric arcs "
                   "racing around him, he roars with excitement; the storm fades and he lowers his fist.",
    'buy-kraken': "Giant purple-and-gold kraken tentacles rise around him, he conducts them like an orchestra with both "
                  "arms, grinning triumphantly; the tentacles sink away.",
    'burn-small': "A little flame lights on his fingertip; he blows on it gently so it flickers, it burns bright again, he "
                  "smiles and snuffs it out with a wink.",
    'burn-nice': "A lit candle appears in his hand; the flame rises taller, he lifts it like a toast with a warm smile, "
                 "then blows it out and it vanishes in a curl of smoke.",
    # re-shot 2026-09-28: the first wide take's lava column ran into the right edge
    'burn-big': "A small knee-high volcano rises from the ground right beside him and erupts in short bursts of glowing "
                "lava and embers that reach only up to his head height; he jumps a little with excitement and points at "
                "it, then the volcano sinks back into the ground. The volcano and every spark stay close to him, well "
                "inside the frame, far from every edge.",
    # re-shot 2026-09-29: twice the flaming skull in his hands took the place of his head (28.9., 29.9.). No skull near
    # him any more: a fire bowl beside him, the skull only as the shape of the flame, high above the bowl and away from him
    'burn-mega': "A black iron fire bowl rises from the ground beside him to his RIGHT, at knee height; he flicks a golden "
                 "coin into it and a tall column of flame whooshes up out of the bowl, for a moment the top of the flame "
                 "takes the shape of a grinning skull ABOVE THE BOWL, well away from him; he steps back with a fearless "
                 "grin and crosses his arms, then the flame collapses into embers and the bowl sinks away. His own head "
                 "and face stay fully visible and unchanged; everything stays well inside the frame.",
    'burn-apocalypse': "A blazing meteor streaks across the sky above him with a long fiery tail and bursts in a flash of "
                       "light behind him; he points, shields his eyes, thrilled, sparks raining down and fading.",
    'burn-supernova': "A tiny star ignites between his hands, flares and explodes outward in white-gold and violet "
                      "shockwave rings, his hoodie fluttering, an epic radiant expression; the light gathers back and goes out.",
    # 2026-10-06, Halloween: the skeleton throws the moon at his head — he feels it (operator: "a real clip of him rubbing
    # his head"). Nothing hits him in the clip itself: the moon is the page's, the clip is only his reaction.
    'ouch': "As if something small just bonked the top of his head from above (nothing is visible, no object at all), he "
            "flinches and ducks a little, squeezes his eyes shut for a moment, then rubs the top of his brain-head with one "
            "hand, wincing comically with a crooked 'ow' mouth (silent), blinks twice, shakes his head once to clear it, "
            "gives a small embarrassed grin and lowers his hand back into the standing pose. His face stays fully visible "
            "the whole time; everything stays well inside the frame.",
    'ouch-v2': "As if lightly hit on the side of his head (nothing is visible, no object at all), his head tips a little to "
               "one side, he grabs the top of his brain-head with both hands and hops once on the spot in comic pain with "
               "his eyes squeezed shut, then rubs the spot slowly with one hand, peeks up with a puzzled look, shrugs it off "
               "with a little smile and lowers his hands back into the standing pose. His face stays fully visible the whole "
               "time; everything stays well inside the frame.",
    # v2 squeezed his face until it was no longer his (withheld 6.10.): v3 keeps his big round eyes open
    'ouch-v3': "As if something small just tapped the top of his head (nothing is visible, no object at all), he jolts a "
               "little and says a silent 'ow' with a small wince, his big round eyes staying OPEN, then rubs the top of his "
               "brain-head with one hand in small circles, looks up toward the spot with a puzzled face, chuckles and "
               "lowers his hand back into the standing pose. His face stays exactly his own and fully visible the whole "
               "time; everything stays well inside the frame.",
    # 2026-10-07 (operator: "P1 out, make a new beautiful liq animation; Q1 out and a nicer one"): liquidity = BOBAI and
    # BNB poured together into one pool; the DeFi agent = a little tree whose leaves are its fees. Same rules as every
    # take: nothing near his face, no sparkle cloud over him, hoodie deep black.
    'liq-v4': "Two small round glass flasks appear in his hands in a few golden sparkles: GOLDEN glowing liquid in one, "
              "warm AMBER glowing liquid in the other. He holds them low at waist height and pours both at once into a "
              "small round glowing pool on the ground right in front of his feet; the two streams swirl together into a "
              "slowly turning golden whirlpool with tiny bubbles rising from it; he watches it with a proud, happy smile, "
              "then flasks and pool fade away in a few golden sparkles. The flasks stay well below his face, the pool "
              "stays small and close to his feet, fully inside the frame. His brain-head keeps its natural warm "
              "pink-peach colour, his eyes stay warm amber-brown, his hoodie stays deep matte black; only the liquid glows.",
    # v4 (same day): glitter landed on his hoodie, his face glowed orange over the pool, and the flasks were full again
    # after pouring — v5: no sparkles at all, the flasks pour EMPTY and fade, the glow stays low at the pool
    'liq-v5': "He holds out both hands at waist height and two small round glass flasks fade in, one with glowing GOLDEN "
              "liquid, one with glowing warm AMBER liquid. He tilts both at once and pours two smooth, clean streams down "
              "into a small round shallow pool of light on the ground right in front of his shoes; the golden and the "
              "amber swirl around each other and blend into one calm, slowly turning golden pool; the flasks run EMPTY. "
              "He smiles proudly at it, the empty flasks fade out of his hands, and the pool softly fades away. NO "
              "sparkles, NO glitter, NO splashes on him; the glow stays low at the pool and never lights his face; the "
              "flasks stay well below his face; the pool stays small and close to his feet, fully inside the frame. His "
              "brain-head keeps its natural warm pink-peach colour, his eyes stay warm amber-brown, his hoodie stays deep "
              "matte black and clean.",
    'defi-v6': "A tiny golden sprout pushes up from the ground beside his right foot and grows, leaf by leaf, into a small "
               "golden tree no taller than his knee whose leaves are little shiny golden coins; he bends down a little, "
               "plucks one coin leaf, flips it once with his thumb, catches it, slips it into his hoodie pocket with a "
               "satisfied nod, and the little tree sinks gently back into the ground. No sparkle cloud, no smoke, no light "
               "on the floor; everything stays low near the ground and fully inside the frame; his brain-head keeps its "
               "natural warm pink-peach colour, his eyes stay warm amber-brown, his hoodie stays deep matte black.",
    # 2026-10-10 (operator: "make 2-3 BOBAI standard animations, more entertainment"): three new everyday moves. Same
    # lesson as every take: no glowing light near his face, no sparkle cloud over him, props low and plain.
    'guitar': "He plays a wild AIR GUITAR solo with an invisible guitar (his hands are empty, there is no object at all): "
              "left hand fingering the invisible neck, right hand strumming hard, he bobs his head to the beat, bends his "
              "knees, rocks one leg, does a big windmill strum with his right arm, ends with one fist in the air and a "
              "proud rock-star grin. His face stays fully visible the whole time; everything stays well inside the frame.",
    'guitar-v2': "He plays AIR GUITAR with an invisible guitar (his hands are empty, no object at all), tapping his foot, "
                 "then hops on one foot in a small circle on the spot while shredding a fast solo with a funny focused "
                 "face, finishes with a little jump and a silent cheer, both hands up. His face stays fully visible the "
                 "whole time; everything stays well inside the frame.",
    'popcorn': "A plain red-and-white striped paper popcorn bucket appears in his hand in a tiny puff of golden sparkles. "
               "He holds it at his chest and watches something exciting in front of him (the viewer), eating popcorn piece "
               "by piece with big curious eyes, leans forward in suspense, gasps happily, tosses one piece up a little "
               "and catches it in his mouth, chews with a satisfied grin; then the bucket fades away in a tiny puff of "
               "golden sparkles. The bucket stays at chest height below his face; no glow on his face.",
    'popcorn-v2': "A plain red-and-white striped paper popcorn bucket fades into his hand. He settles in like at the movies, "
                  "munches popcorn calmly while watching the viewer, raises his eyebrows at something surprising, nods "
                  "slowly, offers the bucket forward toward the viewer with a friendly smile as if sharing, pulls it back "
                  "and the bucket fades out of his hand. The bucket stays at chest height below his face; no glow.",
    # v1 and v2 of both drew a real prop anyway; guitar-v2 lost its guitar from one frame to the next and popcorn v1 split
    # its bucket in two at the end — v3: the prop comes and goes the way every hub prop does, in golden sparkles / a pocket
    'guitar-v3': "A black electric guitar appears in his hands in a small puff of golden sparkles at waist height. He "
                 "rocks out: strums hard, bobs his head to the beat, bends his knees, does one big windmill strum, then "
                 "holds the guitar still in both hands and it dissolves into a small puff of golden sparkles at waist "
                 "height; he gives one proud rock-star fist pump at shoulder height. The guitar stays below his face the "
                 "whole time; it is ONE guitar the whole time and never splits or vanishes suddenly.",
    'popcorn-v3': "A small red-and-white striped paper popcorn BAG appears in his hand in a tiny puff of golden sparkles. "
                  "He watches the viewer with big curious eyes like at the movies, eating popcorn piece by piece, gasps "
                  "happily at something exciting, eats the last piece, crumples the empty bag into a tiny ball and slips "
                  "it into his hoodie pocket. It is ONE bag the whole time; nothing falls to the ground; the bag stays at "
                  "chest height below his face.",
    'zen': "He closes his eyes calmly, presses his palms together in front of his chest and slowly rises a little off the "
           "ground, floating in the air with his legs crossed in a calm meditation pose, breathing slowly and peacefully, "
           "a serene smile; then he uncrosses his legs, gently lands on his feet and opens his eyes with a relaxed look. "
           "No light, no glow, no particles; his face stays fully visible; everything stays well inside the frame.",
    'zen-v2': "He takes a deep calm breath with his eyes half closed, raises both arms slowly over his head and lowers "
              "them in front of him like a slow tai-chi move, then balances calmly on one leg in a tree pose with palms "
              "together for a moment, wobbles a tiny bit with a little grin, and steps back down. No light, no glow, no "
              "particles; his face stays fully visible; everything stays well inside the frame.",
    # 22 OCTOBER 2026 (operator: "3-4 animations for the ecosystem in the terminal — surprise me, it must be perfect,
    # and special: the DeFi agent already has a robot"): one move for each thing the ecosystem does for other agents.
    # Gold props only (a green effect would be keyed out), no robot, nothing leaves the frame, the face stays free.
    'settle': "A glowing golden rubber stamp appears in his right hand in a little burst of golden sparkles, and a small "
              "blank golden sheet of paper floats in the air in front of his chest. With a confident little hop he presses "
              "the stamp onto the sheet with a satisfying soft golden flash; the stamped sheet folds itself into a small "
              "golden paper airplane that glides a short loop around him and dissolves into golden sparkles well inside "
              "the frame; he gives a happy thumbs-up, and the stamp vanishes in golden sparkles. His face stays fully "
              "visible the whole time; everything stays well inside the frame.",
    'hire': "Beside him, at his own height, a translucent warm-golden hologram of a small friendly figure made of soft "
            "light appears in golden sparkles: a simple glowing silhouette with no face and no details, clearly made of "
            "light, not a robot. He turns slightly toward it and they shake hands warmly; a small shiny golden coin passes "
            "from his other hand into the figure's hand, the figure gives a little nod and dissolves into golden sparkles, "
            "and he waves it a cheerful goodbye. The hologram is golden, never blue; his face stays fully visible; "
            "everything stays well inside the frame.",
    'venus': "Like a friendly little doctor, he puts a shiny golden stethoscope around his neck as it appears in golden "
             "sparkles; a big glowing golden coin floats in front of his chest. He holds the stethoscope's chest piece "
             "to the coin and listens attentively with a focused, serious face; then a small bright WHITE heart symbol "
             "pulses twice above the coin, and he smiles, relieved, and gives a satisfied nod. The stethoscope, the coin "
             "and the heart vanish into golden sparkles. No green anywhere; his face stays fully visible; everything stays "
             "well inside the frame.",
    'paid': "A single shiny golden coin falls gently from above toward him; he catches it neatly with both hands, looks at "
            "it with delight, lifts it to his mouth and gives it a playful little bite to check that it is real (a tiny "
            "golden sparkle where he bites), grins widely, holds it up proudly toward the viewer for a moment and then "
            "tucks it into the front pocket of his hoodie and pats the pocket. His eyes stay visible the whole time; "
            "everything stays well inside the frame.",
    # -v2 (22.10. review, clipcheck): settle's stamp flash lit his face and turned the hoodie brown; hire's light figure
    # lit his face orange; venus's sparkle cloud covered his face. Same ideas, no light near him at all.
    # paid-v2 (22.10., operator: "the coin we already have with the buys" — a fourth, different ecosystem move)
    'paid-v2': "A small folded golden paper bird (an origami crane) flutters in gently from the side and lands on his open "
               "palm. It unfolds itself into a small cream-white note with a neat golden check mark on it; he reads it, "
               "his face lights up with joy and he does a happy little fist-pump with his other hand. The note folds "
               "back into the paper bird, which flutters away and quietly fades out well inside the frame. No coin, no "
               "sparkles, no glow, no light near him; his face and black hoodie keep exactly their normal colours in "
               "every frame; his face stays fully visible; everything stays well inside the frame.",
    # paid-v3 (22.10. review: in -v2 the bird crossed his face half-transparent for half a second, like a smear)
    'paid-v3': "A small folded golden paper bird (an origami crane) flutters in low from his right side, always BELOW his "
               "chest and beside him, never in front of his face or head, and lands on his open palm held at waist "
               "height. It unfolds into a small cream-white note with a neat golden check mark; he looks down at it, "
               "reads it, his face lights up and he does a happy little fist-pump with his other hand. The note folds "
               "back into the paper bird, which flutters away LOW to the side, below his chest, and quietly fades out "
               "well inside the frame. The bird is solid paper, never transparent; no coin, no sparkles, no glow; his "
               "face stays fully visible and uncovered in every frame; everything stays well inside the frame.",
    'settle-v2':"A small polished golden rubber stamp simply appears in his right hand (no sparkles, no flash), and a small "
                 "plain cream-white sheet of paper floats in the air at his chest height, an arm's length to his side. He "
                 "presses the stamp onto the sheet with a confident little hop - no flash, no glow, no light at all - and a "
                 "neat golden stamp mark is left on the paper. The sheet folds itself into a small paper airplane that "
                 "glides a short gentle loop beside him and quietly fades away well inside the frame; he gives a happy "
                 "thumbs-up and the stamp fades away. Nothing glows; his face and black hoodie keep exactly their normal "
                 "colours in every frame; everything stays well inside the frame.",
    'hire-v2': "Beside him, an arm's length away and at his own height, a simple friendly figure made of smooth matte golden "
               "material fades in (like a small golden statue that moves, no face, no details, not a robot, NOT glowing, "
               "emitting no light at all). He turns slightly toward it and they shake hands warmly; he places a small "
               "golden coin in its other hand, it gives a little nod and fades away calmly, and he waves it a cheerful "
               "goodbye. No light falls on him: his face keeps exactly its normal skin colour and his hoodie stays deep "
               "black in every frame; everything stays well inside the frame.",
    'venus-v2': "Like a friendly little doctor, he takes a shiny golden stethoscope out of his hoodie pocket (no sparkles, no "
                "glow) and puts the ear pieces in; a big golden coin floats calmly in front of his chest, slightly to the "
                "side so it never covers his face. He holds the chest piece to the coin and listens attentively with a "
                "focused face; a small plain WHITE heart symbol appears above the coin and pulses twice, he smiles, relieved, "
                "and nods. Then the coin and the heart fade away quietly and he puts the stethoscope back into his pocket. "
                "No sparkles, no glow, no light near him; no green anywhere; his face stays fully visible in every frame; "
                "everything stays well inside the frame.",
    # 25 OCTOBER 2026 (operator: "2-3 Veo-Clips als Animation im Terminal, passend zum Brain Board, etwas Cooleres als
    # BOBAI, der aufs Handy schaut"; chosen: bug -> fix, paper-plane mail, detective): the Brain Board's own moves. The
    # 22.10. lessons from the start: no sparkles, no glow, no light near him; props matte, below his face; nothing green.
    'board-bug': "A tiny cute ladybug-like beetle, matte RED with a few black dots, about the size of a coin, buzzes in a "
                 "small playful circle beside him at chest height, never in front of his face. He follows it with his eyes, "
                 "amused, then gently cups it between both hands at chest height. He peeks into his hands with a curious "
                 "grin, opens them, and a small matte GOLDEN butterfly flutters out instead, makes one little loop beside "
                 "him below his head and quietly fades away well inside the frame; he gives a proud little nod. No sparkles, "
                 "no glow, no light near him; nothing green; his face and black hoodie keep exactly their normal colours in "
                 "every frame; his face stays fully visible; everything stays well inside the frame.",
    'board-plane': "A small folded cream-white paper airplane with a thin golden edge glides in gently from his right side at "
                   "waist height, always below his chest, and he catches it neatly with one hand. He unfolds it into a small "
                   "letter, reads it with raised eyebrows and a growing smile, takes a small golden pen out of his hoodie "
                   "pocket, writes a short quick reply on the letter, puts the pen back, folds the letter into a paper "
                   "airplane again and launches it with a confident flick; it glides away low to the side and quietly fades "
                   "out well inside the frame. Solid paper, never transparent; no sparkles, no glow, no light near him; "
                   "nothing green; his face stays fully visible and uncovered in every frame; everything stays well inside "
                   "the frame.",
    'board-detective': "He takes a small matte golden magnifying glass out of his hoodie pocket and, like a playful little "
                       "detective, leans forward and examines the empty air in front of him at chest height, moving the "
                       "glass slowly left and right with one eye squinted. Suddenly he spots something, his eyebrows jump "
                       "up, he silently mouths 'aha!' with a delighted grin and taps the side of his brain-head with one "
                       "finger, then puts the magnifying glass back into his pocket. The glass never covers his face; it is "
                       "ONE magnifying glass the whole time; no sparkles, no glow, no light near him; nothing green; his face "
                       "and black hoodie keep exactly their normal colours in every frame; everything stays well inside the "
                       "frame.",
}
for _k, _v in HUB.items(): MOTION['hub-' + _k] = HUB_HEAD + _v + HUB_TAIL
# HIS ENTRANCE (operator, 2026-10-02, out jogging: "when the terminal starts, a start animation: BOBAI drives up in a Fiat
# Multipla, or comes as a talented breakdancer, or with a horde of cute baby kraken puppies, or in full construction gear
# for blockchain work — only once at the start, or on a reload"). The FIRST frame is the empty green screen, the LAST his
# standing still (hub-start-wide.png), so the greeting wave follows without a seam. Wide framing, standard model.
ENTER_HEAD = ("The picture starts EMPTY: only the flat green screen, he is not in the picture yet. ")
ENTER_TAIL = (" He ends standing relaxed in exactly the pose of the LAST frame: in the middle of the picture, the same small "
              "size, arms open, hands empty, facing the viewer with a warm smile; everything he came with has left the "
              "picture or vanished in a few golden sparkles before the end, nothing of it remains. One continuous take, "
              "fluid and physical (weight, anticipation, follow-through), never a jump or a cut. Premium 3D animated-film "
              "character animation: smooth, expressive, full-body, with natural weight. No text, no logos, no letters or "
              "numbers anywhere, no people other than him.")
ENTER = {
    'multipla': "A small, funny, bright golden-yellow retro family car with a quirky bubble-shaped front and big round "
                "headlights (like a Fiat Multipla) drives into the picture from the left, bouncing on its soft suspension, "
                "and stops in the middle with a little hop. The door opens, he hops out, shuts the door and gives the roof "
                "a proud pat, and the car drives on and out of the picture to the right; he turns to the viewer.",
    'breakdance': "He slides into the picture from the left on his knees, springs up and does a short, talented breakdance "
                  "routine on the spot: quick toprock steps, a windmill spin on the floor, a freeze balanced on one hand "
                  "with a cheeky grin, then he pops back up onto his feet.",
    'puppies': "A small wave of glowing dark water rolls in across the floor from the right, and on it come five tiny, super "
               "cute baby kraken — round purple-and-gold little octopus babies with big shiny eyes and short wiggly "
               "tentacles — tumbling and bouncing playfully; he rides in among them standing on the little wave, steps "
               "off in the middle and pats one on the head, and the babies wave their tiny tentacles goodbye and bounce "
               "away out of the picture to the left with the water. Nothing ever covers his face.",
    'builder': "He walks in from the left in full construction gear for blockchain work: a glowing golden hard hat, a "
               "bright safety vest over his black hoodie and a tool belt, a shiny golden block on his shoulder; in the "
               "middle he sets the block down, it sinks into the floor with a satisfying click and a few golden sparks, he "
               "wipes his brow, and the hard hat, the vest and the tool belt vanish in golden sparkles, leaving him in his "
               "black hoodie.",
    # re-shot 2026-10-02: puppies' dark water keyed out as an opaque dark slab; builder's gear vanished in a sparkle cloud
    # over his whole body (floor lit, hoodie orange). No water, no sparkle cloud: the babies bounce on their own, the
    # gear comes off by hand.
    'puppies-v2': "Five tiny, super cute baby kraken — round purple-and-gold little octopus babies with big shiny eyes and "
                  "short wiggly tentacles — come bouncing into the picture from the right one after another like little "
                  "rubber balls, and he skips in among them from the right with a big grin; in the middle he stops, pats "
                  "one on the head, the babies wave their tiny tentacles goodbye and bounce away out of the picture to the "
                  "left. No water, no puddle, nothing on the floor, no glow. Nothing ever covers his face.",
    'builder-v2': "He walks in from the left in full construction gear for blockchain work: a golden hard hat, a bright "
                  "yellow safety vest over his black hoodie and a tool belt, a shiny golden block on his shoulder; in the "
                  "middle he sets the block down on the floor with a satisfied pat and it slides into the ground; then with "
                  "his hands he takes off the hard hat and tosses it out of the picture to the left, pulls off the vest and "
                  "tosses it after, unbuckles the tool belt and tosses it too, and dusts off his black hoodie. No sparkles, "
                  "no flash, no glow, no light on the floor; his hoodie stays deep matte black.",
    # re-shot 2026-10-02: the first take's flames lit his face and turned his brain-head glowing yellow after landing
    'jetpack-v2': "He flies down into the picture from the top with a small golden jetpack on his back; its short flames "
                  "point straight DOWN, always below his feet, never near his head. He lands softly on his feet in the "
                  "middle, the flames go out, he slips the jetpack off his shoulders and tosses it out of the picture to "
                  "the right. No sparkles, no glow, no light on him or on the floor; his brain-head keeps its natural warm "
                  "pink-peach colour in every frame, never yellow, never glowing; his hoodie stays deep matte black.",
    # re-shot 2026-10-02: in the first take he stood on top of the box and then sank back into it
    'giftbox-v2': "A big golden gift box with a red ribbon drops from the top of the picture and lands in the middle with "
                  "a thud; the lid pops off and flies out of the top of the picture; he jumps up out of the box in ONE big "
                  "joyful leap with his arms wide and lands on the floor right in front of it; the empty box behind him "
                  "folds flat and slides away out of the picture to the right. He never goes back into the box. No "
                  "sparkles, no glow, no light on the floor.",
    'jetpack': "He flies in from the top of the picture with a small golden jetpack on his back, short bright flames below "
               "it, does one happy loop in the air, lands softly on his feet in the middle with a little puff of dust, and "
               "the jetpack vanishes in golden sparkles.",
    'giftbox': "A big golden gift box with a red ribbon drops from the top of the picture and lands in the middle with a "
               "thud; the lid pops off and he jumps out of the box with his arms wide and a huge grin, and the box folds "
               "down and vanishes in golden sparkles at his feet.",
}
for _k, _v in ENTER.items(): MOTION['hub-enter-' + _k] = ENTER_HEAD + _v + ENTER_TAIL
# the big moments get the standard model, everything else the fast one (operator, 2026-09-25)
STANDARD = {'idle', 'buy-whale', 'buy-thunder', 'buy-kraken', 'burn-apocalypse', 'burn-supernova'}

def frame_png(pose):
    pose = pose.split('-v')[0] if '-v' in pose and pose.rsplit('-v', 1)[1].isdigit() else pose  # a second take starts from its pose's frame
    pose = {'rest': 'idle'}.get(pose, pose)  # the calm moment starts from the idle frame
    # hub clips and the calm rest takes start from the exact still the terminal shows (first frame of idle.mp4)
    # --wide (2026-09-27, operator: "nothing may be cut off"): the same still at 70% in the middle of the frame, room
    # on every side for what he conjures; the terminal knows these takes by the <pose>.wide marker (FRAMING.wide)
    hs = os.path.join(HERE, 'figure', 'hub-start-wide.png' if WIDE else 'hub-start.png')
    if (pose.startswith('hub-') or pose == 'idle' or (WIDE and pose.startswith('rest'))) and os.path.exists(hs):
        buf = BytesIO(); Image.open(hs).convert('RGB').save(buf, 'PNG')
        return base64.b64encode(buf.getvalue()).decode()
    # a pose drawn straight onto green (gen-figure.js GREEN=1) wins: it has no cut-out edges and a solid black
    # hoodie; the padding takes the image's own green so the whole 9:16 frame is one flat screen
    import glob as _g
    greens = sorted(_g.glob(os.path.join(HERE, 'figure', f'{pose}-green-gpt-image-2-*.png')), key=os.path.getmtime)
    if greens:
        im = Image.open(greens[-1]).convert('RGB').resize((720, 1080), Image.LANCZOS)
        g = im.getpixel((6, 6))
        bg = Image.new('RGB', (720, 1280), g); bg.paste(im, (0, 110))
        buf = BytesIO(); bg.save(buf, 'PNG'); return base64.b64encode(buf.getvalue()).decode()
    im = Image.open(os.path.join(FIG, f'{pose}.webp')).convert('RGBA')          # 683x1024, cut out
    fig = im.resize((720, 1080), Image.LANCZOS)
    bg = Image.new('RGBA', (720, 1280), GREEN + (255,)); bg.alpha_composite(fig, (0, 110))
    buf = BytesIO(); bg.convert('RGB').save(buf, 'PNG'); return base64.b64encode(buf.getvalue()).decode()

def gen(pose, model, secs, force=False):
    dst = os.path.join(OUT, f'{pose}.mp4')
    if os.path.exists(dst) and not force:
        print(f'skip {pose} (exists)', flush=True); return True
    img = frame_png(pose)
    prompt = BASE + MOTION[pose] + ('' if pose.startswith('hub-') else TAIL)  # a hub clip carries its own ending
    if WIDE: prompt += (" FRAMING: he stays exactly as small as in the image, in the middle of the frame, with wide empty green "
                        "space around him. Everything — his arms and legs, every prop, every flame, spark, splash and object — "
                        "stays completely INSIDE the frame the whole time, never touching or crossing any edge of the picture; "
                        "the camera does not move or zoom.")
    blue = pose in BLUE_SCREEN
    if blue:
        assert WIDE, 'the blue start frame is the wide one'
        buf = BytesIO(); Image.open(os.path.join(HERE, 'figure', 'hub-start-wide-blue.png')).convert('RGB').save(buf, 'PNG')
        img = base64.b64encode(buf.getvalue()).decode()
        for a, b in (('chroma-key GREEN screen', 'chroma-key BLUE screen'), ('the green background', 'the blue background'),
                     ('never green, never tinted', 'never blue, never tinted'), ('empty green space', 'empty blue space'),
                     ('casts NO green color', 'casts NO blue color')):
            prompt = prompt.replace(a, b)
    first = img
    if '-enter-' in pose:  # an entrance starts on the empty screen: the still's own backdrop colour, no figure
        st = Image.open(os.path.join(HERE, 'figure', 'hub-start-wide.png')).convert('RGB')
        buf = BytesIO(); Image.new('RGB', st.size, st.getpixel((6, 6))).save(buf, 'PNG'); first = base64.b64encode(buf.getvalue()).decode()
    body = {'instances': [{'prompt': prompt,
                           'image': {'bytesBase64Encoded': first, 'mimeType': 'image/png'},
                           'lastFrame': {'bytesBase64Encoded': img, 'mimeType': 'image/png'}}],
            # no personGeneration: with it the API answered 'use case not supported' (2026-09-25); 8 s is what it accepts
            'parameters': {'aspectRatio': '9:16', 'durationSeconds': int(secs), 'resolution': '720p'}}
    r = requests.post(f'{API}/models/{model}:predictLongRunning', headers={'x-goog-api-key': KEY, 'Content-Type': 'application/json'}, data=json.dumps(body), timeout=120)
    if r.status_code != 200:
        print(f'ERR {pose}: {r.status_code} {r.text[:800]}', flush=True); return False
    op = r.json()['name']; print(f'[{pose}] {model} {secs}s · {op}', flush=True)
    while True:
        time.sleep(10)
        try: s = requests.get(f'{API}/{op}', headers={'x-goog-api-key': KEY}, timeout=60).json()
        except Exception: continue
        if s.get('error'): print(f'ERR {pose}: {s["error"]}', flush=True); return False
        if s.get('done'): break
    resp = s.get('response', {}).get('generateVideoResponse', {})
    samples = resp.get('generatedSamples') or []
    if not samples:
        print(f'ERR {pose}: no video (filtered?) {json.dumps(resp)[:600]}', flush=True); return False
    uri = samples[0]['video']['uri']
    v = requests.get(uri, headers={'x-goog-api-key': KEY}, timeout=300, allow_redirects=True)
    open(dst, 'wb').write(v.content)
    for flag, on in (('wide', WIDE), ('blue', blue)):
        mark = os.path.join(OUT, f'{pose}.{flag}')
        if on: open(mark, 'w').close()
        elif os.path.exists(mark): os.remove(mark)
    print(f'OK {pose} ({len(v.content)//1024} KB) -> {dst}{" [wide]" if WIDE else ""}', flush=True); return True

WIDE = '--wide' in sys.argv
if __name__ == '__main__':
    a = sys.argv[1:]
    pick = lambda p: 'veo-3.1-lite-generate-preview' if '--lite' in a else 'veo-3.1-generate-preview' if ('--std' in a or (p in STANDARD and '--fast' not in a)) else 'veo-3.1-fast-generate-preview'
    secs = a[a.index('--secs') + 1] if '--secs' in a else '8'
    poses = [x for i, x in enumerate(a) if not x.startswith('--') and (i == 0 or a[i - 1] != '--secs')]
    for p in poses: gen(p, pick(p), secs, '--force' in a)
