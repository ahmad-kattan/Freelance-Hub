import { BadRequestException, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export type SaveFileOptions = {
    dir: string;
    allowedTypes: Record<string, string>;
    errorMessage: string;
};

export type SavedFile = { storedName: string; mimeType: string; size: number; originalName: string; };

@Injectable()
export class FileStorageService {
    async saveValidated(file: Express.Multer.File, options: SaveFileOptions):
        Promise<SavedFile> {
        const detected = await fileTypeFromBuffer(file.buffer);
        const extension = detected ? options.allowedTypes[detected.mime] : undefined;

        if (!detected || !extension) {
            throw new BadRequestException(options.errorMessage);
        }

        const storedName = `${randomUUID()}.${extension}`;

        await mkdir(options.dir, { recursive: true });
        await writeFile(resolve(options.dir, storedName), file.buffer, {
            flag: 'wx',
        });

        return {
            storedName,
            mimeType: detected.mime,
            size: file.buffer.length,
            originalName: this.cleanFileName(file.originalname),
        };
    }

    resolvePath(dir: string, storedName: string): string {
        return resolve(dir, basename(storedName));
    }

    async remove(dir: string, storedName?: string | null): Promise<void> {
        if (!storedName) return;

        const safeName = basename(storedName);
        if (!safeName || safeName === '.' || safeName === '..') return;

        try {
            await unlink(resolve(dir, safeName));
        } catch (error) {
            if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
            ) {
                return;
            }
            throw error;
        }
    }

    cleanFileName(originalName: string): string {
        let name = originalName;
        const alreadyUnicode = [...name].some((ch) => ch.charCodeAt(0) > 0xff);
        if (!alreadyUnicode) {
            const decoded = Buffer.from(name, 'latin1').toString('utf8');
            if (!decoded.includes('\uFFFD')) name = decoded;
        }

        const cleaned = basename(name)
            .replace(/[\u0000-\u001f"\\/]+/g, '_')
            .slice(0, 255);

        return cleaned || 'file';
    }
}