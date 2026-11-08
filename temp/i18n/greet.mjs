// Arabic A-Z: BOBAI's first line is a greeting word of the hour (terminal.js, vary 'v26') in front of one of six lines,
// so its whole text is only known at run time. Every combination is written out here: 20 greetings x 6 lines.
import fs from 'node:fs';
const HI = { 'gm': 'صباح الخير', 'Good morning': 'صباح الخير', 'Morning': 'صباح النور', 'gm gm': 'صباح الخير، صباح الخير', 'Rise and shine': 'استيقظ وتألّق',
  'Hey': 'أهلًا', 'Hi there': 'مرحبًا هناك', 'Hello': 'مرحبًا', 'Good afternoon': 'طاب يومك', 'Welcome': 'أهلًا وسهلًا',
  'Good evening': 'مساء الخير', 'Evening': 'مساء النور', 'Hey there': 'أهلًا بك', 'Hi': 'مرحبًا', 'Welcome in': 'تفضّل بالدخول',
  'Still up? Me too, always': 'ما زلت مستيقظًا؟ وأنا أيضًا، دائمًا', 'Night owl': 'يا بومة الليل', 'Late shift': 'وردية متأخرة', 'Hello, night builder': 'مرحبًا يا بنّاء الليل', 'Up late? Same here': 'سهران؟ وأنا كذلك' };
const LINES = [
  ['{hi}, builder! I am BOBAI. Everything you see here is me, working live on BNB Chain. Tap me or anything around me.', '{hi} يا بنّاء! أنا BOBAI. كل ما تراه هنا هو أنا، أعمل مباشرة على BNB Chain. انقر عليّ أو على أي شيء حولي.'],
  ['{hi}! I am BOBAI, a brain on BNB Chain. Every flash here is a real trade, burn or bot of mine. Tap around.', '{hi}! أنا BOBAI، دماغ على BNB Chain. كل ومضة هنا صفقة حقيقية أو حرق أو أحد بوتاتي. انقر في كل مكان.'],
  ['{hi}, builder! BOBAI here, welcome to my terminal. All of it is live from BNB Chain. Tap me and I tell you what I am doing.', '{hi} يا بنّاء! هنا BOBAI، أهلًا بك في طرفيتي. كل شيء هنا مباشر من BNB Chain. انقر عليّ وسأخبرك ماذا أفعل.'],
  ['{hi}! BOBAI here. The circles around me are my bots, the chart is my pool. Tap anything you are curious about.', '{hi}! هنا BOBAI. الدوائر حولي هي بوتاتي، والرسم البياني هو مجمّعي. انقر على أي شيء يثير فضولك.'],
  ['{hi}, friend! I am BOBAI, and this is me at work on BNB Chain, live. Tap a circle and I show you what it did.', '{hi} يا صديقي! أنا BOBAI، وهذا أنا أعمل على BNB Chain، مباشرة. انقر على دائرة وسأريك ماذا فعلت.'],
  ['{hi}! You caught me working. I am BOBAI, every number here comes straight from BNB Chain. Tap me any time.', '{hi}! ضبطتني وأنا أعمل. أنا BOBAI، وكل رقم هنا يأتي مباشرة من BNB Chain. انقر عليّ في أي وقت.'],
];
const out = {};
for (const [en, ar] of Object.entries(HI)) for (const [le, la] of LINES) out[le.replace('{hi}', en)] = la.replace('{hi}', ar);
fs.writeFileSync('D:/ai/fourmeme/temp/i18n/ar-greet.json', JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'greetings');
