#!/usr/bin/env node
'use strict';
// Runs every enabled collector in collectors.json and writes each result into
// today's daily note properties. A failed reading is written as `unknown`, never 0.
const fs=require('node:fs');
const path=require('node:path');

const HERE=__dirname;
const ROOT=path.resolve(HERE,'../../..');
const DAILY_DIR=path.join(ROOT,'00 Human/10 Daily Notes');
const TEMPLATE=path.join(ROOT,'00 Human/80 Templates/Daily.md');
const TIMEOUT_MS=20000;
const PROPERTY=/^[a-z][a-z0-9_]*$/;

function localDate(now=new Date()){
 const pad=n=>String(n).padStart(2,'0');
 return now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
}
function readCollectors(){
 const list=JSON.parse(fs.readFileSync(path.join(HERE,'collectors.json'),'utf8')).collectors;
 if(!Array.isArray(list))throw Error('collectors.json needs a "collectors" list.');
 for(const entry of list)if(!PROPERTY.test(entry.property||''))throw Error('Bad property name in collectors.json: '+entry.property);
 return list;
}
function withTimeout(promise){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out after '+TIMEOUT_MS/1000+'s.')),TIMEOUT_MS);})]).finally(()=>clearTimeout(timer));
}
async function run(entry){
 const missing=(entry.env||[]).filter(name=>!process.env[name]);
 if(missing.length)return {property:entry.property,value:'unknown',error:'Missing environment variable: '+missing.join(', ')};
 try{
  const script=path.join(HERE,entry.script);
  if(path.dirname(script)!==HERE)throw Error('Collector scripts must live in this folder.');
  const value=await withTimeout(Promise.resolve().then(()=>require(script)()));
  if(typeof value!=='number'||!Number.isFinite(value))throw Error('Collector returned '+JSON.stringify(value)+', not a number.');
  return {property:entry.property,value};
 }catch(error){return {property:entry.property,value:'unknown',error:error.message};}
}
function setProperty(text,property,value){
 const eol=text.includes('\r\n')?'\r\n':'\n';
 const match=text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
 if(!match)return '---'+eol+property+': '+value+eol+'---'+eol+eol+text;
 const lines=match[1].split(/\r?\n/),at=lines.findIndex(line=>line.startsWith(property+':'));
 if(at>=0)lines[at]=property+': '+value;else lines.push(property+': '+value);
 const start=match.index+match[0].indexOf(match[1]);
 return text.slice(0,start)+lines.join(eol)+text.slice(start+match[1].length);
}
function todayNote(date){
 const file=path.join(DAILY_DIR,date+'.md');
 if(!fs.existsSync(file)){
  const template=fs.existsSync(TEMPLATE)?fs.readFileSync(TEMPLATE,'utf8'):'---\ntype: daily\n---\n\n# {{date:YYYY-MM-DD}}\n\n## Activity\n';
  fs.mkdirSync(DAILY_DIR,{recursive:true});
  fs.writeFileSync(file,template.replace(/\{\{date:YYYY-MM-DD\}\}/g,date),{flag:'wx'});
 }
 return file;
}

async function main(args=process.argv.slice(2)){
 const dryRun=args.includes('--dry-run');
 const active=readCollectors().filter(entry=>entry.enabled&&!entry.manual);
 const results=[];
 for(const entry of active)results.push(await run(entry));
 const date=localDate();
 if(!dryRun&&results.length){
  const file=todayNote(date);
  let text=fs.readFileSync(file,'utf8');
  for(const result of results)text=setProperty(text,result.property,result.value);
  fs.writeFileSync(file,text);
 }
 for(const result of results)process.stdout.write(result.property+': '+result.value+(result.error?'  ('+result.error+')':'')+'\n');
 if(!results.length)process.stdout.write('No collectors are enabled. See collectors.json.\n');
 else if(dryRun)process.stdout.write('Dry run: nothing written.\n');
 else process.stdout.write('Wrote '+results.length+' value(s) to '+date+'.md\n');
 return results;
}

if(require.main===module)main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={main,setProperty,localDate};
