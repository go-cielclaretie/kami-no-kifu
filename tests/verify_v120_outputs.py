"""Compare real PDF, PNG and JPG outputs from revision_v120.py, including notes.
Pillow/PyMuPDF/numpy are QA-only dependencies; the app itself has none.
"""
from pathlib import Path
import argparse,io,json,zipfile
import fitz
import numpy as np
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('directory',nargs='?',default='qa-v120');a=p.parse_args();out=Path(a.directory);report={}
for direction in ['horizontal','vertical']:
    stem='notes_'+direction;plans=json.loads((out/(stem+'_plan.json')).read_text());pdf=fitz.open(out/(stem+'.pdf'));count=len(pdf);assert count==3
    with zipfile.ZipFile(out/(stem+'_png.zip')) as zp,zipfile.ZipFile(out/(stem+'_jpg.zip')) as zj:
        assert zp.testzip() is None and zj.testzip() is None
        ps,js=sorted(zp.namelist()),sorted(zj.namelist());assert len(ps)==len(js)==count
        pages=[]
        for n,page in enumerate(pdf):
            mm=[page.rect.width*25.4/72,page.rect.height*25.4/72];assert np.allclose(mm,[210,297],atol=.001)
            pi=Image.open(io.BytesIO(zp.read(ps[n])));ji=Image.open(io.BytesIO(zj.read(js[n])));pi.load();ji.load()
            assert pi.size==ji.size==(2480,3508)
            assert all(abs(v-300)<.01 for v in pi.info['dpi']);assert ji.info['dpi']==(300,300)
            im=pdf.extract_image(page.get_images()[0][0]);ei=Image.open(io.BytesIO(im['image']));ei.load()
            # Byte-identical embedding with the independently downloaded JPEG,
            # or equivalent decoded pixels if a PDF library rewrites headers.
            jpeg_equal=im['image']==zj.read(js[n]);px_equal=np.array_equal(np.asarray(ei.convert('RGB')),np.asarray(ji.convert('RGB')))
            assert px_equal,'PDF and JPEG pixels differ'
            item={'page':n+1,'mm':mm,'pixels':pi.size,'pdf_jpeg_bytes_equal':jpeg_equal,'pdf_jpeg_pixels_equal':px_equal}
            if n==count-1:
                ref=Image.open(out/(stem+'_reference300.png')).convert('RGB');diff=np.abs(np.asarray(ref,dtype=np.int16)-np.asarray(pi.convert('RGB'),dtype=np.int16))
                item['png_vs_renderer_mean_error']=float(diff.mean());assert diff.mean()<.05
                notes=[]
                for block in plans['notes']:
                    x,y,w,h=[block[k]*300/25.4 for k in ['x','y','w','h']];box=(int(x),int(y),int(x+w+1),int(y+h+1))
                    ar=np.asarray(pi.crop(box).convert('RGB'),dtype=np.float32);aj=np.asarray(ji.crop(box).convert('RGB'),dtype=np.float32)
                    err=float(np.abs(ar-aj).mean());assert err<3,'JPEG note region unexpectedly changed';assert np.mean(ar<180)>.003,'blank notes region'
                    notes.append({'box_pixels':box,'png_vs_jpeg_mean_error':err,'dark_channel_fraction':float(np.mean(ar<180))})
                item['notes_regions']=notes
                pi.save(out/(stem+'_lastpage.png'));ji.save(out/(stem+'_lastpage.jpg'),quality=98)
                page.get_pixmap(dpi=150,alpha=False).save(out/(stem+'_pdf_lastpage.png'))
            pages.append(item)
        report[direction]={'page_count':count,'pages':pages}
    pdf.close()
(out/'output_parity_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
