"""Render material/coordinate comparison sheets with the actual app renderer."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import argparse,base64
p=argparse.ArgumentParser();p.add_argument('--chromium',default=None);a=p.parse_args();r=Path(__file__).resolve().parent.parent;out=r/'docs/screenshots';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=a.chromium,args=['--no-sandbox']);pg=b.new_page(bypass_csp=True, );pg.set_content((r/'standalone/index.html').read_text());pg.evaluate('KifuRender.ready()')
 images=pg.evaluate('''()=>{const R=KifuRender,s=KifuCore.defaults(),cv=document.createElement('canvas');cv.width=1600;cv.height=1450;const c=cv.getContext('2d');c.fillStyle='#f8f7f3';c.fillRect(0,0,cv.width,cv.height);c.fillStyle='#172a36';c.font='600 30px '+R.SANS;c.fillText('碁石と木目の比較 — v2.0.0',60,54);c.font='18px '+R.SANS;c.fillStyle='#52616a';c.fillText('大きい石は質感の確認用。横の小さい石は手数を載せた表示例。',60,89);
 const patterns=[['plain','無地'],['glass','ガラス'],['nachi','那智黒'],['agate','メノウ']];
 for(let j=0;j<2;j++)for(let i=0;i<4;i++){const x=190+i*380,y=210+j*285,key=j===1&&i===2?'shell':patterns[i][0],settings={...s,blackPattern:key,whitePattern:key};R.stone(c,x,y,83,j+1,settings,1,2);c.fillStyle='#172a36';c.font='23px '+R.SANS;c.textAlign='center';c.fillText(j===1&&i===2?'蛤':patterns[i][1],x,y+119);R.stone(c,x+118,y+66,21,j+1,settings,1,2);R.number(c,'53',x+118,y+66,21,j?'#111':'#fff',false);}
 c.fillStyle='#172a36';c.font='600 24px '+R.SANS;c.textAlign='center';c.fillText('柾目 — 平行な木目を濃く',405,684);c.fillText('板目 — 添付写真の山形の木目',1195,684);
 R.boardTexture(c,{x:60,y:712,w:690,h:690},{...s,boardColor:'kaya-new',grain:'masame'});R.boardTexture(c,{x:850,y:712,w:690,h:690},{...s,boardColor:'kaya-new',grain:'itame'});
 const materials=cv.toDataURL().split(',')[1];cv.width=1500;cv.height=820;c.fillStyle='#fff';c.fillRect(0,0,1500,820);c.textAlign='left';c.fillStyle='#172a36';c.font='600 30px '+R.SANS;c.fillText('横座標 — 行ごとに共通のベースライン',48,55);c.font='18px '+R.SANS;c.fillText('薄い青線は確認用。実際の棋譜には出力しない。',48,95);
 const formats=['num-kanji','lower-lower','upper-upper','num-lower','num-upper'];const names=['数字−漢数字','a−a','A−A','1−a','1−A'];for(let j=0;j<5;j++){const y=195+j*125,ts=R.horizontalCoordinateLayout(Array.from({length:19},(_,i)=>R.coordLabel(i+1,'h',formats[j])),29,y);c.strokeStyle='#95c3d8';c.lineWidth=1;c.beginPath();c.moveTo(250,ts[0].baseline);c.lineTo(1450,ts[0].baseline);c.stroke();c.fillStyle='#172a36';c.textAlign='left';c.textBaseline='alphabetic';c.font='21px '+R.SANS;c.fillText(names[j],48,y);c.font='29px '+R.SANS;c.textAlign='center';ts.forEach((t,i)=>c.fillText(t.text,275+i*64,t.baseline));}return {materials,coordinates:cv.toDataURL().split(',')[1]};}''')
 for key,data in images.items():(out/(key+'.png')).write_bytes(base64.b64decode(data))
 b.close()
