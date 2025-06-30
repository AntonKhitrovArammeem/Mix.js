App.module('Views', function( Views, App, Backbone, Marionette, $, _ ) {

  'use strict';

  var Controls = Views.Controls = Marionette.ItemView.extend({
    template: '#tmpl-controls',

    el: '#controls',

    events: {
      'click .play'       : 'toggle',
      'touchstart .play'  : 'toggle',
      'click .start'      : 'start',
      'touchstart .start' : 'start',
      'click .rw'         : 'rewind',
      'touchstart .rw'    : 'rewind',
      'click .ff'         : 'fastForward',
      'touchstart .ff'    : 'fastForward',
      'click .mixdown'    : 'mixdown',
      'touchstart .mixdown' : 'mixdown'
    },

    mixdown: function () {
      Mix.mixdown();
    }
  });
});
