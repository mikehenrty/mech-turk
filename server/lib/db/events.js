(function() {
  'use strict';

  const EVENTS = 'events';

  const ff = require('ff');
  const mongo = require('./mongo');

  let events = {

    track: function(type, location, value) {
      let db;
      let f = ff(() => {
        mongo.getDB(f());
      },

        _db => {
          db = _db;
          db.collection(EVENTS).insert({
            type: type,
            location: location,
            value: value,
            timestamp: new Date()
          });
        });
    },

    create: function(cb) {
      let f = ff(() => {
        mongo.getDB(f());
      },

        db => {
          db.createCollection(EVENTS, f.wait());
          f.pass(db);
        },

        db => {
          db.command({
            collMod: EVENTS,
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
          db.collection(EVENTS).createIndex(
            { type: 'text' },
            {}, f.wait());
        });

      f.onComplete(cb);
    },

    destroy: function(cb) {
      let f = ff(() => {
        mongo.getDB(f());
      },

        db => {
          db.collection(EVENTS).drop(f());
        });

      f.onComplete(cb);
    },
  };

  module.exports = events;
})();
