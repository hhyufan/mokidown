import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Maximum-quality JPEG screencasts keep high-density capture responsive.
// Lossless RGB video encoding avoids temporal compression shimmer in the GIF.
function frameSize(frame) {
  let offset = 2;
  while (offset + 8 < frame.length) {
    if (frame[offset] !== 0xff) { offset++; continue; }
    const marker = frame[offset + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return {
      width: frame.readUInt16BE(offset + 7), height: frame.readUInt16BE(offset + 5),
    };
    offset += 2 + frame.readUInt16BE(offset + 2);
  }
  throw new Error('Invalid JPEG screencast frame');
}
export async function startLosslessVideo(page, ffmpeg, output, { width = 1920, height = 1200, fps = 50, isMoving = () => false } = {}) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  let latest;
  let running = true;
  let frames = 0;
  let sourceFrames = 0;
  let sourceWidth, sourceHeight;
  let geometry;
  let geometryError;
  let previousSource = -1;
  let motionFrames = 0, motionUpdates = 0;
  let log = '';
  const ready = new Promise(resolve => {
    client.on('Page.screencastFrame', event => {
      const frame = Buffer.from(event.data, 'base64');
      sourceFrames++;
      ({ width: sourceWidth, height: sourceHeight } = frameSize(frame));
      const nextGeometry = JSON.stringify([sourceWidth, sourceHeight, event.metadata.deviceWidth,
        event.metadata.deviceHeight, event.metadata.pageScaleFactor]);
      if (geometry && geometry !== nextGeometry) {
        geometryError ||= new Error(`Recording viewport changed: ${geometry} → ${nextGeometry}`);
      } else latest = frame;
      geometry ||= nextGeometry;
      void client.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
      resolve();
    });
  });
  await client.send('Page.startScreencast', { format: 'jpeg', quality: 100, everyNthFrame: 1, maxWidth: width, maxHeight: height });
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(new Error('No screencast frame')), 10000))]);
  if (sourceWidth !== width || sourceHeight !== height) throw new Error(`Unexpected source resolution ${sourceWidth}×${sourceHeight}; expected ${width}×${height}`);
  const encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe',
    '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', 'pipe:0', '-an', '-c:v', 'libx264rgb', '-crf', '0',
    '-preset', 'ultrafast', '-pix_fmt', 'rgb24', '-threads', '4', output], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const completed = new Promise((resolve, reject) => {
    encoder.on('error', reject);
    encoder.on('close', code => code === 0 ? resolve() : reject(new Error(log)));
  });
  encoder.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
  const start = Date.now();
  const writer = (async () => {
    while (running) {
      if (isMoving()) {
        motionFrames++;
        if (previousSource !== sourceFrames) motionUpdates++;
      }
      previousSource = sourceFrames;
      if (!encoder.stdin.write(latest)) await once(encoder.stdin, 'drain');
      frames++;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, frames * 1000 / fps - (Date.now() - start))));
    }
  })();
  return {
    currentFrame() {
      if (geometryError) throw geometryError;
      return latest;
    },
    async stop() {
    running = false;
    await writer;
    await client.send('Page.stopScreencast');
    await client.detach();
    encoder.stdin.end();
    await completed;
    if (geometryError) throw geometryError;
    return { frames, sourceFrames, sourceWidth, sourceHeight, fps, sourceFormat: 'jpeg', sourceQuality: 100,
      stableGeometry: JSON.parse(geometry),
      motionFreshFps: motionFrames ? Math.round(fps * motionUpdates / motionFrames) : 0,
      durationMs: frames * 1000 / fps };
  } };
}
