(function() {
  'use strict';

  const EVENTS = 'events';

  const ff = require('ff');
  const Mongo = require('./mongo');

  function Events() {
    this.name = EVENTS;
  }

  Events.prototype = new Mongo();

  Events.prototype.track = function(type, location, value) {
    let db;
    let f = ff(() => {
      this.getDB(f());
    },

      _db => {
        db = _db;
        db.collection(this.name).insert({
          type: type,
          location: location,
          value: value,
          timestamp: new Date()
        });
      });
  };

  Events.prototype.create = function(cb) {
    let f = ff(() => {
      this.getDB(f());
    },

      db => {
        db.createCollection(this.name, f.wait());
        f.pass(db);
      },

      db => {
        db.command({
          collMod: this.name,
          'validator': { '$and': [
            { 'type': { '$type': 'string' } },
            { 'location': { '$type': 'string' } },
            // { 'value': { '$type': 'string' } }, No validation.
            { 'timestamp': { '$type': 'date' } },
          ]}
        }, f.wait());
        f.pass(db);
      },

      db => {
        db.collection(this.name).createIndex(
          { type: 'text' },
          {}, f.wait());
      });

    f.onComplete(cb);
  };

  module.exports = new Events();
})();
