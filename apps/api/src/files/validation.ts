import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument, PDFDict, PDFName, PDFRawStream, PDFArray, type PDFObject } from 'pdf-lib';
export class InvalidEvidence extends Error {
  constructor(readonly code: 'INVALID_TYPE' | 'OVERSIZE') {
    super(code);
  }
}
export async function sanitizeEvidence(bytes: Uint8Array, mime: string) {
  if (bytes.length < 1 || bytes.length > 5242880) throw new InvalidEvidence('OVERSIZE');
  const data = Buffer.from(bytes);
  if (mime === 'image/png' || mime === 'image/jpeg') {
    const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
    if ((mime === 'image/png' && !png) || (mime === 'image/jpeg' && !jpeg))
      throw new InvalidEvidence('INVALID_TYPE');
    try {
      const pipeline = () =>
        sharp(data, {
          limitInputPixels: 20000000,
          failOn: 'warning',
          sequentialRead: true,
        }).rotate();
      const meta = await pipeline().metadata();
      if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error();
      const sanitized = await pipeline()
        .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      const thumbnail = await sharp(sanitized)
        .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      if (sanitized.length > 10485760) throw new InvalidEvidence('OVERSIZE');
      return { sanitized, thumbnail, mime: 'image/png' };
    } catch (e) {
      if (e instanceof InvalidEvidence) throw e;
      throw new InvalidEvidence('INVALID_TYPE');
    }
  }
  if (mime === 'application/pdf') {
    if (!data.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new InvalidEvidence('INVALID_TYPE');
    try {
      const pdf = await PDFDocument.load(data, {
        ignoreEncryption: false,
        updateMetadata: false,
        throwOnInvalidObject: true,
      });
      if (pdf.getPageCount() < 1 || pdf.getPageCount() > 100) throw new Error();
      const forbidden = new Set([
        'JavaScript',
        'JS',
        'OpenAction',
        'AA',
        'Launch',
        'EmbeddedFile',
        'EmbeddedFiles',
        'RichMedia',
        'XFA',
        'AcroForm',
        'Encrypt',
        'URI',
        'GoToR',
        'SubmitForm',
        'ImportData',
        'Metadata',
      ]);
      const visited = new Set<PDFObject>();
      const inspect = (object: PDFObject, depth = 0): void => {
        if (depth > 50 || visited.size > 20000) throw new Error();
        if (visited.has(object)) return;
        visited.add(object);
        if (object instanceof PDFName && forbidden.has(object.decodeText())) throw new Error();
        if (object instanceof PDFRawStream) inspect(object.dict, depth + 1);
        if (object instanceof PDFDict)
          for (const [name, value] of object.entries()) {
            if (forbidden.has(name.decodeText())) throw new Error();
            inspect(value, depth + 1);
          }
        if (object instanceof PDFArray)
          for (const value of object.asArray()) inspect(value, depth + 1);
      };
      for (const [, object] of pdf.context.enumerateIndirectObjects()) inspect(object);
      const clean = await PDFDocument.create();
      const pages = await clean.copyPages(pdf, pdf.getPageIndices());
      for (const p of pages) clean.addPage(p);
      clean.setProducer('CampusFix');
      clean.setCreator('CampusFix');
      const sanitized = await clean.save({ useObjectStreams: false });
      if (sanitized.length > 10485760) throw new InvalidEvidence('OVERSIZE');
      return { sanitized, thumbnail: undefined, mime: 'application/pdf' };
    } catch (e) {
      if (e instanceof InvalidEvidence) throw e;
      throw new InvalidEvidence('INVALID_TYPE');
    }
  }
  throw new InvalidEvidence('INVALID_TYPE');
}
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
