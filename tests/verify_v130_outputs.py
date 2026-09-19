"""Pixel/byte parity of the actual revision_v130.py downloads.
Requires PyMuPDF, Pillow, numpy. Usage: python tests/verify_v130_outputs.py qa-v130
"""
import argparse,io,json,zipfile,hashlib
from pathlib import Path
import fitz
from PIL import Image
import numpy as np
p=argparse.ArgumentParser();p.add_argument('output',type=Path);a=p.parse_args();root=a.output
results=[]
for direction in ['horizontal','vertical']:
    pdf=fitz.open(root/f'notes_{direction}.pdf')
    with zipfile.ZipFile(root/f'notes_{direction}_jpg.zip') as zjpg,zipfile.ZipFile(root/f'notes_{direction}_png.zip') as zpng:
        assert zjpg.testzip() is None and zpng.testzip() is None
        jpgs=sorted(zjpg.namelist());pngs=sorted(zpng.namelist())
        assert len(pdf)==len(jpgs)==len(pngs)==3
        for i,page in enumerate(pdf):
            assert abs(page.rect.width*25.4/72-210)<.01 and abs(page.rect.height*25.4/72-297)<.01
            images=page.get_images(full=True);assert len(images)==1
            embedded=pdf.extract_image(images[0][0])['image'];jpg=zjpg.read(jpgs[i]);assert embedded==jpg
            png=Image.open(io.BytesIO(zpng.read(pngs[i]))).convert('RGB');ref=Image.open(root/f'reference_{direction}_{i+1}.png').convert('RGB')
            assert png.size==(2480,3508) and np.array_equal(np.asarray(png),np.asarray(ref))
            raster=Image.open(io.BytesIO(jpg));assert raster.size==png.size
            assert raster.info.get('dpi')==(300,300)
            # Nonblank lower-page note area, independent of header/board pixels.
            low=np.asarray(png)[int(png.height*.83):int(png.height*.93),int(png.width*.04):int(png.width*.96)]
            assert np.any(low<100)
            results.append({'direction':direction,'page':i+1,'size':list(png.size),'pdf_jpeg_identical':True,'png_reference_identical':True,'note_region_nonblank':True,'jpeg_sha256':hashlib.sha256(jpg).hexdigest()})
    pdf.close()
report={'checks':'PDF size/pages, ZIP CRC, JPEG bytes, PNG pixels, resolution, nonblank note area','results':results}
(root/'output_parity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
