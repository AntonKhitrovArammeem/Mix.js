var Mix = {
  // ...other methods

  mixdown: function() {
    if (!Mix.tracks || Mix.tracks.length === 0) {
      console.error('No tracks loaded');
      return;
    }

    const sampleRate = Mix.context.sampleRate;
    const duration = Mix.duration(); // In seconds
    const offlineCtx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

    // Determine if soloed tracks exist
    const soloed = Mix.tracks.filter(t => t.soloed);
    const tracksToUse = soloed.length > 0 ? soloed : Mix.tracks;

    tracksToUse.forEach(track => {
      if (track.muted || !track.buffer) return;

      const src = offlineCtx.createBufferSource();
      src.buffer = track.buffer;

      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = track.gain || 1.0;

      const panNode = offlineCtx.createStereoPanner();
      panNode.pan.value = track.pan || 0.0;

      src.connect(gainNode).connect(panNode).connect(offlineCtx.destination);
      src.start(0);
    });

    offlineCtx.startRendering().then(buffer => {
      const wavData = Mix._audioBufferToWav(buffer);
      const blob = new Blob([wavData], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = (Mix.name || 'mixdown') + '.wav';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }).catch(err => {
      console.error('Mixdown rendering failed:', err);
    });
  },

  _audioBufferToWav: function(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const interleaved = Mix._interleave(
      buffer.getChannelData(0),
      numChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)
    );

    const bufferLength = 44 + interleaved.length * 2;
    const output = new ArrayBuffer(bufferLength);
    const view = new DataView(output);

    function writeString(view, offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    }

    function floatTo16BitPCM(output, offset, input) {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
    }

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + interleaved.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitDepth / 8, true);
    view.setUint16(32, numChannels * bitDepth / 8, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, interleaved.length * 2, true);

    floatTo16BitPCM(view, 44, interleaved);

    return output;
  },

  _interleave: function(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0;
    for (let i = 0; i < inputL.length; i++) {
      result[index++] = inputL[i];
      result[index++] = inputR[i];
    }
    return result;
  }
};
