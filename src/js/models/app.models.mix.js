/* global console */
App.module('Models', function(Models, App, Backbone, Marionette, $, _) {

  'use strict';

  var Mix = Models.Mix = Backbone.Model.extend({

    url: function() {
      // Legacy-compatible query string parser
      function getQueryParam(name) {
        var pattern = new RegExp('[?&]' + name + '=([^&]*)');
        var match = pattern.exec(window.location.search);
        return match && decodeURIComponent(match[1].replace(/\+/g, ' '));
      }

      var taskId = getQueryParam('taskId') || 10;
      var fileIndex = getQueryParam('fileIndex') || 0;

      if (taskId) {
        return (
          '/api/mixjsgen/' +
          encodeURIComponent(taskId) +
          '/' +
          encodeURIComponent(fileIndex)
        );
      } else {
        return 'mix.json';
      }
    },

    defaults: {
      name: 'Mix',
      gain: 1,
      position: 0,
      minTime: 0,
      maxTime: Infinity,
      startTime: 0,
      playing: false,
      dBFSLeft: -48,
      dBFSRight: -48,
      duration: Infinity
    },

    initialize: function() {
      this.nodes = {};
      this.createNodes();
      this.setGain();
      if (typeof this.updatePosition === 'function') {
        this.updatePosition();
      }
      if (App && App.vent && typeof App.vent.on === 'function') {
        App.vent.on('solo', this.soloMute.bind(this));
        App.vent.on('unsolo', this.soloMute.bind(this));
        App.vent.on('anim-tick', this.updatePosition.bind(this));
      }
      this.on('change:gain', this.setGain, this);
      this.on('change:gain', this.persist, this);
    },

    createNodes: function() {
      this.fftSize = 2048;
      this.timeDataL = new Uint8Array(this.fftSize);
      this.timeDataR = new Uint8Array(this.fftSize);
      this.nodes.gain = App.ac.createGain();
      this.nodes.splitter = App.ac.createChannelSplitter(2);
      this.nodes.analyserL = App.ac.createAnalyser();
      this.nodes.analyserR = App.ac.createAnalyser();
      this.nodes.gain.connect(this.nodes.splitter);
      this.nodes.splitter.connect(this.nodes.analyserL, 0, 0);
      this.nodes.splitter.connect(this.nodes.analyserR, 1, 0);
      this.nodes.gain.connect(App.ac.destination);
      this.nodes.analyserL.smoothingTimeConstant = 1;
      this.nodes.analyserR.smoothingTimeConstant = 1;
      return this;
    },

    setGain: function() {
      this.nodes.gain.gain.value = this.get('gain');
      return this;
    },

    play: function(pos) {
      var now = App.ac.currentTime;
      var time = this.get('position');
      var tracks = this.get('tracks').models;
      var soloed = [];
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i].get('soloed')) {
          soloed.push(tracks[i]);
        }
      }
      var hasSolo = soloed.length > 0;
      var duration = 0;
      for (var j = 0; j < tracks.length; j++) {
        var t = tracks[j];
        if (t.buffer && t.buffer.duration > duration) {
          duration = t.buffer.duration;
        }
      }

      if (typeof pos === 'number') {
        this.set('position', time = Math.max(pos, this.get('minTime')));
      }

      this.set({ startTime: now - time, playing: true, duration: duration });
      this.get('tracks').play(time);

      var sampleRate = App.ac.sampleRate;
      var length = Math.ceil(duration * sampleRate);
      var AudioCtx = window.OfflineAudioContext ||
        window.webkitOfflineAudioContext;
      var offlineCtx = new AudioCtx(2, length, sampleRate);

      for (var k = 0; k < tracks.length; k++) {
        var track = tracks[k];
        var muted = track.get('muted');
        var solo = track.get('soloed');
        var gainVal = track.get('gain') || 1.0;
        var panVal = track.get('pan') || 0.0;
        var buffer = track.buffer;

        var shouldPlay = buffer && !muted && (!hasSolo || solo);
        if (!shouldPlay) {
          continue;
        }

        var src = offlineCtx.createBufferSource();
        src.buffer = buffer;

        var gain = offlineCtx.createGain();
        gain.gain.value = gainVal;

        var pan = offlineCtx.createStereoPanner();
        pan.pan.value = panVal;

        src.connect(gain).connect(pan).connect(offlineCtx.destination);
        src.start(0);
      }

      offlineCtx.startRendering().then(function(buffer) {
        var wav = this._audioBufferToWav(buffer);
        var blob = new Blob([wav], { type: 'audio/wav' });
        var url = URL.createObjectURL(blob);

        var a = document.getElementById('mix-download');
        if (!a) {
          a = document.createElement('a');
          a.id = 'mix-download';
          a.textContent = 'Download Mixdown';
          a.style.display = 'block';
          document.body.appendChild(a);
        }
        a.href = url;
        a.download = (this.get('name') || 'mix') + '.wav';
      }.bind(this))['catch'](function(err) {
        console.error('Mixdown error:', err);
      });

      return this;
    },

    pause: function() {
      this.get('tracks').pause();
      this.set('playing', false);
      App.vent.trigger('mix-pause');
      return this;
    },

    exactTime: function() {
      var now = App.ac.currentTime;
      var playing = this.get('playing');
      var start = this.get('startTime');
      var position = this.get('position');
      var delta = now - start;
      return playing ? delta : position;
    },

    updatePosition: function() {
      var position = this.exactTime();
      var playing = this.get('playing');
      if (position > Math.min(this.get('maxTime'), this.get('duration'))) {
        this.play(0).pause();
      } else {
        this.set('position', position, { silent: true });
      }
      return this;
    },

    soloMute: function() {
      var unsoloed, soloed, _muted;
      if (this.get('tracks')) {
        unsoloed = this.get('tracks').where({ soloed: false });
        soloed = this.get('tracks').where({ soloed: true });
        _muted = this.get('tracks').where({ _muted: true });
        if (soloed.length) {
          for (var i = 0; i < unsoloed.length; i++) {
            unsoloed[i]._mute();
          }
        }
        if (!soloed.length) {
          for (var j = 0; j < _muted.length; j++) {
            _muted[j]._unmute();
          }
        }
      }
      return this;
    },

    levels: function() {
      var playing = this.get('playing');
      var len = this.timeDataL.length;
      var right = new Array(len);
      var left = new Array(len);
      var i = 0;
      this.nodes.analyserL.getByteTimeDomainData(this.timeDataL);
      this.nodes.analyserR.getByteTimeDomainData(this.timeDataR);
      for (; i < len; ++i) {
        left[i] = (this.timeDataL[i] * 2 / 255) - 1;
        right[i] = (this.timeDataR[i] * 2 / 255) - 1;
      }
      left = App.util.dBFS(left);
      right = App.util.dBFS(right);
      this.set({
        dBFSLeft: playing ? left : -192,
        dBFSRight: playing ? right : -192
      });
      return this;
    },

    parse: function(data) {
      data.tracks = new App.Collections.Tracks(data.tracks);
      data.position = data.position || data.minTime || 0;
      App.tracks = data.tracks.length;
      return _.extend({}, data);
    },

    toJSON: function() {
      var out = _.extend({}, this.attributes);
      var tracks = _.map(this.get('tracks').models, function(track) {
        return track.toJSON();
      });
      out.tracks = tracks;
      delete out.dBFSLeft;
      delete out.dBFSRight;
      delete out.startTime;
      delete out.binURI;
      return out;
    },

    persist: _.debounce(function() {
      var self = App.mix;
      var data = self.toJSON();
      var binURI = self.get('binURI');
      delete data.position;
      delete data.playing;
      delete data.duration;
      delete data.binURI;
      data = JSON.stringify(data);
      $.ajax({
        type: binURI ? 'PUT' : 'POST',
        url: binURI || 'http://api.myjson.com/bins',
        contentType: 'application/json; charset=utf-8',
        dataType: 'json',
        data: data,
        success: function(response) {
          if (response.uri) {
            self.set('binURI', response.uri, { silent: true });
            location.hash = response.uri.split('/').pop();
          }
        }
      });
    }, 500),

    _audioBufferToWav: function(buffer) {
      var numChannels = buffer.numberOfChannels;
      var sampleRate = buffer.sampleRate;
      var format = 1;
      var bitDepth = 16;

      var interleaved = this._interleave(
        buffer.getChannelData(0),
        numChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)
      );

      var bufferLength = 44 + interleaved.length * 2;
      var output = new ArrayBuffer(bufferLength);
      var view = new DataView(output);

      function writeString(view, offset, str) {
        for (var i = 0; i < str.length; i++) {
          view.setUint8(offset + i, str.charCodeAt(i));
        }
      }

      function floatTo16BitPCM(view, offset, input) {
        for (var i = 0; i < input.length; i++, offset += 2) {
          var s = Math.max(-1, Math.min(1, input[i]));
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
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
      var length = inputL.length + inputR.length;
      var result = new Float32Array(length);
      var index = 0;
      for (var i = 0; i < inputL.length; i++) {
        result[index++] = inputL[i];
        result[index++] = inputR[i];
      }
      return result;
    }

  });

});
