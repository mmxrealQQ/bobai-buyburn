// Type into a field, press a button, read what appears — the path a visitor
// actually takes, which page-text.mjs (load and read) does not exercise.
//
//   node scripts/dashboard-check/type-click.mjs <url> <inputSelector> <value> <buttonSelector> <outputSelector> [settleMs] [width]
//
// Prints the output element's text, then the page width and console errors.
import {launch,newTab,closeTab} from '../scanner-audit/cdp.mjs';
const [url,inSel,val,btnSel,outSel,ms='8000',W='390']=process.argv.slice(2);
const {proc,port}=await launch(9500+Math.floor(Math.random()*90),Number(W),900);
const tab=await newTab(port);
await tab.send('Emulation.setDeviceMetricsOverride',{width:Number(W),height:900,deviceScaleFactor:1,mobile:Number(W)<700});
const errs=[];tab.ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.method==='Runtime.exceptionThrown')errs.push('EXC '+(m.params.exceptionDetails?.exception?.description||'').split('\n')[0]);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errs.push('CON '+m.params.args.map(a=>a.value||a.description||'').join(' ').slice(0,160))});
await tab.send('Page.navigate',{url});
for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,500));if(await tab.eval(`document.readyState==='complete'&&!!document.querySelector(${JSON.stringify(inSel)})`).catch(()=>false))break}
await new Promise(r=>setTimeout(r,1500));
await tab.eval(`(()=>{const i=document.querySelector(${JSON.stringify(inSel)});i.focus();i.value=${JSON.stringify(val)};i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));const b=document.querySelector(${JSON.stringify(btnSel)});b.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 1})()`);
await new Promise(r=>setTimeout(r,Number(ms)));
const t=await tab.eval(`(()=>{const o=document.querySelector(${JSON.stringify(outSel)});return {text:o?o.innerText:'(output element not found)',hidden:o?o.hidden:null,sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}})()`);
console.log(t.text);console.log('\n=== hidden:',t.hidden,'scrollWidth',t.sw,'clientWidth',t.cw,t.sw>t.cw?'HORIZONTAL OVERFLOW':'ok');console.log('=== console:',errs.join(' | ')||'clean');
await closeTab(port,tab.targetId);proc.kill();
