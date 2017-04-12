(function() {
  'use strict';

  const SENTENCES = 'sentences';

  const ff = require('ff');
  const mongo = require('./mongo');

  let sentences = {

    add: function(type, excerpt, workerId, assignmentId) {
      let db;
      let addToSet = {};

      if (!excerpt) {
        console.error('missing excerpt', workerId, assignmentId);
        return;
      }

      if (type === 'record') {
        addToSet.recordWorkers = workerId;
        addToSet.recordAssignments = assignmentId;
      } else if (type === 'verify') {
        addToSet.verifyWorkers = workerId;
        addToSet.verifyAssignments = assignmentId;
      } else {
        console.error('unrecognized sentence type', type);
        return;
      }

      let f = ff(
        () => {
          mongo.getDB(f());
        },

        _db => {
          db = _db;
          db.collection(SENTENCES).updateOne(
            { excerpt: excerpt },
            {
              $setOnInsert: {
                excerpt: excerpt,
                created: new Date(),
              },
              $set: {
                updated: new Date(),
              },
              $addToSet: addToSet
            },
            { upsert: true });
        });
    },

    addRecord: function(excerpt, workerId, assignmentId) {
      sentences.add('record', excerpt, workerId, assignmentId);
    },

    addVerify: function(excerpt, workerId, assignmentId) {
      sentences.add('verify', excerpt, workerId, assignmentId);
    },

    create: function(cb) {
      let f = ff(() => {
        mongo.getDB(f());
      },

        db => {
          db.createCollection(SENTENCES, f.wait());
          f.pass(db);
        },

        db => {
          db.command({
            collMod: SENTENCES,
            'validator': { '$and': [
              { 'excerpt': { '$type': 'string' } },
              { 'created': { '$type': 'date' } },
              { 'updated': { '$type': 'date' } },

              // Validate arrays (workaround).
              // see: https://jira.mongodb.org/browse/server-23912
              //
              // Disable validation for these optional arrays.
              // { 'recordWorkers.0': { '$exists': true } },
              // { 'verifyWorkers.0': { '$exists': true } },
              // { 'recordAssignments.0': { '$exists': true } },
              // { 'verifyAssignments.0': { '$exists': true } },
            ]}
          }, f.wait());
          f.pass(db);
        },

        db => {
          db.collection(SENTENCES).createIndex(
            { excerpt: 'text' },
            { unique: true }, f.wait());
        });

      f.onComplete(cb);
    },

    destroy: function(cb) {
      let f = ff(() => {
        mongo.getDB(f());
      },

        db => {
          db.collection(SENTENCES).drop(f());
        });

      f.onComplete(cb);
    }
  };

  module.exports = sentences;
})();
