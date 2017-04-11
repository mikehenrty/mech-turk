(function() {
  'use strict';

  const WORKERS = 'workers';

  const ff = require('ff');
  const mongo = require('./mongo');

  module.exports = {
    get: function(workerId, ip, agent, cb) {
      let db;

      let f = ff(() => {
        mongo.getDB(f());
      },

        _db => {
          db = _db;
          db.collection(WORKERS).findOneAndUpdate(
            { workerId: workerId },
            {
              $setOnInsert: {
                workerId: workerId,
                joined: new Date(),
                submissions: 0,
              },
              $set: {
                updated: new Date(),
              },
              $inc: { accessed: 1 },
              $addToSet: { ips: ip, userAgents: agent },
            },
            { upsert: true, returnOriginal: false}, f());
        });

      f.onComplete(cb);
    },

    addSubmission: function(workerId, cb) {
      let f = ff(() => {
        mongo.getDB(f());
      },

        db => {
          db.collection(WORKERS).findOneAndUpdate(
            { workerId: workerId },
            { $inc : { submissions: 1 } },
            { returnOriginal: false}, f());
        }).onComplete(cb);
    },

    create: function(cb) {
      let f = ff(() => {
        mongo.getDB(f());
      },

        db => {
          db.createCollection(WORKERS, f.wait());
          f.pass(db);
        },

        db => {
          db.command({
            collMod: WORKERS,
            'validator': { '$and': [
              { 'workerId': { '$type': 'string' } },
              { 'joined': { '$type': 'date' } },
              { 'updated': { '$type': 'date' } },
              { 'accessed': { '$type': 'int' } },
              { 'submissions': { '$type': 'int' } },
              // validate that ips is an array (workaround).
              // see: https://jira.mongodb.org/browse/server-23912
              { 'userAgents.0': { '$exists': true } },
              { 'ips.0': { '$exists': true } },
            ]}
          }, f.wait());
          f.pass(db);
        },

        db => {
          db.collection(WORKERS).createIndex(
            { workerid: 'text', userAgents: 1, ips: 1 },
            { unique: true }, f.wait());
        });

      f.onComplete(cb);
    },

    destroy: function(cb) {
      let f = ff(() => {
        mongo.getDB(f());
      },

        db => {
          db.collection(WORKERS).drop(f());
        });

      f.onComplete(cb);
    },
  };
})();
