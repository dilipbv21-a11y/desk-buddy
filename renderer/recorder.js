// Microphone capture -> 16 kHz mono 16-bit WAV (the format whisper.cpp wants).
(function (root) {
  function downsample(input, fromRate, toRate) {
    if (toRate >= fromRate) return input;
    const ratio = fromRate / toRate;
    const out = new Float32Array(Math.floor(input.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = a; j < b; j++) sum += input[j];
      out[i] = sum / Math.max(1, b - a);
    }
    return out;
  }

  function encodeWav(samples, rate) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  class Recorder {
    async start(onLevel) {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      this.ctx = new AudioContext();
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
      this.chunks = [];
      this.proc.onaudioprocess = (e) => {
        const d = e.inputBuffer.getChannelData(0);
        this.chunks.push(new Float32Array(d));
        let sum = 0;
        for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
        onLevel && onLevel(Math.sqrt(sum / d.length), (d.length / this.ctx.sampleRate) * 1000);
      };
      this.src.connect(this.proc);
      this.proc.connect(this.ctx.destination);
    }

    async stop() {
      if (!this.ctx) return null;
      this.proc.disconnect(); this.src.disconnect();
      this.stream.getTracks().forEach(t => t.stop());
      const rate = this.ctx.sampleRate;
      await this.ctx.close();
      this.ctx = null;
      const len = this.chunks.reduce((n, c) => n + c.length, 0);
      const all = new Float32Array(len);
      let o = 0;
      for (const c of this.chunks) { all.set(c, o); o += c.length; }
      return encodeWav(downsample(all, rate, 16000), 16000);
    }
  }

  const api = { Recorder, downsample, encodeWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BuddyAudio = api;
})(typeof window !== 'undefined' ? window : globalThis);
