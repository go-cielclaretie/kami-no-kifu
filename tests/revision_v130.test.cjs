'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const K = require('../js/core.js');
const meta = () => K.metadata(K.parse('(;GM[1]SZ[19]PB[Aoi12]BR[10級]PW[B23]WR[15級]RU[Japanese]KM[6.5]RE[W+1.5])').games[0].nodes);
function preferences(storage) {
 const context=vm.createContext({KifuCore:K,TextEncoder,localStorage:storage});
 vm.runInContext(fs.readFileSync(require.resolve('../js/preferences.js'),'utf8'),context);return context.KifuPreferences;
}
const timeValues={minutes:'20',seconds:'30',periods:'3',increment:'10',overtimeMinutes:'5',moves:'25',perMoveSeconds:'30'};
for(const mode of Object.keys(K.TIME_CONTROLS)) {
 test(`v130 valid ${mode} time`,()=>{let m=meta();m.include.time=true;m.time={...timeValues,mode};assert.deepEqual(K.validateMetadata(m),[])});
 for(const [key,label,min,integer] of K.TIME_CONTROLS[mode].fields) test(`v130 validate ${mode}/${key}`,()=>{
  for(const bad of ['', ' ',null,'NaN','Infinity',String(min-1), ...(integer?['1.5']:[])]){let m=meta();m.include.time=true;m.time={...timeValues,mode,[key]:bad};assert.ok(K.validateMetadata(m).some(x=>x.includes(label)),`${mode}/${key} accepted ${bad}`)}
 });
 test(`v130 hidden fields ignored ${mode}`,()=>{let m=meta();m.include.time=true;m.time={...Object.fromEntries(Object.keys(timeValues).map(k=>[k,'invalid'])),mode};for(const [key] of K.TIME_CONTROLS[mode].fields)m.time[key]=timeValues[key];assert.deepEqual(K.validateMetadata(m),[])});
}
for(const [tm,ot,mode,field,value] of [
 ['600','3x30 byo-yomi','japanese','periods','3'],['600','30秒×3回','japanese','seconds','30'],
 ['600','25/600 Canadian','canadian','overtimeMinutes','10'],['600','Canadian 5min/25 moves','canadian','moves','25'],
 ['600','Fischer 10','fischer','increment','10'],['600','absolute','absolute','minutes','10'],
 ['','30s/move','byoyomi','perMoveSeconds','30'],['600','30s/move','japanese','periods','1'],
 ['','NHK 30s + 10x60s','nhk','seconds','60']]) test(`v130 OT ${ot} TM=${tm}`,()=>{const t=K.parseTime(tm,ot);assert.equal(t.mode,mode);assert.equal(t[field],value);assert.equal(t.recognized,true)});
test('v130 TM-only does not imply sudden death',()=>assert.equal(K.parseTime('600','').mode,''));
test('v130 unrecognized OT preserved verbatim',()=>{let t=K.parseTime('600','tournament custom rules');assert.equal(t.raw,'tournament custom rules');assert.equal(t.recognized,false);assert.equal(t.mode,'')});
test('v130 swiss legacy migrates to japanese',()=>assert.equal(K.normalizeTime({mode:'swiss'}).mode,'japanese'));
test('v130 page range normalizes and deduplicates',()=>assert.deepEqual(K.parsePageNumbers('３, １－２、２,５〜６',6),[1,2,3,5,6]));
for(const text of ['', '0', '4', '3-2', '1,,2', '1.5', '-1', '1-99999999999999999','a']) test(`v130 reject page selector ${text}`,()=>assert.throws(()=>K.parsePageNumbers(text,3)));
test('v130 first last custom union',()=>assert.deepEqual(K.notePages({...K.defaults(),notesPlacement:{first:true,last:true,custom:true,all:false},notesPageNumbers:'2,3'},5),[1,2,3,5]));
test('v130 all overrides invalid custom range',()=>assert.deepEqual(K.notePages({...K.defaults(),notesPlacement:{first:true,last:true,custom:true,all:true},notesPageNumbers:'999'},3),[1,2,3]));
test('v130 selection empty permits no comments',()=>assert.deepEqual(K.notePages({...K.defaults(),notesPlacement:{first:false,last:false,custom:false,all:false}},3),[]));
test('v130 default note placement is last',()=>assert.deepEqual(K.notePages(K.defaults(),3),[3]));
test('v130 one board deduplicates first and last',()=>assert.deepEqual(K.notePages({...K.defaults(),notesPlacement:{first:true,last:true}},1),[1]));
test('v130 same note on all boards',()=>{const s={...K.defaults(),notesPlacement:{all:true}},m=meta();m.notes='共通';assert.deepEqual([1,2,3].map(p=>K.notesForPage(m,s,p,3)),['共通','共通','共通'])});
test('v130 individual notes match board numbers',()=>{const s={...K.defaults(),notesPlacement:{all:true},notesAllMode:'individual'},m=meta();m.notes='共通';m.notesByPage={1:'布石',2:'中盤',3:'終盤',9:'非出力'};assert.deepEqual([1,2,3].map(p=>K.notesForPage(m,s,p,3)),['布石','中盤','終盤'])});
test('v130 missing individual note does not reuse common text',()=>{const s={...K.defaults(),notesPlacement:{all:true},notesAllMode:'individual'},m=meta();m.notes='common';assert.equal(K.notesForPage(m,s,1,3),'')});
test('v130 publication off hides all notes',()=>{const s={...K.defaults(),notesPlacement:{all:true}},m=meta();m.notes='private';m.include.notes=false;assert.equal(K.notesForPage(m,s,1,3),'')});
test('v130 new match clears per-page comments',()=>{const m=meta();m.notesByPage[1]='note';assert.deepEqual(meta().notesByPage,{})});
test('v130 long individual comment validation',()=>{const m=meta();m.notesByPage[1]='x'.repeat(12001);assert.ok(K.validateMetadata(m).length)});
test('v130 combined comment memory limit',()=>{const m=meta();m.notesByPage=Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,'x'.repeat(12000)]));assert.ok(K.validateMetadata(m).some(t=>t.includes('合計')))});
for(const [dir,layouts] of [['Horizontal',['balanced','table','cards','bands','focus']],['Vertical',['balanced','table','tiles','groups','focus']]])test(`v130 adopted ${dir} layouts`,()=>{for(const x of layouts)assert.equal(K.validateSettings({...K.defaults(),['infoLayout'+dir]:x}).length,0);assert.ok(K.validateSettings({...K.defaults(),['infoLayout'+dir]:'unknown'}).length)});
test('v130 local storage preference roundtrip',()=>{const map=new Map(),p=preferences({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)});const input={...K.defaults(),grain:'itame',mode:'split',split:'50',infoLayoutVertical:'tiles',infoPatternVertical:'4'};p.save(input);assert.equal(p.load().settings.grain,'itame');assert.equal(p.load().settings.infoLayoutVertical,'tiles');assert.equal(p.load().settings.infoPatternVertical,'4');assert.equal(p.load().error,'')});
test('v130 persistent allowlist excludes game data and private overrides',()=>{const p=preferences({}),t=p.encode({...K.defaults(),meta:meta(),notes:'private',SGF:'SECRET',_layoutVariant:'groups',positions:{...K.defaults().positions,extra:'secret'}});assert.ok(!/private|SECRET|_layoutVariant|Aoi12|extra/.test(t))});
test('v130 encoded preferences restore kanji stash',()=>{const p=preferences({}),s=K.normalizeSettings({...K.defaults(),mode:'split',split:'custom',customSplit:73,numberStyle:'kanji'});const loaded=p.decode(p.encode(s)),restored=K.normalizeSettings({...loaded,numberStyle:'arabic'});assert.equal(restored.split,'custom');assert.equal(restored.customSplit,73)});
test('v130 corrupted storage does not crash startup',()=>{const p=preferences({getItem:()=>'{broken'});assert.equal(p.load().settings,null);assert.ok(p.load().error)});
test('v130 storage errors returned on load and thrown on save',()=>{const p=preferences({getItem:()=>{throw Error('SecurityError')},setItem:()=>{throw Error('QuotaExceededError')}});assert.ok(p.load().error);assert.throws(()=>p.save(K.defaults()),/保存できません/)});
test('v130 storage readback checked',()=>{const p=preferences({getItem:()=>null,setItem:()=>{}});assert.throws(()=>p.save(K.defaults()),/保存できません/)});
for(const val of [null,[],{app:'KifuPrintWeb',schema:99,settings:{}},{app:'other',schema:1,settings:{}},{app:'KifuPrintWeb',schema:1,settings:{showTitle:'true'}}])test(`v130 reject bad preference ${JSON.stringify(val)}`,()=>assert.throws(()=>preferences({}).decode(JSON.stringify(val))));
test('v130 JSON size limit is bytes, not characters',()=>assert.throws(()=>preferences({}).decode('あ'.repeat(20000)),/50 KB/));
