(function() {
  'use strict';

  const SENTENCES = 'sentences';

  const ff = require('ff');
  const Mongo = require('./mongo');

  function Sentences() {
    this.name = SENTENCES;
  }

  Sentences.prototype = new Mongo();

  Sentences.prototype.add = function(type, excerpt, workerId, assignmentId) {
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
        this.getDB(f());
      },

      _db => {
        db = _db;
        db.collection(this.name).updateOne(
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
  };

  Sentences.prototype.addRecord = function(excerpt, workerId, assignmentId) {
    sentences.add('record', excerpt, workerId, assignmentId);
  };

  Sentences.prototype.addVerify = function(excerpt, workerId, assignmentId) {
    sentences.add('verify', excerpt, workerId, assignmentId);
  };

  Sentences.prototype.create = function(cb) {
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
        db.collection(this.name).createIndex(
          { excerpt: 'text' },
          { unique: true }, f.wait());
      });

    f.onComplete(cb);
  };

  module.exports = new Sentences();
})();
