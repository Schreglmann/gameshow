import { createReadStream } from 'fs';
import { pipeline } from 'stream';
import type { ServerResponse } from 'http';

/**
 * Streams a file into an HTTP response without risking the process.
 *
 * `createReadStream(f).pipe(res)` has no error listener on the read stream: a
 * cache file deleted between the caller's `stat` and the open (cache clear,
 * prune, re-encode) emits an unhandled `'error'` and kills the server mid-show.
 * Here a failed read answers 404 if nothing was sent yet, and otherwise ends
 * the response so the client retries. See specs/crash-recovery.md.
 */
export function sendFileStream(
  res: ServerResponse,
  filePath: string,
  range?: { start: number; end: number },
): void {
  const stream = range ? createReadStream(filePath, range) : createReadStream(filePath);
  const fail = (err: Error): void => {
    console.warn(`[send-file] ${filePath}: ${err.message}`);
    if (!res.headersSent) {
      res.statusCode = 404;
      res.end('File not available');
    } else {
      res.destroy();
    }
  };
  // Wait for the open before piping: `pipeline` destroys the response on the
  // first error, which would leave no chance to answer 404 for a missing file.
  stream.once('error', fail);
  stream.once('open', () => {
    stream.off('error', fail);
    pipeline(stream, res, (err) => {
      // A client that hung up mid-stream is normal (seeking, skipping a question).
      if (!err || (err as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      fail(err);
    });
  });
}
