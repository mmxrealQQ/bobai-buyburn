// Minimal CDP driver — no puppeteer, Node's global WebSocket only.
import {spawn} from 'node:child_process';
import {scratchDir} from '../lib/scratch.mjs';

const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';

export async function launch(port=9333,w=1280,h=900){
  const dir=scratchDir('cdp-');
  const p=spawn(CHROME,['--headless=new','--remote-debugging-port='+port,
    '--user-data-dir='+dir,'--window-size='+w+','+h,'--hide-scrollbars',
    '--no-first-run','--no-default-browser-check','--disable-extensions'],
    {stdio:'ignore'});
  for(let i=0;i<80;i++){
    try{const r=await fetch('http://127.0.0.1:'+port+'/json/version');if(r.ok)break}catch(e){}
    await new Promise(r=>setTimeout(r,150));
  }
  return {proc:p,port};
}

export class Tab{
  constructor(ws){this.ws=ws;this.id=0;this.waits=new Map();this.events=[];
    ws.addEventListener('message',ev=>{
      const m=JSON.parse(ev.data);
      if(m.id&&this.waits.has(m.id)){const {res,rej}=this.waits.get(m.id);this.waits.delete(m.id);
        m.error?rej(new Error(m.error.message)):res(m.result)}
      else if(m.method)this.events.push(m);
    });
  }
  send(method,params={}){const id=++this.id;
    return new Promise((res,rej)=>{this.waits.set(id,{res,rej});
      this.ws.send(JSON.stringify({id,method,params}));
      setTimeout(()=>{if(this.waits.has(id)){this.waits.delete(id);rej(new Error('timeout '+method))}},60000)});
  }
  async eval(expr){
    const r=await this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||'eval threw');
    return r.result.value;
  }
}

export async function newTab(port=9333){
  const r=await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'});
  const t=await r.json();
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res);ws.addEventListener('error',rej)});
  const tab=new Tab(ws);
  await tab.send('Page.enable');await tab.send('Runtime.enable');await tab.send('Log.enable');
  tab.targetId=t.id;
  return tab;
}
export async function closeTab(port,id){try{await fetch('http://127.0.0.1:'+port+'/json/close/'+id)}catch(e){}}
