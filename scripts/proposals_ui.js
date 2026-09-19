// Standalone viewer for the eight layouts implemented in the production UI.
const examples = [
 ['H1','horizontal','balanced','中央バランス型','大会名・対局者・条件を中央にまとめる。少ない項目でも余白が片側に偏らず、盤面を大きく残しやすい。'],
 ['H2','horizontal','table','二列整列表型','項目名と値を表で対応させる。掲載情報を照合しやすい。行数に応じて情報欄が高くなる。'],
 ['H3','horizontal','cards','対局者カード型','黒白を左右のカードにまとめ、共通条件を下に集約する。名前を主役にした構成。'],
 ['H4','horizontal','bands','分類帯型','対局者・対局記録・対局条件・勝敗に分類。情報量が変わっても分類の位置を追いやすい。'],
 ['V1','vertical','balanced','均等列組み型','ラベルと値の開始位置をそろえ、使う列を均等配置。空欄の列は作らない。'],
 ['V2','vertical','table','罫線整列表型','縦列を罫線で分け、項目名の帯を設ける。複数列の持ち時間も一つのセルに収める。'],
 ['V4','vertical','tiles','二段タイル型','対局者・対局記録を上段、対局条件・勝敗を下段に配置する。上部の高さを使うため盤面は小さくなる。'],
 ['V5','vertical','focus','対局者強調型','黒白の名前を少し大きくし、対局者と勝敗の背景を淡く強調する。共通条件は控えめな列にまとめる。']
];
const K=KifuCore, R=KifuRender, E=KifuExport;
const tree=K.parse(SAMPLE_SGF).games[0];tree.nodes=tree.nodes.slice(0,101);tree.children=[];
const model=K.replay(tree),initial=K.metadata(model.branch.nodes);
function proposalMeta(density='all') {
 const m={...structuredClone(initial),black:'Aoi12',blackRank:'10級',white:'Ren34',whiteRank:'15級',event:'第12回 秋季囲碁大会',place:'市民文化会館',date:'2026-09-18',result:'白1.5目勝ち',komi:'6.5',notes:'',time:{mode:'fischer',minutes:'20',increment:'10',seconds:'30',periods:'3'}};
 Object.assign(m.include,{event:density==='all',place:density!=='minimal',date:density!=='minimal',blackRank:density!=='minimal',whiteRank:density!=='minimal',time:density==='all',notes:false});return m;
}
function buildProposal(index,density='all') {
 const v=examples[index],s={...K.defaults(),infoDirection:v[1],[v[1]==='horizontal'?'infoLayoutHorizontal':'infoLayoutVertical']:v[2]},m=proposalMeta(density),plans=R.getPlans(model,s,m);
 for(const p of plans)p.blocks.push({kind:'text',role:'proposal-caption',lines:[`${v[0]} ${v[3]} ／ 搭載レイアウト・架空の対局`],x:p.margin,y:5,w:p.W-2*p.margin,size:2.6,weight:400,color:'#555555',lh:3.85,align:'center'});
 return {s,m,plans,description:v[4]};
}
let current;
function updateProposal(){
 try{const index=Number(document.querySelector('#variant').value),density=document.querySelector('#density').value;current=buildProposal(index,density);document.querySelector('#description').textContent=current.description;R.draw(document.querySelector('#canvas'),current.plans[0],current.s,150);document.querySelector('#error').textContent='';}
 catch(e){document.querySelector('#error').textContent=e.message;current=null;}
}
const selector=document.querySelector('#variant');examples.forEach((v,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${v[0]} ${v[3]}`;selector.append(o)});
selector.addEventListener('change',updateProposal);document.querySelector('#density').addEventListener('change',updateProposal);
document.querySelector('#savePdf').addEventListener('click',async()=>{if(!current)return;const button=document.querySelector('#savePdf');button.disabled=true;try{const result=await E.generate(current.plans,{...current.s,format:'pdf',dpi:300},'layout_'+examples[Number(selector.value)][0]);E.save(result.blob,result.name);}catch(e){document.querySelector('#error').textContent=e.message;}finally{button.disabled=false}});
updateProposal();
